import { Observable } from '@/lib/observable'
import { format, isToday, startOfDay, DAY } from '@/lib/dates'
import { isServerError, isUnavailable, edgeMessage, type EdgeServices, type MailService } from '@/data/edge'
import { newMailDraft, type MailDraft, type MailMessage } from '@/data/types'
import type { TodoTabModel } from './todo'

export type MailFilter = { kind: 'all' } | { kind: 'starred' } | { kind: 'category'; name: string } | { kind: 'drafts' }

export const mailFilterTitle = (filter: MailFilter): string =>
  filter.kind === 'all' ? '전체' : filter.kind === 'starred' ? '즐겨찾기' : filter.kind === 'drafts' ? '임시 보관함' : filter.name

export const sameMailFilter = (a: MailFilter, b: MailFilter): boolean =>
  a.kind === b.kind && (a.kind !== 'category' || a.name === (b as { name: string }).name)

export type MailPanel =
  | { kind: 'empty' }
  | { kind: 'detail'; id: string }
  | { kind: 'compose'; draft: MailDraft }
  | { kind: 'replyReview'; id: string }
  | { kind: 'replyEdit'; id: string }

/// State for the "메일" tab (Figma "08 메일"). Messages, labels, drafts, sending, and AI
/// summaries go through the `mail` Edge Function; failures show as `errorMessage`.
/// "할 일에 추가" creates a real todo through the todo tab's model.
export class MailTabModel extends Observable {
  messages: MailMessage[] = []
  drafts: MailDraft[] = []
  filter: MailFilter = { kind: 'all' }
  searchText = ''
  panel: MailPanel = { kind: 'empty' }
  addedTodoMessageIDs = new Set<string>()
  errorMessage: string | null = null
  isLoading = false
  isSending = false
  /** Messages whose summary request is in flight. */
  loadingSummaryIDs = new Set<string>()

  readonly senderAddress: string
  private loadedSummaryIDs = new Set<string>()

  constructor(
    private todoModel: TodoTabModel,
    private services: EdgeServices | null,
    senderAddress: string,
    readonly senderName: string
  ) {
    super()
    this.senderAddress = senderAddress || 'me@navi.app'
  }

  set<K extends 'filter' | 'searchText' | 'panel' | 'errorMessage'>(key: K, value: this[K]): void {
    this[key] = value
    this.changed()
  }

