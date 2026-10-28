import { useEffect, useState } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import type { SessionStore } from '@/data/session'
import type { MailDraft } from '@/data/types'
import { SettingsModel } from '@/models/settings'
import { DashboardModel } from '@/models/dashboard'
import { TodoTabModel } from '@/models/todo'
import { CalendarTabModel } from '@/models/calendar'
import { MailTabModel } from '@/models/mail'
import { ChatTabModel } from '@/models/chat'
import { AssistantPromptModel } from '@/models/prompt'
import { PromptContext } from '@/components/AssistantPrompt'
import { NaviIcon, NaviImage, Spacer } from '@/components/core'
import { DashboardView } from './dashboard/DashboardView'
import { SettingsView } from './settings/SettingsView'
import { ServiceConnectFlow, type ConnectStep } from './ServiceConnectFlow'
import { TodoTabView } from './todo/TodoTabView'
import { CalendarTabView } from './calendar/CalendarTabView'
import { MailTabView } from './mail/MailTabView'
import { ChatTabView } from './chat/ChatTabView'
import {
  CategoryDialog,
  GoogleDisconnectDialog,
  MailResultDialog,
  PasswordChangeDialog,
  PrepLoadingDialog,
  PrepNoDataDialog
} from './Dialogs'

/// Window-wide modal dialogs, shown over a dimmed scrim.
export type MainDialog =
  | { kind: 'passwordChange' }
  | { kind: 'googleDisconnect' }
  | { kind: 'newTodoCategory' }
  | { kind: 'newCalendarCategory' }
  | { kind: 'calendarPrepLoading' }
  | { kind: 'calendarPrepNoData' }
  | { kind: 'mailSent'; draft: MailDraft }
  | { kind: 'mailDraftSaved'; draft: MailDraft }

/// Top-level destinations of the main window sidebar.
export type MainTab = 'dashboard' | 'mail' | 'calendar' | 'todo' | 'chat' | 'settings'

const TAB_TITLES: Record<MainTab, string> = {
  dashboard: '대시보드',
  mail: '메일',
  calendar: '일정',
  todo: '할 일',
  chat: '채팅',
  settings: '설정'
}

/// Figma sidebar icons; each SVG keeps its own artboard size, centered in the 15×15 slot.
const SIDEBAR_ICONS: Record<MainTab | 'toggle', { name: string; width: number; height: number }> = {
  dashboard: { name: 'SidebarDashboard', width: 12.25, height: 12.25 },
  mail: { name: 'SidebarMail', width: 15, height: 15 },
  calendar: { name: 'SidebarCalendar', width: 13.35, height: 12.69 },
  todo: { name: 'SidebarTodo', width: 15, height: 15 },
  chat: { name: 'SidebarChat', width: 15, height: 15 },
  settings: { name: 'SidebarSettings', width: 12.6, height: 14 },
  toggle: { name: 'SidebarToggle', width: 13, height: 12 }
}

const PRIMARY_TABS: MainTab[] = ['dashboard', 'mail', 'calendar', 'todo', 'chat']
const isTab = (value: string): value is MainTab => value in TAB_TITLES

/// The models a signed-in main window owns (SwiftUI `@StateObject`s of `MainWindowView`).
function makeModels(store: SessionStore) {
  const settings = new SettingsModel(store)
  const todoStore = store.makeTodoStore()
  const services = store.makeEdgeServices()
  const dashboard = new DashboardModel(todoStore, services)
  const todo = new TodoTabModel(todoStore, services)
  const calendar = new CalendarTabModel(todoStore, services, todo)
  const mail = new MailTabModel(todo, services, settings.services.googleEmail ?? settings.loginEmail, settings.name)
  const chat = new ChatTabModel(todo, services)
  const prompt = new AssistantPromptModel(services?.assistant ?? null, async () => {
    // Claude may have added todos from a prompt.
    await todo.load()
    await dashboard.load()
  })
  return { settings, dashboard, todo, calendar, mail, chat, prompt }
}

