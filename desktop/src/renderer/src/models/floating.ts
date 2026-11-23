import { Observable } from '@/lib/observable'
import { addMinutes, format, isSameDay, startOfDay } from '@/lib/dates'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TodoStore } from '@/data/backend'
import { makeEdgeServices, type EdgeServices } from '@/data/edge'
import type { DashboardEvent, DashboardTodo, MailMessage, NaviCategory, NewEventDraft } from '@/data/types'

/// A briefing mail in the floating widget: the message plus the short lines the widget shows
/// and the event the assistant suggests from it.
export interface FloatingMail {
  id: string
  message: MailMessage
  briefTitle: string
  actionNote: string
  suggestedEvent?: string
}

export type FloatingScreen =
  | { kind: 'home' }
  | { kind: 'mails' }
  | { kind: 'mailDetail'; id: string }
  | { kind: 'events' }
  | { kind: 'eventDetail'; id: string }
  /** New-event form; from a mail's "일정에 추가" it is prefilled and returns to that mail. */
  | { kind: 'newEvent'; fromMail?: string }
  | { kind: 'todos' }
  | { kind: 'todoDetail'; id: string }
  | { kind: 'deadline'; id: string }

/// State for the floating mini widget, backed by the same services as the main window.
export class FloatingWidgetModel extends Observable {
  screen: FloatingScreen = { kind: 'home' }
  /** Whether the panel is showing above the mascot; tapping the mascot toggles it. */
  isPanelOpen = true
  userName = ''
  mails: FloatingMail[] = []
  events: DashboardEvent[] = []
  todos: DashboardTodo[] = []
  todoCategories: NaviCategory[] = []
  calendarCategories: NaviCategory[] = []
  isLoading = false
  loadError: string | null = null
  addedTodoMailIDs = new Set<string>()
  addedEventMailIDs = new Set<string>()
  private store: TodoStore | null = null
  private services: EdgeServices | null = null
  private userID: string | null = null
  private loadVersion = 0

  connect(client: SupabaseClient, userID: string): void {
    if (this.userID === userID) return
    this.loadVersion++
    this.mails = []
    this.events = []
    this.todos = []
    this.todoCategories = []
    this.calendarCategories = []
    this.screen = { kind: 'home' }
    this.userID = userID
    this.store = new TodoStore(client, userID)
    this.services = makeEdgeServices(client, userID)
    void this.load()
  }

  clear(): void {
    this.loadVersion++
    this.userID = null
    this.store = null
    this.services = null
    this.mails = []
    this.events = []
    this.todos = []
    this.todoCategories = []
    this.calendarCategories = []
    this.userName = ''
    this.isLoading = false
    this.loadError = null
    this.changed()
  }

  async load(): Promise<void> {
    if (!this.store || !this.services) return
    const loadingFor = this.userID
    const version = ++this.loadVersion
    this.isLoading = true
    this.loadError = null
    this.changed()
    const [mails, events, todos, todoCategories, calendarCategories] = await Promise.allSettled([
      this.services.mail.inbox(),
      this.services.calendar.todayBriefing(),
      this.store.todayTodos(),
      this.store.todoCategories(),
      this.store.calendarCategories()
    ])
    if (this.userID !== loadingFor || this.loadVersion !== version) return
    if (mails.status === 'fulfilled') {
      this.mails = mails.value.slice(0, 3).map((message) => ({
        id: message.id,
        message,
        briefTitle: message.subject,
        actionNote: message.body.replace(/\s+/g, ' ').slice(0, 90)
      }))
    } else this.mails = []
    this.events = events.status === 'fulfilled' ? events.value : []
    this.todos = todos.status === 'fulfilled' ? todos.value : []
    this.todoCategories = todoCategories.status === 'fulfilled' ? todoCategories.value : []
    this.calendarCategories = calendarCategories.status === 'fulfilled' ? calendarCategories.value : []
    if ([mails, events, todos, todoCategories, calendarCategories].some((result) => result.status === 'rejected')) {
      this.loadError = '일부 정보를 불러오지 못했어요. 다시 열어 새로고침해 주세요.'
    }
    this.isLoading = false
    this.changed()
  }

  setScreen(screen: FloatingScreen): void {
    this.screen = screen
    this.changed()
  }

  setPanelOpen(isOpen: boolean): void {
    this.isPanelOpen = isOpen
    this.changed()
  }

  setUserName(name: string): void {
    this.userName = name
    this.changed()
  }

  reset(): void {
    this.screen = { kind: 'home' }
    this.isPanelOpen = true
    this.changed()
    void this.load()
  }

  // MARK: - Lookups

  mail = (id: string) => this.mails.find((m) => m.id === id)
  event = (id: string) => this.events.find((e) => e.id === id)
  todo = (id: string) => this.todos.find((t) => t.id === id)

  get sortedEvents(): DashboardEvent[] {
    return [...this.events].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  }

  get nextEvent(): DashboardEvent | undefined {
    return this.sortedEvents.find((e) => e.endAt > new Date())
  }

  get openTodos(): DashboardTodo[] {
    return this.todos.filter((t) => !t.isDone)
  }

  // MARK: - Todos

  private update(id: string, change: (todo: DashboardTodo) => DashboardTodo): void {
    this.todos = this.todos.map((t) => (t.id === id ? change(t) : t))
    this.changed()
  }

