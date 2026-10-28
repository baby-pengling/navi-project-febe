import { Observable } from '@/lib/observable'
import { addDays, addMinutes, format, isSameDay, startOfDay } from '@/lib/dates'
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

/// State for the floating mini widget (Figma "03-1 Floating UI"). Like the Swift app, it is
/// UI only for now: everything is sample data and edits stay in memory.
// TODO: Load from the same services as the main window once the widget is wired to the backend.
export class FloatingWidgetModel extends Observable {
  screen: FloatingScreen = { kind: 'home' }
  /** Whether the panel is showing above the mascot; tapping the mascot toggles it. */
  isPanelOpen = true
  userName = ''
  mails: FloatingMail[]
  events: DashboardEvent[]
  todos: DashboardTodo[]
  todoCategories: NaviCategory[]
  calendarCategories: NaviCategory[]
  addedTodoMailIDs = new Set<string>()
  addedEventMailIDs = new Set<string>()

  constructor(now = new Date()) {
    super()
    const startOfToday = startOfDay(now)
    const today = (hour: number, minute = 0) => {
      const d = new Date(startOfToday)
      d.setHours(hour, minute)
      return d
    }
    const daysAgo = (days: number, hour: number, minute = 0) => addDays(today(hour, minute), -days)
    const id = () => crypto.randomUUID()

    const navi = { id: id(), name: 'navi', color: '#7165FF' }
    const team = { id: id(), name: '팀', color: '#E5404F' }
    const work = { id: id(), name: '업무', color: '#7165FF' }
    const research = { id: id(), name: '리서치', color: '#3366CC' }
    this.todoCategories = [work, research]
    this.calendarCategories = [navi, team]

    const mail = (fields: Omit<MailMessage, 'id'>): MailMessage => ({ id: id(), ...fields })
    const m1 = mail({
      sender: { name: '황성주', email: 'sungju_hwang@example.com' },
      subject: '졸업 프로젝트 중간 리뷰 요청',
      body: '안녕하세요.\n졸업 프로젝트 중간 리뷰를 목요일 16시에 진행할 예정입니다.\n참석 가능 여부를 오늘 안에 알려주세요.',
      receivedAt: today(8, 12),
      isStarred: true,
      category: '답장 대기',
      summary: [{ lead: '졸업 프로젝트 중간 리뷰', text: '목요일 16:00' }, { text: '오늘 17시 전 참석 여부 회신 필요' }],
      suggestedTodo: '오늘 17:00까지 참석 여부 회신',
      replyDraft: '교수님 안녕하세요. 목요일 16시 중간 리뷰에 참석하겠습니다.\n요청하신 자료는 확인 후 전달드리겠습니다.'
    })
    const m2 = mail({
      sender: { name: '구영현', email: 'younghyun@example.com' },
      subject: '펭귄재단 장학금 마감',
      body: '안녕하세요.\n펭귄재단 장학금 신청 마감이 9월 18일입니다.\n신청 서류를 기한 내에 제출해 주세요.',
      receivedAt: daysAgo(1, 14, 30),
      isStarred: false,
      category: '요청·승인',
      summary: [{ lead: '장학금 신청 마감', text: '9월 18일' }, { text: '신청 서류 제출 필요' }],
      suggestedTodo: '장학금 신청 서류 제출'
    })
    const m3 = mail({
      sender: { name: 'GitHub', email: 'noreply@github.com' },
      subject: '아기펭귄수호대 팀 승인 요청',
      body: '아기펭귄수호대 팀에서 최종 자료 승인을 요청했습니다.\n승인하려면 저장소에서 확인해 주세요.',
      receivedAt: daysAgo(1, 9),
      isStarred: false,
      category: '요청·승인',
      summary: [{ lead: '팀 승인 요청', text: '최종 자료 승인 필요' }],
      suggestedTodo: '아기펭귄수호대 최종 자료 승인'
    })
    this.mails = [
      { id: m1.id, message: m1, briefTitle: '황성주 교수님 회신 필요', actionNote: '오늘 17시 전 참석 여부 회신', suggestedEvent: '목요일 16시 졸업 프로젝트 중간 리뷰' },
      { id: m2.id, message: m2, briefTitle: '펭귄재단 장학금 마감', actionNote: '9월 18일까지 신청 서류 제출' },
      { id: m3.id, message: m3, briefTitle: '아기펭귄수호대 팀 승인 요청', actionNote: '최종 자료 승인 필요' }
    ]

    const event = (title: string, startAt: Date, endAt: Date, category?: NaviCategory, location?: string): DashboardEvent => ({
      id: id(),
      title,
      startAt,
      endAt,
      isAllDay: false,
      category,
      location
    })
    this.events = [
      event('팀 스탠드업', today(9), today(10), navi, '우정정보관 205호'),
      event('사용자 인터뷰', today(10, 30), today(11), team, '우정정보관 205호'),
      event('서연이랑 점심 약속', today(12), today(13)),
      event('동창회', today(19), today(21), team)
    ]

    this.todos = [
      {
        id: id(),
        title: 'Navi 회의록 초안 공유',
        isDone: false,
        category: work,
        dueAt: today(17),
        source: 'mail_suggestion',
        subtaskProgress: { done: 0, total: 3 },
        orderIndex: 1,
        subtasks: [
          { id: id(), title: '검토 의견 모으기', isDone: false },
          { id: id(), title: '수정 우선순위 정하기', isDone: false },
          { id: id(), title: '최종안 팀에 공유', isDone: false }
        ],
        day: startOfToday
      },
      {
        id: id(),
        title: '인터뷰 질문지 정리',
        isDone: false,
        category: research,
        dueAt: today(9),
        source: 'calendar_suggestion',
        orderIndex: 2,
        subtasks: [],
        day: startOfToday
      }
    ]
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
    this.update(id, (t) => ({ ...t, isDone: !t.isDone }))
  }