/// Main window shell: a white sidebar card on the left and the selected screen on the right
/// (Figma "App screen").
export function MainWindow({ store, onSignOut, onResetOnboarding }: {
  store: SessionStore
  onSignOut: () => void
  onResetOnboarding: () => void
}) {
  const [models] = useState(() => makeModels(store))
  const settings = useModel(models.settings)
  const [selection, setSelection] = useState<MainTab>('dashboard')
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeDialog, setActiveDialog] = useState<MainDialog | null>(null)
  const [mailConnectStep, setMailConnectStep] = useState<ConnectStep>('prompt')
  const [calendarConnectStep, setCalendarConnectStep] = useState<ConnectStep>('prompt')

  // Sign-out is also in the app menu (see the main process's `buildMenu`).
  useEffect(() => window.navi.onMenuSignOut(onSignOut), [onSignOut])
  useEffect(() => window.navi.onMenuResetOnboarding(onResetOnboarding), [onResetOnboarding])
  // The widget's expand / "main window only" actions pick a tab.
  useEffect(() => window.navi.widget.onSelectTab((tab) => isTab(tab) && setSelection(tab)), [])
  useEffect(() => () => models.chat.dispose(), [models])

  // The prep dialog stays up for the todo-ai request, and at least long enough to read its steps.
  useEffect(() => {
    if (activeDialog?.kind !== 'calendarPrepLoading') return
    let cancelled = false
    ;(async () => {
      const [hasSuggestions] = await Promise.all([
        models.calendar.generateSuggestions(),
        new Promise((resolve) => setTimeout(resolve, 1200))
      ])
      if (cancelled) return
      setActiveDialog((current) =>
        current?.kind === 'calendarPrepLoading' ? (hasSuggestions ? null : { kind: 'calendarPrepNoData' }) : current
      )
    })()
    return () => {
      cancelled = true
    }
  }, [activeDialog?.kind, models])

  const close = () => setActiveDialog(null)

  const dialog = (() => {
    if (!activeDialog) return null
    switch (activeDialog.kind) {
      case 'passwordChange':
        return <PasswordChangeDialog model={models.settings} onDismiss={close} />
      case 'googleDisconnect':
        return <GoogleDisconnectDialog model={models.settings} onDismiss={close} />
      case 'newTodoCategory':
        return <CategoryDialog onCancel={close} onAdd={(name, color) => models.todo.addCategory(name, color)} />
      case 'newCalendarCategory':
        return <CategoryDialog onCancel={close} onAdd={(name, color) => models.calendar.addCategory(name, color)} />
      case 'calendarPrepLoading':
        return <PrepLoadingDialog onCancel={close} />
      case 'calendarPrepNoData':
        return (
          <PrepNoDataDialog
            onSetCriteria={() => {
              models.calendar.set('panel', { kind: 'prepCriteria' })
              close()
            }}
            onDismiss={close}
          />
        )
      case 'mailSent':
      case 'mailDraftSaved':
        return (
          <MailResultDialog
            draft={activeDialog.draft}
            isSent={activeDialog.kind === 'mailSent'}
            onClose={() => {
              models.mail.set('filter', { kind: 'all' })
              close()
            }}
          />
        )
    }
  })()

  const content = (() => {
    switch (selection) {
      case 'dashboard':
        return (
          <DashboardView
            model={models.dashboard}
            settingsModel={models.settings}
            onSelectTab={setSelection}
            onConnect={(service) => {
              // The dashboard card already asked to connect, so skip the tab's prompt.
              if (service === 'mail') setMailConnectStep('chooser')
              else setCalendarConnectStep('chooser')
              setSelection(service)
            }}
          />
        )
      case 'settings':
        return <SettingsView model={models.settings} onDialog={setActiveDialog} onSignOut={onSignOut} />
      case 'mail':
        // The flow stays up after connecting so its "연동 완료" screen can show.
        if (!settings.services.mailConnected || mailConnectStep === 'success') {
          return (
            <ServiceConnectFlow
              service="mail"
              model={models.settings}
              step={mailConnectStep}
              setStep={setMailConnectStep}
              onFinish={() => setMailConnectStep('prompt')}
            />
          )
        }
        return <MailTabView model={models.mail} onDialog={setActiveDialog} />
      case 'calendar':
        if (!settings.services.calendarConnected || calendarConnectStep === 'success') {
          return (
            <ServiceConnectFlow
              service="calendar"
              model={models.settings}
              step={calendarConnectStep}
              setStep={setCalendarConnectStep}
              onFinish={() => setCalendarConnectStep('prompt')}
            />
          )
        }
        return (
          <CalendarTabView
            model={models.calendar}
            onAddCategory={() => setActiveDialog({ kind: 'newCalendarCategory' })}
            onStartPrep={() => setActiveDialog({ kind: 'calendarPrepLoading' })}
          />
        )
      case 'todo':
        return <TodoTabView model={models.todo} onAddCategory={() => setActiveDialog({ kind: 'newTodoCategory' })} />
      case 'chat':
        return <ChatTabView model={models.chat} />
    }
  })()

  return (
    <PromptContext.Provider value={models.prompt}>
      <div style={{ display: 'flex', gap: 10, padding: '10px 15px', height: '100%', background: T.canvas, position: 'relative' }}>
        <Sidebar selection={selection} onSelect={setSelection} isCollapsed={isSidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />
        <main style={{ flex: 1, minWidth: 0, padding: '0 10px', display: 'flex', flexDirection: 'column' }}>{content}</main>

        {/* Dialogs dim the whole window (sidebar included), per the Figma scrim. */}
        {dialog && (
          <div
            className="fade-in"
            onClick={close}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.32)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100
            }}
          >
            {dialog}
          </div>
        )}
      </div>
    </PromptContext.Provider>
  )
}

