import { Observable } from '@/lib/observable'
import { addDays, addMinutes, addMonths, format, isSameDay, isToday, startOfDay, startOfMonth, startOfWeek } from '@/lib/dates'
import type { TodoStore } from '@/data/backend'
import { edgeMessage, type EdgeServices, type PrepCriteria } from '@/data/edge'
import type { DashboardEvent, DashboardTodo, NaviCategory, NewEventDraft, PrepSuggestion } from '@/data/types'
import type { TodoTabModel } from './todo'

export type CalendarMode = 'week' | 'month'

export type CalendarPanel =
  | { kind: 'overview' }
  | { kind: 'newEvent' }
  | { kind: 'eventDetail'; id: string }
  | { kind: 'dayDetail' }
  | { kind: 'prep' }
  | { kind: 'prepCriteria' }
  | { kind: 'prepDetail'; id: string }
  | { kind: 'prepAdded'; suggestions: PrepSuggestion[] }

export const criteriaIsEmpty = (c: PrepCriteria) => !(c.mail || c.incompleteTodos || c.relatedTodos || c.userPattern)

/// Figma weeks run 일–토.
const weekStart = (date: Date) => startOfWeek(date, 0)
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

/// State for the "일정" tab (Figma "09 일정"): week / month views, the right column, and the
/// prep dialogs. Calendar categories come from Supabase; todos made from events from the todo
/// tab's model; events from the `calendar` Edge Function; weekly prep from `todo-ai`.
export class CalendarTabModel extends Observable {
  mode: CalendarMode = 'week'
  /** The selected day (week strip / month cell). */
  selectedDay = startOfDay(new Date())
  panel: CalendarPanel = { kind: 'overview' }
  searchText = ''
  events: DashboardEvent[] = []
  categories: { category: NaviCategory; isVisible: boolean }[] = []
  criteria: PrepCriteria = { mail: true, incompleteTodos: true, relatedTodos: true, userPattern: true }
  suggestions: PrepSuggestion[] = []
  errorMessage: string | null = null

  /** Month (start time) whose events are loaded; reloaded when navigation leaves it. */
  private loadedMonth: number | null = null

  constructor(
    private store: TodoStore | null,
    private services: EdgeServices | null,
    readonly todoModel: TodoTabModel
  ) {
    super()
  }

  set<K extends 'mode' | 'panel' | 'searchText' | 'criteria' | 'errorMessage'>(key: K, value: this[K]): void {
    this[key] = value
    this.changed()
  }

  async load(): Promise<void> {
    if (!this.store) return
    try {
      this.categories = await this.store.calendarCategoryVisibility()
      this.errorMessage = null
    } catch {
      this.errorMessage = '캘린더 카테고리를 불러오지 못했어요.'
    }
    this.changed()
    await this.loadEvents(true)
    await this.todoModel.load()
  }

  /// Loads the selected month's grid (plus the surrounding weeks) from `calendar/events`.
  async loadEvents(force = false): Promise<void> {
    const service = this.services?.calendar
    if (!service) return
    const month = startOfMonth(this.selectedDay)
    if (!force && this.loadedMonth === month.getTime()) return
    this.loadedMonth = month.getTime()
    try {
      this.events = await service.events(addDays(month, -7), addDays(addMonths(month, 1), 7))
    } catch {
      this.loadedMonth = null
      this.errorMessage = '일정을 불러오지 못했어요.'
    }
    this.changed()
  }

  private reloadEventsIfNeeded(): void {
    if (this.services) void this.loadEvents()
  }

  // MARK: - Navigation

  /// "2026년 9월"
  get monthTitle(): string {
    return format(this.selectedDay, 'yyyy년 M월')
  }

  get weekDays(): Date[] {
    const start = weekStart(this.selectedDay)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }

