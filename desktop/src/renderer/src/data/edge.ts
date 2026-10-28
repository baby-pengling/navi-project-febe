import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type RealtimeChannel,
  type SupabaseClient
} from '@supabase/supabase-js'
import { format, formatDate, parseDate } from '@/lib/dates'
import type {
  ChatMessage,
  ChatSession,
  DashboardEvent,
  DashboardMail,
  MailDraft,
  MailMessage,
  NaviCategory,
  NewEventDraft,
  PrepSuggestion,
  SummaryLine
} from './types'

// Edge Function / assistant-table clients for the Notion "API 명세" EDGE rows (`mail`,
// `calendar`, `assistant`, `todo-ai`, `google-auth`), all in `supabase/functions`. A function
// or route that isn't deployed fails with `EdgeError` kind `unavailable`; the tab models show
// the error.
//
// Ownership boundary: DTOs and their mapping stay in this file, and every public method returns
// the app's screen types. Backend contract changes only touch `data/`.

// MARK: - Client

export class EdgeError extends Error {
  private constructor(
    /** `unavailable`: 404 / relay error / no network — the function isn't deployed or reachable. */
    readonly kind: 'unavailable' | 'server',
    readonly code: string,
    message: string
  ) {
    super(message)
  }

  static unavailable(): EdgeError {
    return new EdgeError('unavailable', 'UNAVAILABLE', '서버 기능이 아직 준비되지 않았어요.')
  }

  /** `{error:{code,message}}` from a deployed function. */
  static server(code: string, message: string): EdgeError {
    return new EdgeError('server', code, message)
  }
}

export const isUnavailable = (error: unknown): boolean => error instanceof EdgeError && error.kind === 'unavailable'
export const isServerError = (error: unknown, code?: string): error is EdgeError =>
  error instanceof EdgeError && error.kind === 'server' && (code === undefined || error.code === code)
export const edgeMessage = (error: unknown): string | undefined => (error instanceof EdgeError ? error.message : undefined)

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/// Thin wrapper over `client.functions` that adds Idempotency-Keys and the spec's error envelope.
export class EdgeClient {
  constructor(readonly client: SupabaseClient) {}

  async call<T>(
    method: Method,
    path: string,
    options: { query?: Record<string, string | undefined>; body?: unknown; idempotent?: boolean } = {}
  ): Promise<T> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) params.set(key, value)
    }
    const name = params.size ? `${path}?${params}` : path
    // Each user action gets one key; a retried request of the same action would reuse it.
    const headers: Record<string, string> = options.idempotent ? { 'Idempotency-Key': crypto.randomUUID() } : {}
    // The body is pre-serialized (for the date format), so the type has to be set here.
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    let result
    try {
      result = await this.client.functions.invoke(name, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body, dateReplacer)
      })
    } catch {
      throw EdgeError.unavailable()
    }
    if (result.error) throw await EdgeClient.map(result.error)
    return result.data as T
  }

  static async map(error: unknown): Promise<Error> {
    if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) return EdgeError.unavailable()
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response
      try {
        const envelope = await response.clone().json()
        if (envelope?.error?.code && envelope?.error?.message) {
          return EdgeError.server(envelope.error.code, envelope.error.message)
        }
      } catch {
        // Not the envelope.
      }
      // A 404 without the envelope means the function (or route) isn't deployed.
      return response.status === 404
        ? EdgeError.unavailable()
        : EdgeError.server(`HTTP_${response.status}`, `요청을 처리하지 못했어요. (${response.status})`)
    }
    return EdgeError.unavailable()
  }
}

/// RFC3339 in device time for Date values (`EdgeClient.encoder`). `JSON.stringify` calls
/// `toJSON` before the replacer, so the original value is read from the holder.
function dateReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const original = this[key]
  return original instanceof Date ? formatDate(original) : value
}

