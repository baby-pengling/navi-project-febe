// The app's screen types (Swift: DashboardModel.swift, MailTabModel.swift, ChatTabModel.swift,
// TodoTabModel.swift). Wire formats stay in `backend.ts` / `edge.ts`.

/// `{id,name,color}` category object returned with todos and calendar events. Colors are
/// chosen by the user (`todo_categories.color` / `calendar_categories.color`).
export interface NaviCategory {
  id: string
  name: string
  /** `#RRGGBB` */
  color: string
}

export type TodoSource = 'manual' | 'mail_suggestion' | 'calendar_suggestion' | 'subdivision'

export interface TodoSubtask {
  id: string
  title: string
  isDone: boolean
}

export interface SubtaskProgress {
  done: number
  total: number
}

/// Shape of a top-level row from `get_todos` (children are summarized as progress).
export interface DashboardTodo {
  id: string
  title: string
  isDone: boolean
  category?: NaviCategory
  dueAt?: Date
  source: TodoSource
  /** Completed / total subtasks; undefined when the todo has no children. */
  subtaskProgress?: SubtaskProgress
  /** `todos.order_index`: drag-and-drop order within the day. */
  orderIndex: number
  /** Child rows (`todos.parent_id`), shown in the todo detail panel. */
  subtasks: TodoSubtask[]
  /** `todos.date`: the day the todo is listed under. */
  day?: Date
}

export interface DashboardMail {
  id: string
  sender: string
  subject: string
  snippet: string
  receivedAt: Date
}

/// Shape of an `events[]` item from the `calendar` Edge Function.
export interface DashboardEvent {
  id: string
  title: string
  startAt: Date
  endAt: Date
  isAllDay: boolean
  category?: NaviCategory
  location?: string
}

/// Figma "10 - 할 일 > 새 할 일 추가" form.
export interface NewTodoDraft {
  title: string
  dueAt: Date
  category?: NaviCategory
}

/// Figma "09 - 일정 (주) > 새 일정" form.
export interface NewEventDraft {
  title: string
  category?: NaviCategory
  startAt: Date
  endAt: Date
  location: string
}

export const isTodoDraftValid = (draft: NewTodoDraft): boolean => draft.title.trim() !== ''
export const isEventDraftValid = (draft: NewEventDraft): boolean =>
  draft.title.trim() !== '' && draft.endAt > draft.startAt

/// A "이번 주 미리 준비" recommendation from `POST todo-ai/todos/suggest`.
export interface PrepSuggestion {
  id: string
  title: string
  dueAt: Date
  category?: NaviCategory
  /** "발표 2일 전" */
  reason: string
  /** "약 40분" */
  effort: string
  /** Shown in red ("마감 전날"). */
  isUrgent: boolean
  isSelected: boolean
}

export interface SummaryLine {
  lead?: string
  text: string
}

export interface MailPerson {
  name: string
  email: string
}

/// "김지민 <jimin@example.com>"
export const personDisplay = (person: MailPerson): string =>
  person.name ? `${person.name} <${person.email}>` : person.email

export interface MailMessage {
  id: string
  sender: MailPerson
  subject: string
  body: string
  receivedAt: Date
  isStarred: boolean
  /** Briefing category ("답장 대기", "요청·승인", …) used by the filter tabs. */
  category?: string
  /** AI summary bullets: bold lead + detail ("디자인 리뷰", "목요일 16:00"). */
  summary: SummaryLine[]
  suggestedTodo?: string
  replyDraft?: string
}

export const mailSnippet = (message: MailMessage): string => message.body.replace(/\n/g, ' ')

export interface MailDraft {
  id: string
  to: string
  subject: string
  body: string
  /** Set for replies. */
  replyTo?: string
  savedAt: Date
  /** Whether the draft exists in Gmail (`mail/drafts`), so saving PATCHes instead of POSTing. */
  isStored: boolean
}

export const newMailDraft = (fields: Partial<MailDraft> = {}): MailDraft => ({
  id: crypto.randomUUID(),
  to: '',
  subject: '',
  body: '',
  savedAt: new Date(),
  isStored: false,
  ...fields
})

export type ChatRole = 'user' | 'navi'

export interface ChatMessage {
  id: string
  role: ChatRole
  /** User text, or the bold lead line of a navi answer. */
  text: string
  /** Numbered lines under a navi answer ("12:00 전 — 사용자 인터뷰 질문 정리"). */
  items: string[]
  /** Plan lines "할 일에 추가" saves; empty hides the button. */
  suggestedTodos: string[]
  /** "참고한 정보" footer ("오늘 일정 3개 · 중요 메일 1개 · 미완료 할 일 3개"). */
  context?: string
}

export interface ChatSession {
  id: string
  title: string
  updatedAt: Date
  messages: ChatMessage[]
  /** Whether the row exists in `assistant_conversations`. */
  isStored: boolean
  hasLoadedMessages: boolean
}

/// Mirrors `notification_settings` (4 toggles + snooze interval).
export interface NotificationPreferences {
  newMail: boolean
  calendarReminder: boolean
  mailSendConfirmation: boolean
  calendarApproval: boolean
  /** DB CHECK allows 1…1440; the UI offers presets. */
  snoozeMinutes: number
}

export const defaultNotificationPreferences = (): NotificationPreferences => ({
  newMail: true,
  calendarReminder: true,
  mailSendConfirmation: true,
  calendarApproval: true,
  snoozeMinutes: 9
})

export const SNOOZE_PRESETS = [5, 9, 10, 15, 30, 60]

/// Mirrors the connection part of `v_account_profile`.
export interface ConnectedServices {
  googleEmail?: string
  mailConnected: boolean
  calendarConnected: boolean
}
