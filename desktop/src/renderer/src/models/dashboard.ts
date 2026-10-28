import { Observable } from '@/lib/observable'
import { addMinutes, isToday, nextHour } from '@/lib/dates'
import type { TodoOrderUpdate, TodoStore } from '@/data/backend'
import { isServerError, type EdgeServices } from '@/data/edge'
import type { DashboardEvent, DashboardMail, DashboardTodo, NaviCategory, NewEventDraft, NewTodoDraft } from '@/data/types'

/// Dashboard data (`DashboardModel` in Swift). Todos and categories come from Supabase through
/// `store`; important mail and today's events through the `mail` / `calendar` Edge Functions.
/// Failures show as `errorMessage`; nothing is filled in with sample data.
export class DashboardModel extends Observable {
  todos: DashboardTodo[] = []
  importantMails: DashboardMail[] = []
  todayEvents: DashboardEvent[] = []
  todoCategories: NaviCategory[] = []
  calendarCategories: NaviCategory[] = []
  isLoadingTodos = false
  /** Last failed load or save, shown under the todo list. */
  errorMessage: string | null = null

  constructor(
    private store: TodoStore | null,
    private services: EdgeServices | null
  ) {
    super()
  }

  get completedTodoCount(): number {
    return this.todos.filter((t) => t.isDone).length
  }

  /// Loads today's todos, both category lists, important mail, and today's events.
  async load(): Promise<void> {
    this.errorMessage = null
    this.changed()
    await Promise.all([this.loadBriefing(), this.loadTodos()])
  }

  /// `mail/briefing?date=today` and `calendar/briefing/today`.
  private async loadBriefing(): Promise<void> {
    if (!this.services) return
    const [mails, events] = await Promise.allSettled([
      this.services.mail.importantMails(new Date()),
      this.services.calendar.todayBriefing()
    ])
    if (mails.status === 'fulfilled') this.importantMails = mails.value
    else {
      this.importantMails = []
      this.report(mails.reason, '중요 메일을 불러오지 못했어요.')
    }
    if (events.status === 'fulfilled') this.todayEvents = events.value
    else {
      this.todayEvents = []
      this.report(events.reason, '오늘 일정을 불러오지 못했어요.')
    }
    this.changed()
  }

  /// Not having connected Google yet is shown by the connect cards, not as an error.
  private report(error: unknown, message: string): void {
    if (isServerError(error, 'GOOGLE_NOT_CONNECTED')) return
    this.errorMessage = message
  }

  private async loadTodos(): Promise<void> {
    if (!this.store) return
    this.isLoadingTodos = true
    this.changed()
    try {
      const [todos, todoCategories, calendarCategories] = await Promise.all([
        this.store.todayTodos(),
        this.store.todoCategories(),
        this.store.calendarCategories()
      ])
      this.todos = todos
      this.todoCategories = todoCategories
      this.calendarCategories = calendarCategories
    } catch {
      this.errorMessage = '할 일을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
    } finally {
      this.isLoadingTodos = false
      this.changed()
    }
  }

  /// Optimistic toggle; reverted if the update fails.
  toggleTodo(id: string): void {
    const todo = this.todos.find((t) => t.id === id)
    if (!todo) return
    const isDone = !todo.isDone
    this.todos = this.todos.map((t) => (t.id === id ? { ...t, isDone } : t))
    this.changed()
    this.store?.setTodo(id, isDone).catch(() => {
      this.todos = this.todos.map((t) => (t.id === id ? { ...t, isDone: !isDone } : t))
      this.errorMessage = '할 일 상태를 저장하지 못했어요.'
      this.changed()
    })
  }

  /// Drag-and-drop reorder: the dragged todo takes the drop target's position. Only the moved
  /// row gets a new `order_index` (midway between its neighbors); the whole list is renumbered
  /// when the gap gets too small to split.
  moveTodo(id: string, targetID: string): void {
    const from = this.todos.findIndex((t) => t.id === id)
    const to = this.todos.findIndex((t) => t.id === targetID)
    if (id === targetID || from < 0 || to < 0) return

    const previous = this.todos
    const reordered = [...this.todos]
    const [todo] = reordered.splice(from, 1)
    reordered.splice(to, 0, { ...todo })

    const before = to > 0 ? reordered[to - 1].orderIndex : undefined
    const after = to < reordered.length - 1 ? reordered[to + 1].orderIndex : undefined
    let updates: TodoOrderUpdate[]
    if (before !== undefined && after !== undefined && after - before > 1e-6) {
      reordered[to].orderIndex = (before + after) / 2
      updates = [{ id, order_index: reordered[to].orderIndex }]
    } else if (before !== undefined && after === undefined) {
      reordered[to].orderIndex = before + 1
      updates = [{ id, order_index: reordered[to].orderIndex }]
    } else if (before === undefined && after !== undefined) {
      reordered[to].orderIndex = after - 1
      updates = [{ id, order_index: reordered[to].orderIndex }]
    } else {
      reordered.forEach((t, index) => {
        reordered[index] = { ...t, orderIndex: index + 1 }
      })
      updates = reordered.map((t) => ({ id: t.id, order_index: t.orderIndex }))
    }
    this.todos = reordered
    this.changed()

    this.store?.reorder(updates).catch(() => {
      this.todos = previous
      this.errorMessage = '순서를 저장하지 못했어요. 다시 시도해 주세요.'
      this.changed()
    })
  }

  makeTodoDraft(): NewTodoDraft {
    return { title: '', dueAt: nextHour() }
  }

  makeEventDraft(): NewEventDraft {
    const start = nextHour()
    return { title: '', category: this.calendarCategories[0], startAt: start, endAt: addMinutes(start, 60), location: '' }
  }

  /// Saves a manual todo and returns it. It's listed under its due day (`todos.date`), so it
  /// joins "오늘 할 일" only when due today.
  async addTodo(draft: NewTodoDraft): Promise<DashboardTodo> {
    const todo: DashboardTodo = {
      id: crypto.randomUUID(),
      title: draft.title.trim(),
      isDone: false,
      category: draft.category,
      dueAt: draft.dueAt,
      source: 'manual',
      orderIndex: Math.max(0, ...this.todos.map((t) => t.orderIndex)) + 1,
      subtasks: []
    }
    await this.store?.createTodo(todo, draft.dueAt)
    if (isToday(draft.dueAt)) {
      this.todos = [...this.todos, todo]
      this.changed()
    }
    return todo
  }

  /// Adds an event (`POST calendar/events`, which writes Google Calendar and the cache). It
  /// joins "오늘 일정" only when it starts today.
  async addEvent(draft: NewEventDraft): Promise<DashboardEvent> {
    const location = draft.location.trim()
    const event = this.services
      ? await this.services.calendar.create(draft)
      : {
          id: crypto.randomUUID(),
          title: draft.title.trim(),
          startAt: draft.startAt,
          endAt: draft.endAt,
          isAllDay: false,
          category: draft.category,
          location: location || undefined
        }
    if (isToday(draft.startAt)) {
      this.todayEvents = [...this.todayEvents, event].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      this.changed()
    }
    return event
  }
}
