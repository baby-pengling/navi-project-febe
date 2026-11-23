import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/// The only bridge between the renderer and the main process (`window.navi`).
const listen = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  platform: process.platform,
  secureStore: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('secure-store:get', key),
    set: (key: string, value: string): Promise<void> => ipcRenderer.invoke('secure-store:set', key, value),
    remove: (key: string): Promise<void> => ipcRenderer.invoke('secure-store:remove', key)
  },
  edgeFetch: (request: {
    url: string
    method: string
    headers: Record<string, string>
    body: ArrayBuffer | null
  }): Promise<{ status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer }> =>
    ipcRenderer.invoke('edge:fetch', request),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  onDeepLink: (listener: (url: string) => void) => listen('deep-link', listener),
  setMinimumSize: (width: number, height: number) => ipcRenderer.send('window:set-min-size', { width, height }),
  setAccountMenuEnabled: (enabled: boolean) => ipcRenderer.send('menu:set-account-enabled', enabled),
  onMenuSignOut: (listener: () => void) => listen('menu:sign-out', listener),
  onMenuResetOnboarding: (listener: () => void) => listen('menu:reset-onboarding', listener),
  widget: {
    compress: () => ipcRenderer.send('widget:compress'),
    expand: (tab: string | null) => ipcRenderer.send('widget:expand', tab),
    resize: (width: number, height: number) => ipcRenderer.send('widget:resize', { width, height }),
    focus: () => ipcRenderer.send('widget:focus'),
    onReset: (listener: () => void) => listen('widget:reset', listener),
    onSelectTab: (listener: (tab: string) => void) => listen('main:select-tab', listener)
  }
}

export type NaviBridge = typeof api

contextBridge.exposeInMainWorld('navi', api)
