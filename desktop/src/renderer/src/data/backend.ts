import type { SupabaseClient } from '@supabase/supabase-js'
import { dayString, parseDate, parseDay } from '@/lib/dates'
import type { DashboardTodo, NaviCategory, NotificationPreferences, TodoSource, TodoSubtask } from './types'

// Supabase-backed data access for the main window (Notion "API 명세": TABLE / RPC / AUTH-SDK
// rows). Mail, calendar events, the assistant, and Google disconnect go through the Edge
// Functions in `edge.ts`.

/// Throws the PostgREST error of a supabase-js result, or returns its data.
export async function unwrap<T = unknown>(request: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await request
  if (error) throw error
  return data as T
}

// MARK: - Todos

/// One `reorder_todos` item.
export interface TodoOrderUpdate {
  id: string
  order_index: number
}

interface CategoryRow {
  id: string
  name: string
  color: string
}

/// One item of the `get_todos` JSON array.
interface TodoRow {
  id: string
  title: string
  status: string
  date: string
  due_at: string | null
  source: string
  order_index: number
  category: CategoryRow | null
  children: { id: string; title: string; status: string }[] | null
}

const toSource = (value: string): TodoSource =>
  value === 'mail_suggestion' || value === 'calendar_suggestion' || value === 'subdivision' ? value : 'manual'

function toTodo(row: TodoRow): DashboardTodo {
  const children = row.children ?? []
  const subtasks: TodoSubtask[] = children.map((child) => ({
    id: child.id,
    title: child.title,
    isDone: child.status === 'done'
  }))
  return {
    id: row.id,
    title: row.title,
    isDone: row.status === 'done',
    category: row.category ?? undefined,
    dueAt: parseDate(row.due_at),
    source: toSource(row.source),
    subtaskProgress: children.length
      ? { done: subtasks.filter((s) => s.isDone).length, total: subtasks.length }
      : undefined,
    orderIndex: row.order_index,
    subtasks,
    day: parseDay(row.date)
  }
}

/// What the tabs need from the todo backend (`TodoStore` in Swift).
export class TodoStore {
  constructor(
    private client: SupabaseClient,
    private userID: string
  ) {}

  /// `get_todos(filter => 'today')`: the caller's top-level todos for today (users.timezone),
  /// each with its category and children.
  async todayTodos(): Promise<DashboardTodo[]> {
    const rows = await unwrap<TodoRow[]>(this.client.rpc('get_todos', { filter: 'today' }))
    return (rows ?? []).map(toTodo)
  }

  /// Every top-level todo (`get_todos(filter => 'all')`); the todo tab groups them by deadline.
  async allTodos(): Promise<DashboardTodo[]> {
    const rows = await unwrap<TodoRow[]>(this.client.rpc('get_todos', { filter: 'all' }))
    return (rows ?? []).map(toTodo)
  }

  todoCategories(): Promise<NaviCategory[]> {
    return this.categories('todo_categories')
  }

  calendarCategories(): Promise<NaviCategory[]> {
    return this.categories('calendar_categories')
  }

  /// TABLE insert with the app-generated id; `due_at` / `category_id` go as JSON null.
  async createTodo(todo: DashboardTodo, day: Date): Promise<void> {
    await unwrap(
      this.client.from('todos').insert({
        id: todo.id,
        user_id: this.userID,
        title: todo.title,
        date: dayString(day),
        due_at: todo.dueAt?.toISOString() ?? null,
        category_id: todo.category?.id ?? null,
        order_index: todo.orderIndex,
        source: todo.source
      })
    )
  }

  /// A child row (`source = 'subdivision'`, `parent_id`); the parent's status follows its
  /// children through the DB trigger.
  async createSubtask(subtask: TodoSubtask, parentID: string, day: Date): Promise<void> {
    await unwrap(
      this.client.from('todos').insert({
        id: subtask.id,
        user_id: this.userID,
        parent_id: parentID,
        title: subtask.title,
        date: dayString(day),
        source: 'subdivision'
      })
    )
  }

  /// Column-limited UPDATE (title, date, due_at, category_id).
  async updateTodo(id: string, title: string, dueAt: Date | undefined, day: Date, categoryID: string | undefined): Promise<void> {
    await unwrap(
      this.client
        .from('todos')
        .update({ title, date: dayString(day), due_at: dueAt?.toISOString() ?? null, category_id: categoryID ?? null })
        .eq('id', id)
    )
  }

