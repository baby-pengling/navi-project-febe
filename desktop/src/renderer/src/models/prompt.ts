import { Observable } from '@/lib/observable'
import { edgeMessage, type AssistantAttachment, type AssistantService, type CommandResult } from '@/data/edge'

export type PromptState =
  | { kind: 'running'; prompt: string }
  | { kind: 'finished'; result: CommandResult }
  | { kind: 'failed'; message: string }

/// The prompt bars on the dashboard, mail, calendar, and todo tabs. A prompt goes to
/// `assistant/command`; navi's answer (or the failure) shows in a card above the bar until it's
/// closed. One model is shared by every tab, so a running request keeps going when switching tabs.
export class AssistantPromptModel extends Observable {
  state: PromptState | null = null
  private controller: AbortController | null = null

  constructor(
    private assistant: AssistantService | null,
    /** Runs after Claude changed something (e.g. created todos) so the tabs reload. */
    private onChange: () => Promise<void> = async () => {}
  ) {
    super()
  }

  send(text: string, context?: AssistantAttachment): void {
    if (!this.assistant) {
      this.state = { kind: 'failed', message: '로그인 후 navi에게 요청할 수 있어요.' }
      this.changed()
      return
    }
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.state = { kind: 'running', prompt: text }
    this.changed()
    const assistant = this.assistant
    ;(async () => {
      try {
        const id = await assistant.command(text, context)
        const result = await assistant.commandResult(id, controller.signal)
        if (controller.signal.aborted) return
        if (result.status === 'failed') {
          this.state = { kind: 'failed', message: AssistantPromptModel.message(result.errorCode) }
          this.changed()
          return
        }
        this.state = { kind: 'finished', result }
        this.changed()
        if (result.tools.length) await this.onChange()
      } catch (error) {
        if (controller.signal.aborted) return
        this.state = { kind: 'failed', message: edgeMessage(error) ?? '요청을 보내지 못했어요.' }
        this.changed()
      }
    })()
  }

  dismiss(): void {
    this.controller?.abort()
    this.controller = null
    this.state = null
    this.changed()
  }

  /// `assistant_commands.error_code` → what the card says.
  static message(code?: string): string {
    switch (code) {
      case 'LLM_NOT_CONFIGURED':
        return 'AI 설정(API 키)을 확인해 주세요.'
      case 'LLM_BUSY':
        return 'AI 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.'
      case 'GOOGLE_NOT_CONNECTED':
        return 'Google 계정을 연결하면 메일·일정 작업도 도와드릴게요.'
      default:
        return '죄송해요, 지금은 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
    }
  }
}