/// A missing table (`PGRST205` / `42P01`) means the assistant schema isn't deployed yet.
async function table<T = unknown>(request: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T> {
  let result
  try {
    result = await request
  } catch {
    throw EdgeError.unavailable()
  }
  const { data, error } = result
  if (error) {
    if (['PGRST205', '42P01'].includes(error.code ?? '') || /fetch/i.test(error.message ?? '')) {
      throw EdgeError.unavailable()
    }
    throw error
  }
  return data as T
}

export interface EdgeServices {
  mail: MailService
  calendar: CalendarService
  assistant: AssistantService
  todoAI: TodoAIService
  googleAuth: GoogleAuthService
}

export function makeEdgeServices(client: SupabaseClient, userID: string): EdgeServices {
  const edge = new EdgeClient(client)
  return {
    mail: new MailService(edge),
    calendar: new CalendarService(edge, client),
    assistant: new AssistantService(edge, client, userID),
    todoAI: new TodoAIService(edge),
    googleAuth: new GoogleAuthService(edge)
  }
}

// MARK: - Shared DTOs

/// Either `["a", "b"]` or `"a\nb"` as lines.
function flexibleLines(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }
  return []
}

// MARK: - Mail

interface PersonDTO {
  name?: string | null
  email: string
}

interface MessageDTO {
  id: string
  from: PersonDTO
  subject?: string | null
  snippet?: string | null
  body_text?: string | null
  received_at: string
  starred?: boolean | null
  label_ids?: string[] | null
}

interface DraftDTO {
  id: string
  to?: string[] | null
  subject?: string | null
  body?: string | null
  reply_to_message_id?: string | null
  updated_at?: string | null
}

const toDraft = (dto: DraftDTO): MailDraft => ({
  id: dto.id,
  to: (dto.to ?? []).join(', '),
  subject: dto.subject ?? '',
  body: dto.body ?? '',
  replyTo: dto.reply_to_message_id ?? undefined,
  savedAt: parseDate(dto.updated_at) ?? new Date(),
  isStored: true
})

const draftBody = (draft: MailDraft) => ({
  to: draft.to
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  subject: draft.subject,
  body: draft.body,
  reply_to_message_id: draft.replyTo ?? null
})

/// Screen-ready AI summary of one message.
export interface MailInsight {
  summary: SummaryLine[]
  suggestedTodo?: string
  replyDraft?: string
}

/// `mail` Edge Function: Gmail list/detail/summary/star/read, labels, drafts, and briefing.
export class MailService {
  constructor(private edge: EdgeClient) {}

  /// The inbox, newest first, with Gmail label names as categories. A labels failure only
  /// drops the categories.
  async inbox(): Promise<MailMessage[]> {
    const labelsRequest = this.labels().catch(() => [])
    const rows = await this.messages()
    const labels = new Map<string, string>()
    for (const label of await labelsRequest) if (!labels.has(label.id)) labels.set(label.id, label.name)
    return rows.map((row) => MailService.message(row, labels))
  }

  /// Full body text (`GET /mail/messages/:id`).
  async body(id: string): Promise<string | undefined> {
    const row = await this.edge.call<MessageDTO>('GET', `mail/messages/${id.toLowerCase()}`)
    return row.body_text ?? row.snippet ?? undefined
  }

  /// Cached AI summary, reply suggestion, and first suggested todo.
  async insight(id: string): Promise<MailInsight> {
    const dto = await this.edge.call<{
      summary: unknown
      reply_suggestion?: string | null
      suggested_todos?: { title: string; due_at?: string | null }[] | null
    }>('GET', `mail/messages/${id.toLowerCase()}/summary`)
    return {
      summary: flexibleLines(dto.summary).map(MailService.summaryLine),
      suggestedTodo: dto.suggested_todos?.[0]?.title,
      replyDraft: dto.reply_suggestion ?? undefined
    }
  }