  /// Parent auto-complete / reopen is a DB trigger; the app only flips this row.
  async setTodo(id: string, isDone: boolean): Promise<void> {
    await unwrap(this.client.from('todos').update({ status: isDone ? 'done' : 'active' }).eq('id', id))
  }

  async reorder(items: TodoOrderUpdate[]): Promise<void> {
    await unwrap(this.client.rpc('reorder_todos', { items }))
  }

  /// TABLE insert with the app-generated id; name/color rules are DB CHECKs.
  async createTodoCategory(category: NaviCategory): Promise<void> {
    await unwrap(this.client.from('todo_categories').insert({ ...category, user_id: this.userID }))
  }

  /// `calendar_categories` with `is_visible` (hidden categories are filtered out of the calendar).
  async calendarCategoryVisibility(): Promise<{ category: NaviCategory; isVisible: boolean }[]> {
    const rows = await unwrap<(CategoryRow & { is_visible: boolean })[]>(
      this.client.from('calendar_categories').select('id,name,color,is_visible').order('created_at')
    )
    return (rows ?? []).map(({ is_visible, ...category }) => ({ category, isVisible: is_visible }))
  }

  async createCalendarCategory(category: NaviCategory): Promise<void> {
    await unwrap(this.client.from('calendar_categories').insert({ ...category, user_id: this.userID }))
  }

  async setCalendarCategory(id: string, isVisible: boolean): Promise<void> {
    await unwrap(this.client.from('calendar_categories').update({ is_visible: isVisible }).eq('id', id))
  }

  private async categories(table: string): Promise<NaviCategory[]> {
    const rows = await unwrap<CategoryRow[]>(this.client.from(table).select('id,name,color').order('created_at'))
    return rows ?? []
  }
}

// MARK: - Notification settings

const NOTIFICATION_COLUMNS =
  'new_mail_enabled,calendar_reminder_enabled,mail_send_confirmation_enabled,calendar_approval_enabled,alert_snooze_minutes'

interface NotificationSettingsRow {
  new_mail_enabled: boolean
  calendar_reminder_enabled: boolean
  mail_send_confirmation_enabled: boolean
  calendar_approval_enabled: boolean
  alert_snooze_minutes: number
}

/// `notification_settings` TABLE: SELECT and column-limited UPDATE of the caller's row
/// (the row is created by the account bootstrap trigger).
export class NotificationSettingsStore {
  constructor(
    private client: SupabaseClient,
    private userID: string
  ) {}

  async load(): Promise<NotificationPreferences> {
    const row = await unwrap<NotificationSettingsRow>(
      this.client.from('notification_settings').select(NOTIFICATION_COLUMNS).eq('user_id', this.userID).single()
    )
    return {
      newMail: row.new_mail_enabled,
      calendarReminder: row.calendar_reminder_enabled,
      mailSendConfirmation: row.mail_send_confirmation_enabled,
      calendarApproval: row.calendar_approval_enabled,
      snoozeMinutes: row.alert_snooze_minutes
    }
  }

  async save(preferences: NotificationPreferences): Promise<void> {
    const row: NotificationSettingsRow = {
      new_mail_enabled: preferences.newMail,
      calendar_reminder_enabled: preferences.calendarReminder,
      mail_send_confirmation_enabled: preferences.mailSendConfirmation,
      calendar_approval_enabled: preferences.calendarApproval,
      alert_snooze_minutes: preferences.snoozeMinutes
    }
    await unwrap(this.client.from('notification_settings').update(row).eq('user_id', this.userID))
  }
}

// MARK: - Account (Auth SDK)

export class AccountError extends Error {}

/// Profile name and password changes. No HTTP endpoints: both are Supabase Auth SDK calls.
export class AccountService {
  constructor(private client: SupabaseClient) {}

  /// `auth.updateUser({data: {navi_name}})`
  async updateDisplayName(name: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ data: { navi_name: name } })
    if (error) throw error
  }

  /// Re-checks the current password with `signInWithPassword`, then `updateUser(password:)`.
  async changePassword(email: string, current: string, next: string): Promise<void> {
    if (!email) throw new AccountError('이메일 로그인 계정에서만 비밀번호를 바꿀 수 있어요.')
    const { error: signInError } = await this.client.auth.signInWithPassword({ email, password: current })
    if (signInError) {
      if (signInError.code === 'invalid_credentials') throw new AccountError('현재 비밀번호가 올바르지 않아요.')
      throw signInError
    }
    const { error } = await this.client.auth.updateUser({ password: next })
    if (error) throw error
  }
}