  /// Weeks of the month grid (only rows that touch the month).
  get monthWeeks(): Date[][] {
    const first = weekStart(startOfMonth(this.selectedDay))
    return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(first, week * 7 + day))).filter(
      (week) => week.some((day) => sameMonth(day, this.selectedDay))
    )
  }

  step(direction: number): void {
    this.selectedDay = this.mode === 'week' ? addDays(this.selectedDay, 7 * direction) : addMonths(this.selectedDay, direction)
    this.changed()
    this.reloadEventsIfNeeded()
  }

  goToToday(): void {
    this.selectedDay = startOfDay(new Date())
    this.changed()
    this.reloadEventsIfNeeded()
  }

  select(day: Date): void {
    this.selectedDay = startOfDay(day)
    if (this.mode === 'month') this.panel = { kind: 'dayDetail' }
    this.changed()
    this.reloadEventsIfNeeded()
  }

  isToday = (day: Date) => isToday(day)
  isSelected = (day: Date) => isSameDay(day, this.selectedDay)
  isInSelectedMonth = (day: Date) => sameMonth(day, this.selectedDay)

  /// "오늘 · 9월 15일" or "9월 16일 · 수요일".
  get dayTitle(): string {
    if (isToday(this.selectedDay)) return `오늘 · ${format(this.selectedDay, 'M월 d일')}`
    return format(this.selectedDay, 'M월 d일 · EEEE')
  }

  // MARK: - Events

  /// Events in visible categories matching the search.
  eventsOn(day: Date): DashboardEvent[] {
    const hidden = new Set(this.categories.filter((c) => !c.isVisible).map((c) => c.category.id))
    const query = this.searchText.trim().toLowerCase()
    return this.events
      .filter((e) => isSameDay(e.startAt, day))
      .filter((e) => !e.category || !hidden.has(e.category.id))
      .filter((e) => !query || e.title.toLowerCase().includes(query))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  }

  event(id: string): DashboardEvent | undefined {
    return this.events.find((e) => e.id === id)
  }

  makeEventDraft(): NewEventDraft {
    let start: Date
    if (isToday(this.selectedDay)) {
      start = new Date()
      start.setMinutes(0, 0, 0)
      start.setHours(start.getHours() + 1)
    } else {
      start = new Date(this.selectedDay)
      start.setHours(9, 0, 0, 0)
    }
    return { title: '', category: this.categories[0]?.category, startAt: start, endAt: addMinutes(start, 60), location: '' }
  }

  draft(event: DashboardEvent): NewEventDraft {
    return { title: event.title, category: event.category, startAt: event.startAt, endAt: event.endAt, location: event.location ?? '' }
  }

  /// `POST calendar/events`; without a backend the event stays local.
  async addEvent(draft: NewEventDraft): Promise<void> {
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
    this.events = [...this.events, event]
    this.selectedDay = startOfDay(draft.startAt)
    this.panel = { kind: 'overview' }
    this.changed()
  }

  /// `PATCH calendar/events/:id` for Google fields, `set_event_category` for the category.
  async updateEvent(id: string, draft: NewEventDraft): Promise<void> {
    const old = this.event(id)
    if (!old) return
    const location = draft.location.trim()
    const updated = this.services
      ? await this.services.calendar.update(id, old, draft)
      : {
          ...old,
          title: draft.title.trim(),
          category: draft.category,
          startAt: draft.startAt,
          endAt: draft.endAt,
          location: location || undefined
        }
    this.events = this.events.map((e) => (e.id === id ? updated : e))
    this.panel = { kind: 'overview' }
    this.changed()
  }

  // MARK: - Categories

  toggleVisibility(id: string): void {
    const entry = this.categories.find((c) => c.category.id === id)
    if (!entry) return
    const isVisible = !entry.isVisible
    this.categories = this.categories.map((c) => (c.category.id === id ? { ...c, isVisible } : c))
    this.changed()
    this.store?.setCalendarCategory(id, isVisible).catch(async () => {
      this.set('errorMessage', '카테고리 표시 설정을 저장하지 못했어요.')
      await this.load()
    })
  }

  async addCategory(name: string, color: string): Promise<void> {
    const category = { id: crypto.randomUUID(), name: name.trim(), color }
    await this.store?.createCalendarCategory(category)
    this.categories = [...this.categories, { category, isVisible: true }]
    this.changed()
  }

  /// "일정에서 만든 할 일": todos created from calendar suggestions.
  get calendarTodos(): DashboardTodo[] {
    return this.todoModel.todos.filter((t) => t.source === 'calendar_suggestion')
  }

  // MARK: - Weekly prep

  /// "9월 14일–20일"
  get weekRangeText(): string {
    const days = this.weekDays
    const first = days[0]
    const last = days[6]
    return `${format(first, 'M월 d일')}–${format(last, sameMonth(first, last) ? 'd일' : 'M월 d일')}`
  }

  /// Runs behind the "정리하고 있어요" dialog (`POST todo-ai/todos/suggest`). Returns false
  /// when there's nothing to suggest from (the "추천에 사용할 정보가 없어요" dialog).
  async generateSuggestions(): Promise<boolean> {
    if (criteriaIsEmpty(this.criteria)) return false
    const todoAI = this.services?.todoAI
    if (!todoAI) {
      this.set('errorMessage', '로그인 후 추천 할 일을 받을 수 있어요.')
      return true
    }
    try {
      const fallbackDue = new Date(this.weekDays[6])
      fallbackDue.setHours(18, 0, 0, 0)
      const items = await todoAI.suggestions({
        week: 'current',
        criteria: this.criteria,
        categories: this.todoModel.categories,
        fallbackDue
      })
      if (!items.length) return false
      this.suggestions = items
      this.panel = { kind: 'prep' }
      this.changed()
      return true
    } catch (error) {
      this.set('errorMessage', edgeMessage(error) ?? '추천 할 일을 만들지 못했어요.')
      return true
    }
  }

  toggleSuggestion(id: string): void {
    this.suggestions = this.suggestions.map((s) => (s.id === id ? { ...s, isSelected: !s.isSelected } : s))
    this.changed()
  }

  async addSelectedSuggestions(): Promise<void> {
    const added: PrepSuggestion[] = []
    for (const suggestion of this.suggestions.filter((s) => s.isSelected)) {
      try {
        await this.addToTodos(suggestion)
        added.push(suggestion)
      } catch {
        this.errorMessage = '추천 할 일을 추가하지 못했어요.'
      }
    }
    this.suggestions = this.suggestions.filter((s) => !added.some((a) => a.id === s.id))
    if (added.length) this.panel = { kind: 'prepAdded', suggestions: added }
    this.changed()
  }

  async addSuggestion(suggestion: PrepSuggestion): Promise<void> {
    await this.addToTodos(suggestion)
    this.suggestions = this.suggestions.filter((s) => s.id !== suggestion.id)
    this.panel = { kind: 'prepAdded', suggestions: [suggestion] }
    this.changed()
  }

  private async addToTodos(suggestion: PrepSuggestion): Promise<void> {
    await this.todoModel.addTodo(
      { title: suggestion.title, dueAt: suggestion.dueAt, category: suggestion.category },
      'calendar_suggestion'
    )
  }
}
