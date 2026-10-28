import { Observable } from '@/lib/observable'
import { addDays, format, isSameDay, nextHour, startOfDay, startOfWeek } from '@/lib/dates'
import type { TodoStore } from '@/data/backend'
import { edgeMessage, type EdgeServices } from '@/data/edge'
import type { DashboardTodo, NaviCategory, NewTodoDraft, PrepSuggestion, TodoSource } from '@/data/types'

export type TodoFilter = 'all' | 'today' | 'thisWeek' | 'overdue' | 'noDeadline'
export type TodoGroup = 'overdue' | 'today' | 'thisWeek' | 'later' | 'noDeadline'

export const TODO_FILTERS: TodoFilter[] = ['all', 'today', 'thisWeek', 'overdue', 'noDeadline']
export const filterTitle: Record<TodoFilter, string> = {
  all: '전체',
  today: '오늘',
  thisWeek: '이번 주',
  overdue: '기한 지남',
  noDeadline: '기한 없음'
}
export const groupTitle: Record<TodoGroup, string> = {
  overdue: '기한 지남',
  today: '오늘',
  thisWeek: '이번주',
  later: '이후',
  noDeadline: '기한 없음'
}
const ALL_GROUPS: TodoGroup[] = ['overdue', 'today', 'thisWeek', 'later', 'noDeadline']
const filterGroups: Record<TodoFilter, TodoGroup[]> = {
  all: ALL_GROUPS,
  today: ['today'],
  thisWeek: ['today', 'thisWeek'],
  overdue: ['overdue'],
  noDeadline: ['noDeadline']
}

/// What the right column shows.
export type TodoPanel =
  | { kind: 'overview' }
  | { kind: 'detail'; id: string }
  | { kind: 'deadline'; id: string }
  | { kind: 'newTodo' }
  | { kind: 'todoAdded'; todo: DashboardTodo }
  | { kind: 'prep' }
  | { kind: 'prepDetail'; id: string }
  | { kind: 'prepAdded'; suggestions: PrepSuggestion[] }

/// Row caption ("어제" in red, "오전 9:00", …).
export interface TodoMeta {
  text: string
  isOverdue?: boolean
}

export interface QuickAdd {
  title: string
  dueAt?: Date
  category?: NaviCategory
}

/// Figma weeks run 일–토.
const weekStart = (date: Date) => startOfWeek(date, 0)

/// State for the "할 일" tab (Figma "10 - 할 일"). Todos, categories, and every edit go
/// through `TodoStore` (Supabase); without a store edits stay in memory.
export class TodoTabModel extends Observable {
  todos: DashboardTodo[] = []
  categories: NaviCategory[] = []
  suggestions: PrepSuggestion[] = []
  filter: TodoFilter = 'all'
  searchText = ''
  showsCompleted = true
  panel: TodoPanel = { kind: 'overview' }
  isLoading = false
  errorMessage: string | null = null
  isLoadingSuggestions = false

  constructor(
    private store: TodoStore | null,
    private services: EdgeServices | null
  ) {
    super()
  }

  set<K extends 'filter' | 'searchText' | 'showsCompleted' | 'panel' | 'errorMessage'>(key: K, value: this[K]): void {
    this[key] = value
    this.changed()
  }

  // MARK: - Loading

