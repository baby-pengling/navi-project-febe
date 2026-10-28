import { Observable } from '@/lib/observable'
import { addDays, format, isSameDay } from '@/lib/dates'
import { isUnavailable, type AssistantService, type EdgeServices, type MessageInsert } from '@/data/edge'
import type { ChatMessage, ChatSession } from '@/data/types'
import type { TodoTabModel } from './todo'

/// State for the "채팅" tab (Figma "11 - 채팅"). Conversations are topic sessions in
/// `assistant_conversations`; a question goes to the `assistant` Edge Function and the reply
/// arrives as an `assistant_messages` insert over Realtime.
export class ChatTabModel extends Observable {
  sessions: ChatSession[] = []
  selectedID: string | null = null
  searchText = ''
  addedMessageIDs = new Set<string>()
  /** Sessions waiting for navi's reply ("답변을 만들고 있어요"). */
  respondingIDs = new Set<string>()
  errorMessage: string | null = null

  private assistant: AssistantService | null
  private unsubscribe: (() => void) | null = null

  constructor(
    private todoModel: TodoTabModel,
    services: EdgeServices | null
  ) {
    super()
    this.assistant = services?.assistant ?? null
  }

  setSearchText(text: string): void {
    this.searchText = text
    this.changed()
  }

  select(id: string | null): void {
    if (id === this.selectedID) return
    this.selectedID = id
    this.changed()
    this.selectionChanged()
  }

  /// Loads recent sessions and opens the newest one.
  async load(): Promise<void> {
    if (!this.assistant) return
    try {
      const stored = await this.assistant.sessions()
      const local = this.sessions.filter((s) => !s.isStored)
      // Keep messages already loaded in this session.
      this.sessions = [
        ...local,
        ...stored.map((fresh) => {
          const previous = this.sessions.find((s) => s.id === fresh.id)
          return previous?.hasLoadedMessages ? { ...fresh, messages: previous.messages, hasLoadedMessages: true } : fresh
        })
      ]
      this.errorMessage = null
      this.changed()
      if (this.selectedID === null || !this.selectedSession) this.select(this.visibleSessions[0]?.id ?? null)
      else this.selectionChanged()
    } catch {
      this.errorMessage = '대화 목록을 불러오지 못했어요.'
      this.changed()
    }
  }