  /// Dashboard "중요 메일" from today's briefing.
  async importantMails(date: Date): Promise<DashboardMail[]> {
    const response = await this.edge.call<{ categories: { messages: MessageDTO[] }[] }>('GET', 'mail/briefing', {
      query: { date: format(date, 'yyyy-MM-dd') }
    })
    return response.categories
      .flatMap((category) => category.messages)
      .map((row) => ({
        id: row.id,
        sender: row.from.name || row.from.email,
        subject: row.subject ?? '(제목 없음)',
        snippet: row.snippet ?? '',
        receivedAt: parseDate(row.received_at) ?? new Date()
      }))
  }

  static message(row: MessageDTO, labels: Map<string, string>): MailMessage {
    return {
      id: row.id,
      sender: { name: row.from.name ?? '', email: row.from.email },
      subject: row.subject ?? '(제목 없음)',
      body: row.body_text ?? row.snippet ?? '',
      receivedAt: parseDate(row.received_at) ?? new Date(),
      isStarred: row.starred ?? false,
      category: (row.label_ids ?? []).map((id) => labels.get(id)).find((name) => name !== undefined),
      summary: []
    }
  }

  /// "디자인 리뷰: 목요일 16:00" → bold lead + detail.
  static summaryLine(line: string): SummaryLine {
    const trimmed = line.startsWith('- ') || line.startsWith('• ') ? line.slice(2) : line
    const colon = trimmed.indexOf(':')
    if (colon > 0) {
      const lead = trimmed.slice(0, colon).trim()
      const text = trimmed.slice(colon + 1).trim()
      if (lead && [...lead].length <= 12 && text) return { lead, text }
    }
    return { text: trimmed }
  }

  /// `GET /mail/messages?filter=` (all / starred / label).
  private async messages(filter = 'all', labelID?: string, query?: string): Promise<MessageDTO[]> {
    const response = await this.edge.call<{ messages: MessageDTO[] }>('GET', 'mail/messages', {
      query: { filter, label_id: labelID, q: query || undefined }
    })
    return response.messages
  }

  /// `PATCH /mail/messages/:id/star-state {starred}`.
  async setStarred(id: string, starred: boolean): Promise<void> {
    await this.edge.call('PATCH', `mail/messages/${id.toLowerCase()}/star-state`, { body: { starred } })
  }

  /// `PATCH /mail/messages/:id/read-state {read}`.
  async setRead(id: string, read: boolean): Promise<void> {
    await this.edge.call('PATCH', `mail/messages/${id.toLowerCase()}/read-state`, { body: { read } })
  }

  /// `GET /mail/labels` (the category tabs).
  private async labels(): Promise<{ id: string; name: string }[]> {
    const response = await this.edge.call<{ labels: { id: string; name: string }[] }>('GET', 'mail/labels')
    return response.labels
  }

  /// `GET /mail/drafts`.
  async drafts(): Promise<MailDraft[]> {
    const response = await this.edge.call<{ drafts: DraftDTO[] }>('GET', 'mail/drafts')
    return response.drafts.map(toDraft)
  }

  /// `POST /mail/drafts` (Idempotency-Key).
  async createDraft(draft: MailDraft): Promise<MailDraft> {
    return toDraft(await this.edge.call<DraftDTO>('POST', 'mail/drafts', { body: draftBody(draft), idempotent: true }))
  }

  /// `PATCH /mail/drafts/:id` (Idempotency-Key).
  async updateDraft(draft: MailDraft): Promise<MailDraft> {
    return toDraft(
      await this.edge.call<DraftDTO>('PATCH', `mail/drafts/${draft.id.toLowerCase()}`, {
        body: draftBody(draft),
        idempotent: true
      })
    )
  }

  /// `POST /mail/drafts/:id/send` (Idempotency-Key), after the user approved it.
  async sendDraft(id: string): Promise<void> {
    await this.edge.call('POST', `mail/drafts/${id.toLowerCase()}/send`, { idempotent: true })
  }
}