  renameTodo(id: string, title: string): void {
    const trimmed = title.trim()
    if (trimmed) this.update(id, (t) => ({ ...t, title: trimmed }))
  }

  setCategory(category: NaviCategory | undefined, id: string): void {
    this.update(id, (t) => ({ ...t, category }))
  }

  setDue(date: Date, id: string): void {
    this.update(id, (t) => ({ ...t, dueAt: date }))
  }

  addTodo(title: string, category: NaviCategory | undefined, dueAt: Date | undefined, source: DashboardTodo['source'] = 'manual'): void {
    const trimmed = title.trim()
    if (!trimmed) return
    this.todos = [
      ...this.todos,
      {
        id: crypto.randomUUID(),
        title: trimmed,
        isDone: false,
        category,
        dueAt,
        source,
        orderIndex: Math.max(0, ...this.todos.map((t) => t.orderIndex)) + 1,
        subtasks: [],
        day: startOfDay(new Date())
      }
    ]
    this.changed()
  }

  toggleSubtask(subtaskID: string, id: string): void {
    this.update(id, (t) => withProgress({ ...t, subtasks: t.subtasks.map((s) => (s.id === subtaskID ? { ...s, isDone: !s.isDone } : s)) }))
  }

  addSubtask(title: string, id: string): void {
    const trimmed = title.trim()
    if (!trimmed) return
    this.update(id, (t) => withProgress({ ...t, subtasks: [...t.subtasks, { id: crypto.randomUUID(), title: trimmed, isDone: false }] }))
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

  saveEvent(draft: NewEventDraft, id?: string): void {
    const event: DashboardEvent = {
      id: id ?? crypto.randomUUID(),
      title: draft.title.trim(),
      startAt: draft.startAt,
      endAt: draft.endAt,
      isAllDay: false,
      category: draft.category,
      location: draft.location || undefined
    }
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

  addSuggestedTodo(mailID: string): void {
    const title = this.mail(mailID)?.message.suggestedTodo
    if (!title || this.addedTodoMailIDs.has(mailID)) return
    this.addTodo(title, this.todoCategories[0], undefined, 'mail_suggestion')
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