  /// Stops following Realtime inserts when the tab goes away.
  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  get visibleSessions(): ChatSession[] {
    const query = this.searchText.trim().toLowerCase()
    return this.sessions
      .filter(
        (s) =>
          !query || s.title.toLowerCase().includes(query) || s.messages.some((m) => m.text.toLowerCase().includes(query))
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  get selectedSession(): ChatSession | undefined {
    return this.sessions.find((s) => s.id === this.selectedID)
  }

  private updateSession(id: string, change: (session: ChatSession) => ChatSession): void {
    this.sessions = this.sessions.map((s) => (s.id === id ? change(s) : s))
    this.changed()
  }

  // MARK: - Actions

  newChat(): void {
    // Reuse an untouched "새 대화" instead of stacking empty sessions.
    const empty = this.sessions.find((s) => !s.isStored && s.messages.length === 0)
    if (empty) {
      this.select(empty.id)
      return
    }
    const session: ChatSession = {
      id: crypto.randomUUID(),
      title: '새 대화',
      updatedAt: new Date(),
      messages: [],
      isStored: false,
      hasLoadedMessages: true
    }
    this.sessions = [session, ...this.sessions]
    this.select(session.id)
  }

  send(raw: string): void {
    const text = raw.trim()
    if (!text) return
    if (!this.selectedSession) this.newChat()
    const id = this.selectedID
    if (!id || !this.selectedSession) return

    this.updateSession(id, (s) => ({
      ...s,
      title: s.messages.length === 0 ? ChatTabModel.title(text) : s.title,
      messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', text, items: [], suggestedTodos: [] }],
      updatedAt: new Date()
    }))

    const assistant = this.assistant
    if (!assistant) {
      this.updateSession(id, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: crypto.randomUUID(),
            role: 'navi',
            text: '아직 AI 비서가 연결되지 않아 답변을 만들 수 없어요.',
            items: ['연결되면 일정·메일·할 일을 참고해 답해 드릴게요.'],
            suggestedTodos: []
          }
        ]
      }))
      return
    }

    this.respondingIDs = new Set(this.respondingIDs).add(id)
    this.errorMessage = null
    this.changed()
    ;(async () => {
      try {
        const session = this.sessions.find((s) => s.id === id)
        if (session && !session.isStored) {
          await assistant.createConversation(id)
          this.updateSession(id, (s) => ({ ...s, isStored: true }))
          this.follow(id)
        }
        await assistant.send(text, id)
      } catch (error) {
        const ids = new Set(this.respondingIDs)
        ids.delete(id)
        this.respondingIDs = ids
        this.errorMessage = isUnavailable(error)
          ? 'AI 비서가 아직 연결되지 않아 답변을 만들 수 없어요.'
          : '메시지를 보내지 못했어요.'
        this.changed()
      }
    })()
  }

  // MARK: - Loading messages

  private selectionChanged(): void {
    this.dispose()
    const session = this.selectedSession
    if (!session || !session.isStored) return
    this.follow(session.id)
    if (!session.hasLoadedMessages) void this.loadMessages(session.id)
  }

  private async loadMessages(id: string): Promise<void> {
    if (!this.assistant) return
    try {
      const messages = await this.assistant.chatMessages(id)
      this.updateSession(id, (s) => ({ ...s, messages, hasLoadedMessages: true }))
    } catch {
      this.errorMessage = '대화를 불러오지 못했어요.'
      this.changed()
    }
  }

  /// Follows `assistant_messages` inserts of one session (both the stored question and
  /// navi's reply).
  private follow(id: string): void {
    if (!this.assistant || this.selectedID !== id) return
    this.dispose()
    this.unsubscribe = this.assistant.messageInserts(id, (insert) => this.receive(insert))
  }

  private receive(insert: MessageInsert): void {
    const session = this.sessions.find((s) => s.id === insert.conversationID)
    if (!session) return
    const message = insert.message
    if (session.messages.some((m) => m.id === message.id)) return
    if (message.role === 'user') {
      const pending = session.messages.map((m) => m.role === 'user' && m.text === message.text).lastIndexOf(true)
      if (pending >= 0) {
        // Replace the optimistic copy with the stored row.
        this.updateSession(session.id, (s) => ({ ...s, messages: s.messages.map((m, i) => (i === pending ? message : m)) }))
        return
      }
    }
    this.updateSession(session.id, (s) => ({ ...s, messages: [...s.messages, message], updatedAt: insert.createdAt ?? new Date() }))
    if (message.role === 'navi') {
      const ids = new Set(this.respondingIDs)
      ids.delete(insert.conversationID)
      this.respondingIDs = ids
      this.changed()
    }
  }

  /// "할 일에 추가": saves each plan line as a todo due today, at its "HH:mm 전" time or 18:00.
  async addTodos(message: ChatMessage): Promise<void> {
    if (this.addedMessageIDs.has(message.id)) return
    try {
      for (const line of message.suggestedTodos) {
        const { title, dueAt } = ChatTabModel.parsePlanLine(line)
        await this.todoModel.addTodo({ title, dueAt }, 'manual')
      }
      this.addedMessageIDs = new Set(this.addedMessageIDs).add(message.id)
    } catch {
      this.errorMessage = '할 일에 추가하지 못했어요.'
    }
    this.changed()
  }

  // MARK: - Formatting

  /// "방금", "14:20", "어제", "9월 2일".
  static relativeTime(date: Date, now = new Date()): string {
    if (now.getTime() - date.getTime() < 60_000) return '방금'
    if (isSameDay(date, now)) return format(date, 'HH:mm')
    if (isSameDay(date, addDays(now, -1))) return '어제'
    return format(date, 'M월 d일')
  }

  /// "12:00 전 — 사용자 인터뷰 질문 정리" → ("사용자 인터뷰 질문 정리", today 12:00).
  static parsePlanLine(line: string, now = new Date()): { title: string; dueAt: Date } {
    let hour = 18
    let minute = 0
    let title = line
    const parts = line.split(' — ')
    if (parts.length === 2) {
      title = parts[1]
      const time = parts[0].replace(' 전', '').split(':').map(Number)
      if (time.length === 2 && time[0] >= 0 && time[0] < 24 && time[1] >= 0 && time[1] < 60) {
        hour = time[0]
        minute = time[1]
      }
    }
    const dueAt = new Date(now)
    dueAt.setHours(hour, minute, 0, 0)
    return { title: title.trim(), dueAt }
  }

  /// First question, trimmed, as the session title.
  private static title(text: string): string {
    const line = text.split(/\r?\n/)[0] ?? text
    return [...line].length > 20 ? [...line].slice(0, 20).join('') + '…' : line
  }
}