// MARK: - Calendar

/// `events[]` item: internal UUID, RFC3339 times, optional category (no Google IDs).
interface EventDTO {
  id: string
  title: string
  start_at: string
  end_at: string
  all_day?: boolean | null
  category?: NaviCategory | null
  location?: string | null
}

const toEvent = (dto: EventDTO): DashboardEvent => ({
  id: dto.id,
  title: dto.title,
  startAt: parseDate(dto.start_at) ?? new Date(),
  endAt: parseDate(dto.end_at) ?? new Date(),
  isAllDay: dto.all_day ?? false,
  category: dto.category ?? undefined,
  location: dto.location ? dto.location : undefined
})

/// Accepts both `{event: {...}}` and a bare event.
const unwrapEvent = (response: { event?: EventDTO } & Partial<EventDTO>): DashboardEvent =>
  toEvent(response.event ?? (response as EventDTO))

const eventBody = (draft: NewEventDraft) => {
  const location = draft.location.trim()
  return {
    title: draft.title.trim(),
    start_at: draft.startAt,
    end_at: draft.endAt,
    all_day: false,
    location: location || null,
    category_id: draft.category?.id ?? null
  }
}

/// `calendar` Edge Function (Google Calendar through the cache) and the `set_event_category` RPC.
export class CalendarService {
  constructor(
    private edge: EdgeClient,
    private client: SupabaseClient
  ) {}

  /// `GET /calendar/events?start=&end=`.
  async events(start: Date, end: Date): Promise<DashboardEvent[]> {
    const response = await this.edge.call<{ events: EventDTO[] }>('GET', 'calendar/events', {
      query: { start: formatDate(start), end: formatDate(end) }
    })
    return response.events.map(toEvent)
  }

  /// `GET /calendar/briefing/today` (visible categories only, in time order).
  async todayBriefing(): Promise<DashboardEvent[]> {
    const response = await this.edge.call<{ events: EventDTO[] }>('GET', 'calendar/briefing/today')
    return response.events.map(toEvent)
  }

  /// `POST /calendar/events` (Idempotency-Key).
  async create(draft: NewEventDraft): Promise<DashboardEvent> {
    return unwrapEvent(await this.edge.call('POST', 'calendar/events', { body: eventBody(draft), idempotent: true }))
  }

  /// `PATCH /calendar/events/:id` (Idempotency-Key) for Google fields; a category-only change
  /// goes through `set_event_category` without touching Google.
  async update(id: string, old: DashboardEvent, draft: NewEventDraft): Promise<DashboardEvent> {
    const location = draft.location.trim()
    const googleFieldsChanged =
      old.title !== draft.title.trim() ||
      old.startAt.getTime() !== draft.startAt.getTime() ||
      old.endAt.getTime() !== draft.endAt.getTime() ||
      (old.location ?? '') !== location
    let event = old
    if (googleFieldsChanged) {
      event = unwrapEvent(
        await this.edge.call('PATCH', `calendar/events/${id.toLowerCase()}`, { body: eventBody(draft), idempotent: true })
      )
    }
    if (old.category?.id !== draft.category?.id) {
      await this.setCategory(id, draft.category?.id)
      event = { ...event, category: draft.category }
    }
    return event
  }

  /// RPC `set_event_category(event_id, category_id)`; undefined clears the category.
  async setCategory(eventID: string, categoryID: string | undefined): Promise<void> {
    const { error } = await this.client.rpc('set_event_category', { event_id: eventID, category_id: categoryID ?? null })
    if (error) throw error
  }
}

// MARK: - Assistant

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  /** Set on navi rows by the `assistant` function (user rows carry `{type, id}` instead). */
  context?: { suggested_todos?: string[] | null; sources?: string | null } | null
  created_at?: string | null
}

/// What a tab's prompt is about (`context` of `assistant/command`): a row the user owns.
export interface AssistantAttachment {
  type: 'mail_message' | 'calendar_event' | 'todo'
  id: string
}