  async load(): Promise<void> {
    if (!this.store) return
    this.isLoading = true
    this.changed()
    try {
      const [todos, categories] = await Promise.all([this.store.allTodos(), this.store.todoCategories()])
      this.todos = todos
      this.categories = categories
      this.errorMessage = null
    } catch {
      this.errorMessage = '할 일을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  // MARK: - Derived

  get openCount(): number {
    return this.todos.filter((t) => !t.isDone).length
  }

  get doneCount(): number {
    return this.todos.filter((t) => t.isDone).length
  }

  /// "오늘의 흐름": today's todos done / total.
  get todayProgress(): { done: number; total: number } {
    const today = this.todos.filter((t) => this.group(t) === 'today')
    return { done: today.filter((t) => t.isDone).length, total: today.length }
  }

  count(category: NaviCategory): number {
    return this.todos.filter((t) => t.category?.id === category.id && !t.isDone).length
  }

  /// Visible groups for the current filter and search, in Figma order.
  get groupedTodos(): { group: TodoGroup; todos: DashboardTodo[] }[] {
    const query = this.searchText.trim().toLowerCase()
    const visible = this.todos.filter(
      (todo) => (this.showsCompleted || !todo.isDone) && (!query || todo.title.toLowerCase().includes(query))
    )
    const due = (todo: DashboardTodo) => todo.dueAt?.getTime() ?? Number.POSITIVE_INFINITY
    return filterGroups[this.filter]
      .map((group) => ({
        group,
        todos: visible
          .filter((todo) => this.group(todo) === group)
          .sort((a, b) => due(a) - due(b) || a.orderIndex - b.orderIndex)
      }))
      .filter((entry) => entry.todos.length > 0)
  }

  group(todo: DashboardTodo, now = new Date()): TodoGroup | null {
    if (!todo.dueAt) return 'noDeadline'
    if (todo.dueAt < startOfDay(now)) {
      // Finished overdue todos drop out of the list; they still count as done.
      return todo.isDone ? null : 'overdue'
    }
    if (isSameDay(todo.dueAt, now)) return 'today'
    const start = weekStart(now)
    if (todo.dueAt >= start && todo.dueAt < addDays(start, 7)) return 'thisWeek'
    return 'later'
  }

  /// Row caption: "어제" (red) for overdue, "오전 9:00" today, "목 오전 9:00" this week,
  /// "9월 30일" later, or the origin for undated todos.
  meta(todo: DashboardTodo): TodoMeta | undefined {
    if (!todo.dueAt) {
      if (todo.source === 'mail_suggestion') return { text: '메일에서 생성됨' }
      if (todo.source === 'calendar_suggestion') return { text: '일정에서 생성됨' }
      return undefined
    }
    switch (this.group(todo)) {
      case 'overdue':
        if (isSameDay(todo.dueAt, addDays(new Date(), -1))) return { text: '어제', isOverdue: true }
        return { text: format(todo.dueAt, 'M월 d일'), isOverdue: true }
      case 'today':
        return { text: format(todo.dueAt, 'a h:mm') }
      case 'thisWeek':
        return { text: format(todo.dueAt, 'E a h:mm') }
      default:
        return { text: format(todo.dueAt, 'M월 d일') }
    }
  }

  todo(id: string): DashboardTodo | undefined {
    return this.todos.find((t) => t.id === id)
  }

  private update(id: string, change: (todo: DashboardTodo) => DashboardTodo): DashboardTodo | undefined {
    let updated: DashboardTodo | undefined
    this.todos = this.todos.map((todo) => (todo.id === id ? (updated = change(todo)) : todo))
    this.changed()
    return updated
  }

  // MARK: - Edits

  toggle(id: string): void {
    const todo = this.todo(id)
    if (!todo) return
    const isDone = !todo.isDone
    this.update(id, (t) => ({ ...t, isDone }))
    this.persist('할 일 상태를 저장하지 못했어요.', (store) => store.setTodo(id, isDone))
  }

  /// Mirrors the DB trigger locally: the parent is done exactly when every child is.
  toggleSubtask(subtaskID: string, todoID: string): void {
    const subtask = this.todo(todoID)?.subtasks.find((s) => s.id === subtaskID)
    if (!subtask) return
    const isDone = !subtask.isDone
    this.update(todoID, (t) =>
      withProgress({ ...t, subtasks: t.subtasks.map((s) => (s.id === subtaskID ? { ...s, isDone } : s)) })
    )
    this.persist('하위 할 일을 저장하지 못했어요.', (store) => store.setTodo(subtaskID, isDone))
  }

  addSubtask(title: string, todoID: string): void {
    const trimmed = title.trim()
    const todo = this.todo(todoID)
    if (!trimmed || !todo) return
    const subtask = { id: crypto.randomUUID(), title: trimmed, isDone: false }
    this.update(todoID, (t) => withProgress({ ...t, subtasks: [...t.subtasks, subtask] }))
    const day = todo.day ?? todo.dueAt ?? new Date()
    this.persist('하위 할 일을 추가하지 못했어요.', (store) => store.createSubtask(subtask, todoID, day))
  }

  rename(todoID: string, title: string): void {
    const trimmed = title.trim()
    const todo = this.todo(todoID)
    if (!trimmed || !todo || todo.title === trimmed) return
    this.saveFields(this.update(todoID, (t) => ({ ...t, title: trimmed }))!)
  }

  setCategory(category: NaviCategory | undefined, todoID: string): void {
    if (!this.todo(todoID)) return
    this.saveFields(this.update(todoID, (t) => ({ ...t, category }))!)
  }

  setDeadline(dueAt: Date, todoID: string): void {
    if (!this.todo(todoID)) return
    this.saveFields(this.update(todoID, (t) => ({ ...t, dueAt, day: startOfDay(dueAt) }))!)
  }

  move(id: string, targetID: string): void {
    const target = this.todo(targetID)
    if (id === targetID || !this.todo(id) || !target) return
    // Take the target's slot: just before it in order_index.
    const lower = this.todos.filter((t) => t.id !== id && t.orderIndex < target.orderIndex).map((t) => t.orderIndex)
    const before = lower.length ? Math.max(...lower) : target.orderIndex - 2
    const newIndex = (before + target.orderIndex) / 2
    this.update(id, (t) => ({ ...t, orderIndex: newIndex }))
    this.persist('순서를 저장하지 못했어요.', (store) => store.reorder([{ id, order_index: newIndex }]))
  }

  // MARK: - Create

  makeDraft(): NewTodoDraft {
    return { title: '', dueAt: nextHour() }
  }

  async addTodo(draft: NewTodoDraft, source: TodoSource = 'manual'): Promise<DashboardTodo> {
    const todo: DashboardTodo = {
      id: crypto.randomUUID(),
      title: draft.title.trim(),
      isDone: false,
      category: draft.category,
      dueAt: draft.dueAt,
      source,
      orderIndex: this.nextOrderIndex(),
      subtasks: [],
      day: startOfDay(draft.dueAt)
    }
    await this.store?.createTodo(todo, draft.dueAt)
    this.todos = [...this.todos, todo]
    this.changed()
    return todo
  }

  /// Quick-add bar: "제목 /내일 17:00 #업무". `/` sets the deadline (오늘·내일·모레, M.d or
  /// M/d, HH:mm or H시); `#` picks an existing category by name.
  quickAdd(text: string): void {
    const parsed = this.parseQuickAdd(text)
    const title = parsed.title.trim()
    if (!title) return
    const work = parsed.dueAt
      ? this.addTodo({ title, dueAt: parsed.dueAt, category: parsed.category })
      : this.addUndatedTodo(title, parsed.category)
    work.catch(() => this.set('errorMessage', '할 일을 추가하지 못했어요.'))
  }

  /// No deadline: stored with due_at = null, listed today.
  private async addUndatedTodo(title: string, category: NaviCategory | undefined): Promise<DashboardTodo> {
    const todo: DashboardTodo = {
      id: crypto.randomUUID(),
      title,
      isDone: false,
      category,
      source: 'manual',
      orderIndex: this.nextOrderIndex(),
      subtasks: [],
      day: startOfDay(new Date())
    }
    await this.store?.createTodo(todo, new Date())
    this.todos = [...this.todos, todo]
    this.changed()
    return todo
  }

  parseQuickAdd(text: string, now = new Date()): QuickAdd {
    let body = text.trim()
    if (body.startsWith('- [ ]')) body = body.slice(5)
    const titleWords: string[] = []
    let day: Date | undefined
    let time: [number, number] | undefined
    let category: NaviCategory | undefined
    const today = startOfDay(now)

    for (const word of body.split(' ').filter(Boolean)) {
      if (word.startsWith('#') && word.length > 1) {
        const name = word.slice(1).toLowerCase()
        category = this.categories.find((c) => c.name.toLowerCase() === name)
        if (!category) titleWords.push(word)
      } else if (word.startsWith('/') && word.length > 1) {
        const token = word.slice(1)
        const parsedDay = parseQuickDay(token, today)
        const parsedTime = parsedDay ? undefined : parseQuickTime(token)
        if (parsedDay) day = parsedDay
        else if (parsedTime) time = parsedTime
        else titleWords.push(word)
      } else {
        const parsedTime = time === undefined && day !== undefined ? parseQuickTime(word) : undefined
        if (parsedTime) time = parsedTime // "/내일 17:00"
        else titleWords.push(word)
      }
    }

    let dueAt: Date | undefined
    if (day || time) {
      dueAt = new Date(day ?? today)
      const [hour, minute] = time ?? [18, 0]
      dueAt.setHours(hour, minute, 0, 0)
    }
    return { title: titleWords.join(' '), dueAt, category }
  }

  // MARK: - Categories

  async addCategory(name: string, color: string): Promise<void> {
    const category = { id: crypto.randomUUID(), name: name.trim(), color }
    await this.store?.createTodoCategory(category)
    this.categories = [...this.categories, category]
    this.changed()
  }

  // MARK: - Weekly prep

  /// "이번 주 미리 준비": `POST todo-ai/todos/suggest` for this week (the next week on Sundays).
  openPrep(now = new Date()): void {
    this.set('panel', { kind: 'prep' })
    if (this.suggestions.length) return
    const todoAI = this.services?.todoAI
    if (!todoAI) {
      this.set('errorMessage', '로그인 후 추천 할 일을 받을 수 있어요.')
      return
    }
    const fallbackDue = new Date(now)
    fallbackDue.setHours(18, 0, 0, 0)
    this.isLoadingSuggestions = true
    this.changed()
    todoAI
      .suggestions({ week: now.getDay() === 0 ? 'next' : 'current', categories: this.categories, fallbackDue })
      .then(
        (suggestions) => {
          this.suggestions = suggestions
          this.errorMessage = null
        },
        (error) => {
          this.errorMessage = edgeMessage(error) ?? '추천 할 일을 불러오지 못했어요.'
        }
      )
      .finally(() => {
        this.isLoadingSuggestions = false
        this.changed()
      })
  }

  toggleSuggestion(id: string): void {
    this.suggestions = this.suggestions.map((s) => (s.id === id ? { ...s, isSelected: !s.isSelected } : s))
    this.changed()
  }

  updateSuggestion(suggestion: PrepSuggestion): void {
    this.suggestions = this.suggestions.map((s) => (s.id === suggestion.id ? suggestion : s))
    this.changed()
  }

  /// Saves the selected suggestions as `source = 'calendar_suggestion'` todos.
  async addSelectedSuggestions(): Promise<void> {
    const selected = this.suggestions.filter((s) => s.isSelected)
    if (!selected.length) return
    const added: PrepSuggestion[] = []
    for (const suggestion of selected) {
      try {
        await this.addTodo({ title: suggestion.title, dueAt: suggestion.dueAt, category: suggestion.category }, 'calendar_suggestion')
        added.push(suggestion)
      } catch {
        this.errorMessage = '추천 할 일을 추가하지 못했어요.'
      }
    }
    this.suggestions = this.suggestions.filter((s) => !added.some((a) => a.id === s.id))
    if (added.length) this.panel = { kind: 'prepAdded', suggestions: added }
    this.changed()
  }

  /// Adds one suggestion from its detail panel.
  async addSuggestion(suggestion: PrepSuggestion): Promise<void> {
    await this.addTodo({ title: suggestion.title, dueAt: suggestion.dueAt, category: suggestion.category }, 'calendar_suggestion')
    this.suggestions = this.suggestions.filter((s) => s.id !== suggestion.id)
    this.panel = { kind: 'prepAdded', suggestions: [suggestion] }
    this.changed()
  }

  // MARK: - Helpers

  private nextOrderIndex(): number {
    return Math.max(0, ...this.todos.map((t) => t.orderIndex)) + 1
  }

  private saveFields(todo: DashboardTodo): void {
    const day = todo.day ?? startOfDay(todo.dueAt ?? new Date())
    this.persist('할 일을 저장하지 못했어요.', (store) =>
      store.updateTodo(todo.id, todo.title, todo.dueAt, day, todo.category?.id)
    )
  }

  /// Runs a store write; on failure reloads from the server so the screen matches the DB.
  private persist(failure: string, write: (store: TodoStore) => Promise<void>): void {
    const store = this.store
    if (!store) return
    write(store).catch(async () => {
      this.set('errorMessage', failure)
      await this.load()
      this.set('errorMessage', failure)
    })
  }
}

function withProgress(todo: DashboardTodo): DashboardTodo {
  const subtasks = todo.subtasks
  if (!subtasks.length) return { ...todo, subtaskProgress: undefined }
  return {
    ...todo,
    subtaskProgress: { done: subtasks.filter((s) => s.isDone).length, total: subtasks.length },
    isDone: subtasks.every((s) => s.isDone)
  }
}

function parseQuickDay(token: string, today: Date): Date | undefined {
  if (token === '오늘') return today
  if (token === '내일') return addDays(today, 1)
  if (token === '모레') return addDays(today, 2)
  const parts = token.split(/[./]/).map(Number)
  if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n))) return undefined
  const [month, day] = parts
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const date = new Date(today.getFullYear(), month - 1, day)
  // "9.1" in late December means next year.
  if (date < today) date.setFullYear(date.getFullYear() + 1)
  return date
}

function parseQuickTime(token: string): [number, number] | undefined {
  if (token.endsWith('시')) {
    const hour = Number(token.slice(0, -1))
    if (token.length > 1 && Number.isInteger(hour) && hour >= 0 && hour <= 23) return [hour, 0]
  }
  const parts = token.split(':')
  if (parts.length !== 2 || parts.some((p) => p === '')) return undefined
  const [hour, minute] = parts.map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return [hour, minute]
}