  /// Loads messages (with Gmail labels as categories) and drafts.
  async load(): Promise<void> {
    const mail = this.services?.mail
    if (!mail) return
    this.isLoading = true
    this.changed()
    try {
      const inbox = await mail.inbox()
      // Keep summaries already opened in this session.
      this.messages = inbox.map((fresh) => {
        const previous = this.message(fresh.id)
        if (!previous) return fresh
        return {
          ...fresh,
          summary: previous.summary,
          suggestedTodo: previous.suggestedTodo,
          replyDraft: previous.replyDraft,
          category: fresh.category ?? previous.category
        }
      })
      this.drafts = await mail.drafts().catch(() => this.drafts)
      this.errorMessage = null
    } catch (error) {
      this.errorMessage = edgeMessage(error) ?? '메일을 불러오지 못했어요.'
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  get filterTabs(): MailFilter[] {
    const categories: string[] = []
    for (const message of this.messages) {
      if (message.category && !categories.includes(message.category)) categories.push(message.category)
    }
    return [{ kind: 'all' }, { kind: 'starred' }, ...categories.map((name) => ({ kind: 'category' as const, name }))]
  }

  get visibleMessages(): MailMessage[] {
    const query = this.searchText.trim().toLowerCase()
    const filter = this.filter
    return this.messages
      .filter((m) =>
        filter.kind === 'starred' ? m.isStarred : filter.kind === 'category' ? m.category === filter.name : true
      )
      .filter(
        (m) =>
          !query ||
          m.subject.toLowerCase().includes(query) ||
          m.sender.name.toLowerCase().includes(query) ||
          m.body.toLowerCase().includes(query)
      )
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
  }

  message(id: string): MailMessage | undefined {
    return this.messages.find((m) => m.id === id)
  }

  get selectedMessageID(): string | undefined {
    const panel = this.panel
    switch (panel.kind) {
      case 'detail':
      case 'replyReview':
      case 'replyEdit':
        return panel.id
      case 'compose':
        return panel.draft.replyTo
      default:
        return undefined
    }
  }

  private updateMessage(id: string, change: Partial<MailMessage>): void {
    this.messages = this.messages.map((m) => (m.id === id ? { ...m, ...change } : m))
    this.changed()
  }

  // MARK: - Actions

  /// Opens a message: marks it read, then loads the full body and the cached AI summary.
  open(id: string): void {
    this.set('panel', { kind: 'detail', id })
    const mail = this.services?.mail
    if (!mail || this.loadedSummaryIDs.has(id)) return
    this.loadingSummaryIDs = new Set(this.loadingSummaryIDs).add(id)
    this.changed()
    ;(async () => {
      try {
        await mail.setRead(id, true).catch(() => {})
        const body = await mail.body(id).catch(() => undefined)
        if (body !== undefined) this.updateMessage(id, { body })
        try {
          const insight = await mail.insight(id)
          this.updateMessage(id, insight)
          this.loadedSummaryIDs.add(id)
        } catch (error) {
          if (!isUnavailable(error)) this.set('errorMessage', '메일 요약을 불러오지 못했어요.')
        }
      } finally {
        const ids = new Set(this.loadingSummaryIDs)
        ids.delete(id)
        this.loadingSummaryIDs = ids
        this.changed()
      }
    })()
  }

  toggleStar(id: string): void {
    const message = this.message(id)
    if (!message) return
    const starred = !message.isStarred
    this.updateMessage(id, { isStarred: starred })
    this.services?.mail.setStarred(id, starred).catch((error) => {
      if (isUnavailable(error)) return
      this.updateMessage(id, { isStarred: !starred })
      this.set('errorMessage', '별표를 바꾸지 못했어요.')
    })
  }

  compose(): void {
    this.set('panel', { kind: 'compose', draft: newMailDraft() })
  }

  /// "할 일에 추가": saves the suggested todo (due today at 18:00) to the todo list.
  async addSuggestedTodo(id: string): Promise<void> {
    const title = this.message(id)?.suggestedTodo
    if (!title) return
    const due = new Date()
    due.setHours(18, 0, 0, 0)
    try {
      await this.todoModel.addTodo({ title, dueAt: due }, 'mail_suggestion')
      this.addedTodoMessageIDs = new Set(this.addedTodoMessageIDs).add(id)
      this.changed()
    } catch {
      this.set('errorMessage', '할 일에 추가하지 못했어요.')
    }
  }

  updateReplyDraft(id: string, text: string): void {
    this.updateMessage(id, { replyDraft: text })
  }

  /// Full reply text shown in review.
  replyBody(message: MailMessage): string {
    return message.replyDraft ?? ''
  }

  /// Saves (if needed) and sends a draft the user approved. Returns it for the "메일을
  /// 보냈습니다" dialog, or undefined after a failure (kept in `errorMessage`).
  async send(draft: MailDraft): Promise<MailDraft | undefined> {
    this.isSending = true
    this.changed()
    try {
      const mail = this.services?.mail
      if (mail) {
        const stored = await this.store(draft, mail)
        await mail.sendDraft(stored.id)
      }
      this.drafts = this.drafts.filter((d) => d.id !== draft.id)
      this.panel = { kind: 'empty' }
      this.errorMessage = null
      return draft
    } catch (error) {
      this.errorMessage = sendError(error, '메일을 보내지 못했어요.')
      return undefined
    } finally {
      this.isSending = false
      this.changed()
    }
  }

  sendReply(id: string): Promise<MailDraft | undefined> {
    const message = this.message(id)
    if (!message) return Promise.resolve(undefined)
    return this.send(
      newMailDraft({ to: message.sender.email, subject: `Re: ${message.subject}`, body: this.replyBody(message), replyTo: id })
    )
  }

  async saveDraft(draft: MailDraft): Promise<MailDraft | undefined> {
    this.isSending = true
    this.changed()
    try {
      const mail = this.services?.mail
      const saved = { ...(mail ? await this.store(draft, mail) : draft), savedAt: new Date() }
      this.drafts = [saved, ...this.drafts.filter((d) => d.id !== draft.id && d.id !== saved.id)]
      this.panel = { kind: 'empty' }
      this.errorMessage = null
      return saved
    } catch (error) {
      this.errorMessage = sendError(error, '초안을 저장하지 못했어요.')
      return undefined
    } finally {
      this.isSending = false
      this.changed()
    }
  }

  private store(draft: MailDraft, mail: MailService): Promise<MailDraft> {
    return draft.isStored ? mail.updateDraft(draft) : mail.createDraft(draft)
  }

  // MARK: - Formatting

  /// "2026년 9월 16일 (4일 전)"
  static longDate(date: Date, now = new Date()): string {
    const days = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY)
    const relative = days === 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`
    return `${format(date, 'yyyy년 M월 d일')} (${relative})`
  }

  /// "08:18" today, "9월 16일" otherwise.
  static listTime(date: Date): string {
    return isToday(date) ? format(date, 'HH:mm') : format(date, 'M월 d일')
  }
}

function sendError(error: unknown, fallback: string): string {
  if (isServerError(error)) return error.message
  if (isUnavailable(error)) return '메일 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
  return fallback
}