/// An `assistant_commands` row Claude has finished with.
export interface CommandResult {
  status: 'completed' | 'awaiting_approval' | 'failed'
  errorCode?: string
  /** navi's answer: lead line, then numbered lines. */
  text: string
  /** Tools Claude ran (`create_todo`, `create_mail_draft`, `propose_calendar_event`). */
  tools: string[]
}

export interface MessageInsert {
  conversationID: string
  message: ChatMessage
  createdAt?: Date
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/// Chat sessions (`assistant_conversations` / `assistant_messages` TABLE + Realtime) and the
/// `assistant` Edge Function (messages, floating/prompt commands).
export class AssistantService {
  constructor(
    private edge: EdgeClient,
    private client: SupabaseClient,
    private userID: string
  ) {}

  /// Recent sessions, newest first (messages load separately).
  async sessions(): Promise<ChatSession[]> {
    const rows = await table<{ id: string; title: string | null; last_message_at: string | null; created_at: string | null }[]>(
      this.client
        .from('assistant_conversations')
        .select('id, title, last_message_at, created_at')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(50)
    )
    return (rows ?? []).map((row) => ({
      id: row.id,
      title: row.title ?? '새 대화',
      updatedAt: parseDate(row.last_message_at) ?? parseDate(row.created_at) ?? new Date(),
      messages: [],
      isStored: true,
      hasLoadedMessages: false
    }))
  }

  async chatMessages(conversationID: string): Promise<ChatMessage[]> {
    const rows = await table<MessageRow[]>(
      this.client
        .from('assistant_messages')
        .select('id, conversation_id, role, content, context, created_at')
        .eq('conversation_id', conversationID)
        .order('created_at', { ascending: true })
        .limit(200)
    )
    return (rows ?? []).map(AssistantService.chatMessage)
  }

  /// First line is navi's bold lead; the rest become the numbered lines. `context` adds the
  /// "할 일에 추가" plan lines and the "참고한 정보" footer.
  static chatMessage(row: MessageRow): ChatMessage {
    if (row.role === 'user') {
      return { id: row.id, role: 'user', text: row.content, items: [], suggestedTodos: [] }
    }
    const lines = row.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const lead = lines.length ? lines.shift()! : row.content
    return {
      id: row.id,
      role: 'navi',
      text: lead,
      items: lines.map((line) => line.replace(/^\d+\.\s*/, '')),
      suggestedTodos: row.context?.suggested_todos ?? [],
      context: row.context?.sources ?? undefined
    }
  }

  /// TABLE insert with the app-generated id (UUID conflicts stop duplicates).
  async createConversation(id: string): Promise<void> {
    await table(this.client.from('assistant_conversations').insert({ id, user_id: this.userID }))
  }

  /// `POST /assistant/conversations/:id/messages` (Idempotency-Key). Returns 202; the reply
  /// arrives as an `assistant_messages` insert.
  async send(text: string, conversationID: string): Promise<void> {
    await this.edge.call('POST', `assistant/conversations/${conversationID.toLowerCase()}/messages`, {
      body: { content: text },
      idempotent: true
    })
  }

  /// `POST /assistant/command` from a tab's prompt input. Returns the command id right away
  /// (202); Claude's result lands on that `assistant_commands` row.
  async command(text: string, context?: AssistantAttachment): Promise<string> {
    const response = await this.edge.call<{ command_id: string }>('POST', 'assistant/command', {
      body: { text, context: context ?? null },
      idempotent: true
    })
    return response.command_id
  }