  toggleTodo(id: string): void {
    const todo = this.todo(id)
    if (!todo) return
    this.update(id, (t) => ({ ...t, isDone: !t.isDone }))
    void this.store?.setTodo(id, !todo.isDone).catch(() => this.failedSave())
  }

  renameTodo(id: string, title: string): void {
    const trimmed = title.trim()
    if (!trimmed || this.todo(id)?.title === trimmed) return
    this.update(id, (t) => ({ ...t, title: trimmed }))
    this.saveTodo(id)
  }

  setCategory(category: NaviCategory | undefined, id: string): void {
    this.update(id, (t) => ({ ...t, category }))
    this.saveTodo(id)
  }

  setDue(date: Date, id: string): void {
    this.update(id, (t) => ({ ...t, dueAt: date, day: startOfDay(date) }))
    this.saveTodo(id)
  }

  async addTodo(title: string, category: NaviCategory | undefined, dueAt: Date | undefined, source: DashboardTodo['source'] = 'manual'): Promise<boolean> {
    const trimmed = title.trim()
    if (!trimmed || !this.store) return false
    const todo: DashboardTodo = { id: crypto.randomUUID(), title: trimmed, isDone: false, category, dueAt, source,
      orderIndex: Math.max(0, ...this.todos.map((t) => t.orderIndex)) + 1, subtasks: [], day: startOfDay(dueAt ?? new Date()) }
    try {
      await this.store.createTodo(todo, todo.day!)
    } catch {
      this.failedSave()
      return false
    }
    this.todos = [...this.todos, todo]
    this.changed()
    return true
  }

  toggleSubtask(subtaskID: string, id: string): void {
    const subtask = this.todo(id)?.subtasks.find((item) => item.id === subtaskID)
    if (!subtask) return
    this.update(id, (t) => withProgress({ ...t, subtasks: t.subtasks.map((s) => (s.id === subtaskID ? { ...s, isDone: !s.isDone } : s)) }))
    void this.store?.setTodo(subtaskID, !subtask.isDone).catch(() => this.failedSave())
  }

  addSubtask(title: string, id: string): void {
    const trimmed = title.trim()
    if (!trimmed) return
    const subtask = { id: crypto.randomUUID(), title: trimmed, isDone: false }
    this.update(id, (t) => withProgress({ ...t, subtasks: [...t.subtasks, subtask] }))
    void this.store?.createSubtask(subtask, id, this.todo(id)?.day ?? new Date()).catch(() => this.failedSave())
  }

  private saveTodo(id: string): void {
    const todo = this.todo(id)
    if (!todo) return
    void this.store?.updateTodo(id, todo.title, todo.dueAt, todo.day ?? startOfDay(new Date()), todo.category?.id).catch(() => this.failedSave())
  }

  private failedSave(): void {
    void this.load().then(() => {
      this.loadError = '변경 사항을 저장하지 못했어요.'
      this.changed()
    })
  }

  /// Default due time for the inline "할 일 추가" row: the next full hour today.
  get newTodoDueAt(): Date {
    const now = new Date()
    const next = new Date(now)
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    return isSameDay(next, now) ? next : now
  }

  // MARK: - Events

  async saveEvent(draft: NewEventDraft, id?: string): Promise<void> {
    const service = this.services?.calendar
    if (!service) throw new Error('일정 서비스에 연결되지 않았어요.')
    const old = id ? this.event(id) : undefined
    const event = old ? await service.update(id!, old, draft) : await service.create(draft)
    this.events = this.events.some((e) => e.id === event.id)
      ? this.events.map((e) => (e.id === event.id ? event : e))
      : [...this.events, event]
    this.changed()
  }

  draft(event: DashboardEvent): NewEventDraft {
    return { title: event.title, category: event.category, startAt: event.startAt, endAt: event.endAt, location: event.location ?? '' }
  }

  newEventDraft(fromMail?: string): NewEventDraft {
    const start = this.newTodoDueAt
    return {
      title: (fromMail && this.mail(fromMail)?.suggestedEvent) || '',
      category: this.calendarCategories[0],
      startAt: start,
      endAt: addMinutes(start, 60),
      location: ''
    }
  }

  // MARK: - Mail actions

  async addSuggestedTodo(mailID: string): Promise<void> {
    const title = this.mail(mailID)?.message.suggestedTodo
    if (!title || this.addedTodoMailIDs.has(mailID)) return
    if (!await this.addTodo(title, this.todoCategories[0], undefined, 'mail_suggestion')) return
    this.addedTodoMailIDs = new Set(this.addedTodoMailIDs).add(mailID)
    this.changed()
  }

  /// Called after the prefilled new-event form from a mail's "일정에 추가" is saved.
  markEventAdded(mailID: string): void {
    this.addedEventMailIDs = new Set(this.addedEventMailIDs).add(mailID)
    this.changed()
  }

  /// "9월 15일, 화요일"
  static dayTitle(date = new Date()): string {
    return format(date, 'M월 d일, EEEE')
  }

  /// "오전 9:00"
  static time(date: Date): string {
    return format(date, 'a h:mm')
  }
}

function withProgress(todo: DashboardTodo): DashboardTodo {
  const subtasks = todo.subtasks
  return {
    ...todo,
    subtaskProgress: subtasks.length ? { done: subtasks.filter((s) => s.isDone).length, total: subtasks.length } : undefined
  }
}
