import { app, BrowserWindow, ipcMain, Menu, net, protocol, safeStorage, screen, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'

// Electron counterpart of the Swift app's AppKit layer: the main window, the floating mini
// widget (`FloatingWidgetController`), the `navi://` OAuth callback (`onOpenURL`), the account
// menu (`AccountCommands`), and the Keychain-backed session storage.

const PROTOCOL = 'navi'
const isMac = process.platform === 'darwin'
const rendererDir = join(__dirname, '../renderer')

// The packaged renderer is served from `app://navi/` instead of file:// so both windows share
// a real origin: supabase-js syncs the session between them over BroadcastChannel and
// navigator.locks, which need one.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
/// A deep link that arrived before the main window could take it (cold start from the browser).
let pendingDeepLink: string | null = null

// MARK: - Deep links

if (process.defaultApp && process.argv.length >= 2) {
  // `electron .` in development: register the dev binary together with the app path.
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [join(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function deepLinkFrom(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
}

function handleDeepLink(url: string): void {
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    pendingDeepLink = url
    return
  }
  mainWindow.webContents.send('deep-link', url)
  showMainWindow()
}

// macOS delivers the URL as an event; Windows and Linux start a second instance with it in argv.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.on('second-instance', (_event, argv) => {
  const url = deepLinkFrom(argv)
  if (url) handleDeepLink(url)
  else showMainWindow()
})

// MARK: - Secure storage (the Swift app keeps the Supabase session in the Keychain)

const storePath = (): string => join(app.getPath('userData'), 'secure-store.json')
let storeCache: Record<string, string> | null = null

function readStore(): Record<string, string> {
  if (storeCache) return storeCache
  try {
    storeCache = existsSync(storePath()) ? JSON.parse(readFileSync(storePath(), 'utf8')) : {}
  } catch {
    storeCache = {}
  }
  return storeCache!
}

function writeStore(store: Record<string, string>): void {
  storeCache = store
  writeFileSync(storePath(), JSON.stringify(store), { mode: 0o600 })
}

function encrypt(value: string): string {
  return safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(value).toString('base64')
    : 'raw:' + value
}

function decrypt(stored: string): string | null {
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    if (stored.startsWith('raw:')) return stored.slice(4)
  } catch {
    // A store written by another machine or user can't be decrypted; treat it as signed out.
  }
  return null
}

ipcMain.handle('secure-store:get', (_e, key: string) => {
  const stored = readStore()[key]
  return stored === undefined ? null : decrypt(stored)
})
ipcMain.handle('secure-store:set', (_e, key: string, value: string) => {
  writeStore({ ...readStore(), [key]: encrypt(value) })
})
ipcMain.handle('secure-store:remove', (_e, key: string) => {
  const { [key]: _removed, ...rest } = readStore()
  writeStore(rest)
})

// MARK: - Windows

function loadRenderer(window: BrowserWindow, hash = ''): void {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL + hash)
  } else {
    window.loadURL('app://navi/index.html' + hash)
  }
}

const webPreferences = (): Electron.WebPreferences => ({
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  contextIsolation: true
})

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 720,
    minHeight: 500,
    title: 'Navi',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: webPreferences()
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      mainWindow?.webContents.send('deep-link', pendingDeepLink)
      pendingDeepLink = null
    }
  })
  // Links in mail bodies and the like open in the browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  // If the main window comes back some other way (Dock icon, taskbar), hide the widget.
  mainWindow.on('focus', () => widgetWindow?.hide())
  mainWindow.on('closed', () => {
    mainWindow = null
    widgetWindow?.destroy()
    widgetWindow = null
  })
  loadRenderer(mainWindow)
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow()
    return
  }
  widgetWindow?.hide()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/// Borderless, transparent, always-on-top window at the bottom right of the screen
/// (`FloatingWidgetController.makePanel`). It follows its content size through `widget:resize`.
function createWidgetWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 360,
    height: 200,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: webPreferences()
  })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('closed', () => {
    if (widgetWindow === window) widgetWindow = null
  })
  loadRenderer(window, '#widget')
  return window
}

/// Keeps the widget's bottom-right corner in place (the mascot stays put while the briefing
/// grows or shrinks above it). The first placement sits just above the Dock / taskbar.
function fitWidget(width: number, height: number): void {
  if (!widgetWindow || width <= 0 || height <= 0) return
  const bounds = widgetWindow.getBounds()
  let right: number
  let bottom: number
  if (widgetWindow.isVisible() || widgetPlaced) {
    right = bounds.x + bounds.width
    bottom = bounds.y + bounds.height
  } else {
    const area = screen.getPrimaryDisplay().workArea
    right = area.x + area.width - 24
    bottom = area.y + area.height - 16
    widgetPlaced = true
  }
  widgetWindow.setBounds({
    x: Math.round(right - width),
    y: Math.round(bottom - height),
    width: Math.ceil(width),
    height: Math.ceil(height)
  })
}
let widgetPlaced = false

ipcMain.on('widget:compress', () => {
  widgetWindow ??= createWidgetWindow()
  const show = (): void => {
    mainWindow?.hide()
    widgetWindow?.webContents.send('widget:reset')
    widgetWindow?.showInactive()
  }
  if (widgetWindow.webContents.isLoading()) widgetWindow.webContents.once('did-finish-load', show)
  else show()
})

ipcMain.on('widget:expand', (_e, tab: string | null) => {
  widgetWindow?.hide()
  if (tab) mainWindow?.webContents.send('main:select-tab', tab)
  showMainWindow()
})

ipcMain.on('widget:resize', (_e, size: { width: number; height: number }) => {
  fitWidget(size.width, size.height)
})

ipcMain.on('widget:focus', () => widgetWindow?.focus())

/// The dashboard's two-column layout (Figma: 1282×694) needs a wider window than onboarding.
ipcMain.on('window:set-min-size', (_e, size: { width: number; height: number }) => {
  if (!mainWindow) return
  mainWindow.setMinimumSize(size.width, size.height)
  const [width, height] = mainWindow.getSize()
  if (width < size.width || height < size.height) {
    mainWindow.setSize(Math.max(width, size.width), Math.max(height, size.height))
  }
})

ipcMain.handle('shell:open-external', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  return undefined
})

// MARK: - Menu (`AccountCommands`)

let accountMenuEnabled = false

ipcMain.on('menu:set-account-enabled', (_e, enabled: boolean) => {
  accountMenuEnabled = enabled
  buildMenu()
})

function buildMenu(): void {
  const send = (channel: string) => () => mainWindow?.webContents.send(channel)
  const accountItems: Electron.MenuItemConstructorOptions[] = [
    { label: '로그아웃', enabled: accountMenuEnabled, click: send('menu:sign-out') },
    ...(app.isPackaged
      ? []
      : [{ label: '온보딩 다시 보기', enabled: accountMenuEnabled, click: send('menu:reset-onboarding') }])
  ]
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            ...accountItems,
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ] as Electron.MenuItemConstructorOptions[]
        }]
      : [{ label: '파일', submenu: [...accountItems, { type: 'separator' }, { role: 'quit' }] as Electron.MenuItemConstructorOptions[] }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// MARK: - Lifecycle

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url)
    const file = normalize(join(rendererDir, decodeURIComponent(pathname)))
    if (!file.startsWith(rendererDir)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  buildMenu()
  createMainWindow()

  const url = deepLinkFrom(process.argv)
  if (url) pendingDeepLink = url

  app.on('activate', () => showMainWindow())
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