  /// Polls the command's row until Claude is done (or `timeout` passes).
  async commandResult(id: string, signal?: AbortSignal, timeoutMs = 90_000): Promise<CommandResult> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const row = await table<{
        status: string
        result_text: string | null
        error_code: string | null
        tool_calls: { tool: string }[] | null
      }>(this.client.from('assistant_commands').select('status, result_text, error_code, tool_calls').eq('id', id).single())
      if (row.status === 'completed' || row.status === 'awaiting_approval' || row.status === 'failed') {
        return {
          status: row.status,
          errorCode: row.error_code ?? undefined,
          text: row.result_text ?? '',
          tools: (row.tool_calls ?? []).map((call) => call.tool)
        }
      }
      await sleep(1000)
    }
    throw EdgeError.server('TIMEOUT', 'navi가 아직 처리 중이에요. 잠시 후 다시 확인해 주세요.')
  }

  /// Follows new messages of one conversation until the returned function is called.
  messageInserts(conversationID: string, onInsert: (insert: MessageInsert) => void): () => void {
    const id = conversationID.toLowerCase()
    const channel: RealtimeChannel = this.client
      .channel(`assistant-messages-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'assistant_messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          const row = payload.new as MessageRow
          onInsert({
            conversationID: row.conversation_id,
            message: AssistantService.chatMessage(row),
            createdAt: parseDate(row.created_at)
          })
        }
      )
      .subscribe()
    return () => {
      this.client.removeChannel(channel)
    }
  }
}

// MARK: - Todo AI

interface SuggestionDTO {
  title: string
  due_at?: string | null
  reason?: string | null
  effort?: string | null
  category_id?: string | null
  is_urgent?: boolean | null
}

/// "추천 기준" toggles of the calendar tab.
export interface PrepCriteria {
  mail: boolean
  incompleteTodos: boolean
  relatedTodos: boolean
  userPattern: boolean
}

/// `todo-ai` Edge Function. Suggestions aren't stored; approved ones become `todos` rows.
export class TodoAIService {
  constructor(private edge: EdgeClient) {}

  /// Suggestions for the prep panels. `criteria` is the calendar tab's "추천 기준" (all on
  /// when undefined); categories resolve `category_id`, and `fallbackDue` fills a missing `due_at`.
  async suggestions(options: {
    week?: 'current' | 'next'
    criteria?: PrepCriteria
    categories: NaviCategory[]
    fallbackDue: Date
  }): Promise<PrepSuggestion[]> {
    const criteria = options.criteria ?? { mail: true, incompleteTodos: true, relatedTodos: true, userPattern: true }
    const response = await this.edge.call<{ suggestions: SuggestionDTO[] }>('POST', 'todo-ai/todos/suggest', {
      body: {
        week: options.week ?? 'current',
        criteria: {
          mail: criteria.mail,
          incomplete_todos: criteria.incompleteTodos,
          related_todos: criteria.relatedTodos,
          user_pattern: criteria.userPattern
        }
      }
    })
    return response.suggestions.map((dto) => ({
      id: crypto.randomUUID(),
      title: dto.title,
      dueAt: parseDate(dto.due_at) ?? options.fallbackDue,
      category: options.categories.find((c) => c.id === dto.category_id),
      reason: dto.reason ?? '',
      effort: dto.effort ?? '',
      isUrgent: dto.is_urgent ?? false,
      isSelected: true
    }))
  }
}

// MARK: - Google

/// `google-auth` Edge Function.
export class GoogleAuthService {
  constructor(private edge: EdgeClient) {}

  /// `POST /google-auth/credentials` (204) right after the Google consent. The server keeps
  /// the refresh token in Vault and sets `auth_status` from the scopes Google actually granted.
  async registerCredentials(refreshToken: string, scopes: string[]): Promise<void> {
    await this.edge.call('POST', 'google-auth/credentials', {
      body: { provider_refresh_token: refreshToken, granted_scopes: scopes }
    })
  }

  /// `DELETE /google-auth/disconnect` (Idempotency-Key). Returns 202; the worker syncs every
  /// cache first so data stays as of the last sync.
  async disconnect(): Promise<void> {
    await this.edge.call('DELETE', 'google-auth/disconnect', { idempotent: true })
  }
}