function Sidebar({ selection, onSelect, isCollapsed, onToggle }: {
  selection: MainTab
  onSelect: (tab: MainTab) => void
  isCollapsed: boolean
  onToggle: () => void
}) {
  const item = (key: MainTab | 'toggle', title: string, isSelected: boolean, onClick: () => void) => {
    const icon = SIDEBAR_ICONS[key]
    return (
      <button
        key={key}
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={isSelected}
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'flex-start',
          gap: 10,
          padding: '10px 20px',
          width: '100%',
          borderRadius: 10,
          color: isSelected ? T.cardWhite : T.grayText,
          background: isSelected ? T.purple : 'transparent'
        }}
      >
        <span style={{ width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <NaviIcon name={icon.name} width={icon.width} height={icon.height} />
        </span>
        {!isCollapsed && (
          <span className="truncate" style={F.paperlogy(12, isSelected ? 'bold' : 'regular')}>
            {title}
          </span>
        )}
      </button>
    )
  }

  return (
    <nav
      style={{
        // Figma "Sidebar" component: 175pt expanded, 85pt collapsed.
        width: isCollapsed ? 85 : 175,
        transition: 'width 0.2s ease-in-out',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: '20px 15px',
        background: T.cardWhite,
        borderRadius: 15,
        overflow: 'hidden'
      }}
    >
      <div aria-label="navi" style={{ display: 'flex', alignItems: 'center', gap: 9.7, justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
        <NaviImage name="LogoMark" width={30} height={30} />
        {!isCollapsed && <NaviImage name="LogoWordmark" width={58} height={18.4} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {PRIMARY_TABS.map((tab) => item(tab, TAB_TITLES[tab], selection === tab, () => onSelect(tab)))}
      </div>
      <Spacer />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {item('toggle', isCollapsed ? '사이드바 열기' : '사이드바 숨김', false, onToggle)}
        {item('settings', TAB_TITLES.settings, selection === 'settings', () => onSelect('settings'))}
      </div>
    </nav>
  )
}
