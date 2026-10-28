import { useEffect, useState, type ReactNode } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import { mailSnippet, personDisplay, type MailDraft, type MailMessage } from '@/data/types'
import { MailTabModel, mailFilterTitle, sameMailFilter, type MailFilter } from '@/models/mail'
import type { MainDialog } from '../MainWindow'
import {
  HStack,
  NaviImage,
  NaviPanelHeader,
  NaviPillButton,
  NaviSegmentTabs,
  NaviTabHeader,
  Spacer,
  VStack
} from '@/components/core'
import { ErrorText, NaviCheckbox } from '@/components/shared'
import { NaviAssistantPrompt } from '@/components/AssistantPrompt'

const DRAFTS: MailFilter = { kind: 'drafts' }

function Pane({ children, spacing = 10, padding = 20, style }: { children: ReactNode; spacing?: number; padding?: number | string; style?: React.CSSProperties }) {
  return (
    <VStack spacing={spacing} style={{ padding, background: T.cardWhite, borderRadius: 10, flex: 1, minHeight: 0, ...style }}>
      {children}
    </VStack>
  )
}

/// Figma "08 메일": filter tabs, the message list, and a right panel that shows the empty
/// state, a message with AI summary / todo / reply draft, a new message, or the reply review /
/// edit flow.
export function MailTabView({ model, onDialog }: {
  model: MailTabModel
  /** Shows "메일을 보냈습니다" / "초안을 저장했습니다". */
  onDialog: (dialog: MainDialog) => void
}) {
  useModel(model)

  useEffect(() => {
    void model.load()
  }, [model])

  const panel = model.panel
  const isDrafts = model.filter.kind === 'drafts'

  const rightPanel = (() => {
    switch (panel.kind) {
      case 'empty':
        return (
          <div style={{ flex: 1, background: T.cardWhite, borderRadius: 10, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <NaviImage name="MailEmptyState" width={250} height={248.7} style={{ position: 'absolute', opacity: 0.5, filter: 'blur(16px)' }} />
            <span style={{ ...F.paperlogy(18), color: T.ink, position: 'relative' }}>
              {isDrafts ? '좌측에서 임시 보관한 메일을 선택해주세요.' : '좌측에서 메일을 선택해주세요.'}
            </span>
          </div>
        )
      case 'detail': {
        const message = model.message(panel.id)
        if (!message) return null
        return (
          <VStack spacing={10} style={{ flex: 1, minHeight: 0 }}>
            <MailDetailPanel model={model} message={message} />
            <NaviAssistantPrompt prompt="이 메일에서 할 일을 만들어 줘" context={{ type: 'mail_message', id: message.id }} />
          </VStack>
        )
      }
      case 'compose':
        return (
          <ComposePanel
            key={panel.draft.id}
            initial={panel.draft}
            senderAddress={model.senderAddress}
            isSending={model.isSending}
            onClose={() => model.set('panel', { kind: 'empty' })}
            onSave={async (draft) => {
              const saved = await model.saveDraft(draft)
              if (saved) onDialog({ kind: 'mailDraftSaved', draft: saved })
            }}
            onSend={async (draft) => {
              const sent = await model.send(draft)
              if (sent) onDialog({ kind: 'mailSent', draft: sent })
            }}
          />
        )
      case 'replyReview':
      case 'replyEdit': {
        const message = model.message(panel.id)
        if (!message) return null
        return (
          <ReplyPanel
            model={model}
            message={message}
            isEditing={panel.kind === 'replyEdit'}
            onSend={async () => {
              const sent = await model.sendReply(message.id)
              if (sent) onDialog({ kind: 'mailSent', draft: sent })
            }}
          />
        )
      }
    }
  })()

  return (
    <VStack spacing={10} style={{ height: '100%' }}>
      <NaviTabHeader title="메일" searchPrompt="메일 검색" searchText={model.searchText} onSearchChange={(t) => model.set('searchText', t)} />
      <HStack spacing={10}>
        <NaviSegmentTabs
          items={model.filterTabs}
          selection={model.filter}
          onSelect={(f) => model.set('filter', f)}
          title={mailFilterTitle}
          isEqual={sameMailFilter}
        />
        <Spacer />
        <NaviSegmentTabs items={[DRAFTS]} selection={model.filter} onSelect={(f) => model.set('filter', f)} title={mailFilterTitle} isEqual={sameMailFilter} />
        <NaviPillButton title="새 메일" icon="IconPlus" style="primary" size="large" onClick={() => model.compose()} />
      </HStack>

      <HStack spacing={10} align="stretch" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
        <VStack spacing={5} className="scroll" style={{ width: 360, flexShrink: 0, padding: '15px 10px', background: T.cardWhite, borderRadius: 10 }}>
          {isDrafts ? (
            <>
              {model.drafts.length === 0 && <EmptyList text="임시 보관한 메일이 없어요." />}
              {model.drafts.map((draft) => (
                <MailListRow
                  key={draft.id}
                  sender={draft.to || '받는 사람 없음'}
                  subject={draft.subject || '(제목 없음)'}
                  snippet={draft.body}
                  time={MailTabModel.listTime(draft.savedAt)}
                  isSelected={panel.kind === 'compose' && panel.draft.id === draft.id}
                  onClick={() => model.set('panel', { kind: 'compose', draft })}
                />
              ))}
            </>
          ) : (
            <>
              {model.visibleMessages.length === 0 && <EmptyList text={model.isLoading ? '메일을 불러오는 중이에요…' : '메일이 없어요.'} />}
              {model.visibleMessages.map((message) => (
                <MailListRow
                  key={message.id}
                  sender={message.sender.name || message.sender.email}
                  subject={message.subject}
                  snippet={mailSnippet(message)}
                  time={MailTabModel.listTime(message.receivedAt)}
                  isStarred={message.isStarred}
                  isSelected={model.selectedMessageID === message.id}
                  onStar={() => model.toggleStar(message.id)}
                  onClick={() => model.open(message.id)}
                />
              ))}
            </>
          )}
        </VStack>
        <VStack spacing={6} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {rightPanel}
          {/* Load / send / star failures from the `mail` Edge Function. */}
          {model.errorMessage && (
            <span style={{ padding: '0 10px' }}>
              <ErrorText>{model.errorMessage}</ErrorText>
            </span>
          )}
        </VStack>
      </HStack>
    </VStack>
  )
}

function EmptyList({ text }: { text: string }) {
  return <span style={{ ...F.body(12), color: T.grayText, padding: 10 }}>{text}</span>
}

/// Figma "Email Item / Detail": sender, star + time, bold subject (purple when selected),
/// and a one-line snippet.
function MailListRow({ sender, subject, snippet, time, isStarred, isSelected, onStar, onClick }: {
  sender: string
  subject: string
  snippet: string
  time: string
  /** undefined hides the star (drafts). */
  isStarred?: boolean
  isSelected: boolean
  onStar?: () => void
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '8px 10px',
        borderRadius: 5,
        background: isSelected ? T.lavender : T.itemBackground,
        border: `1px solid ${isSelected ? T.purple : 'transparent'}`,
        cursor: 'pointer',
        flexShrink: 0
      }}
    >
      <HStack style={{ height: 17 }}>
        <span className="truncate" style={{ ...F.body(10), color: T.ink }}>
          {sender}
        </span>
        <Spacer />
        <HStack spacing={5}>
          {isStarred !== undefined && (
            <button
              type="button"
              aria-label={isStarred ? '즐겨찾기 해제' : '즐겨찾기'}
              onClick={(e) => {
                e.stopPropagation()
                onStar?.()
              }}
              style={{ width: 16, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <NaviImage name={isStarred ? 'IconStarFilled' : 'IconStar'} width={isStarred ? 13 : 14} height={16} style={{ transform: 'rotate(-90deg)' }} />
            </button>
          )}
          <span style={{ ...F.body(10), color: T.graySecondary, whiteSpace: 'nowrap' }}>{time}</span>
        </HStack>
      </HStack>
      <VStack spacing={3}>
        <span className="truncate" style={{ ...F.body(12, 'bold'), color: isSelected ? T.purple : T.ink }}>
          {subject}
        </span>
        <span className="truncate" style={{ ...F.body(10), color: T.grayText }}>
          {snippet}
        </span>
      </VStack>
    </div>
  )
}

const Divider = () => <div style={{ height: 1, background: T.border, flexShrink: 0 }} />

function ItemBox({ children, spacing = 10 }: { children: ReactNode; spacing?: number }) {
  return <VStack spacing={spacing} style={{ padding: '10px 20px', background: T.itemBackground, borderRadius: 10 }}>{children}</VStack>
}

// MARK: - Detail

function MailDetailPanel({ model, message }: { model: MailTabModel; message: MailMessage }) {
  const [isAddingTodo, setAddingTodo] = useState(false)
  const isAdded = model.addedTodoMessageIDs.has(message.id)
  const draft = message.replyDraft
  return (
    <Pane spacing={15} padding="15px 20px">
      <VStack spacing={10}>
        <span className="selectable" style={{ ...F.heading(18), color: T.ink }}>
          {message.subject}
        </span>
        <Divider />
        <HStack>
          <HStack spacing={10} style={{ minWidth: 0 }}>
            <span style={{ ...F.body(12, 'bold'), color: T.ink }}>{message.sender.name}</span>
            <span className="truncate selectable" style={{ ...F.body(10), color: T.grayText }}>
              &lt;{message.sender.email}&gt;
            </span>
          </HStack>
          <Spacer />
          <span style={{ ...F.body(10), color: T.grayText, whiteSpace: 'nowrap' }}>{MailTabModel.longDate(message.receivedAt)}</span>
        </HStack>
      </VStack>
      <div className="scroll selectable" style={{ flex: 1, minHeight: 0, ...F.body(10), color: T.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {message.body}
      </div>
      {model.loadingSummaryIDs.has(message.id) && message.summary.length === 0 && (
        <span style={{ ...F.body(11), color: T.grayText }}>AI 요약을 불러오는 중이에요…</span>
      )}
      <VStack spacing={10}>
        {message.summary.length > 0 && (
          <ItemBox>
            <span style={{ ...F.title(12), color: T.purple }}>AI 요약</span>
            <VStack spacing={5}>
              {message.summary.map((item, i) => (
                <HStack key={i} spacing={6} align="baseline" style={{ ...F.body(12), color: T.ink }}>
                  <span>•</span>
                  <span>
                    {item.lead ? (
                      <>
                        <b>{item.lead}</b>: {item.text}
                      </>
                    ) : (
                      item.text
                    )}
                  </span>
                </HStack>
              ))}
            </VStack>
          </ItemBox>
        )}
        {message.suggestedTodo && (
          <HStack style={{ padding: '10px 20px', background: T.itemBackground, borderRadius: 10 }}>
            <HStack spacing={10} style={{ minWidth: 0 }}>
              <NaviCheckbox isChecked={isAdded} />
              <span style={{ ...F.body(12), color: T.ink }}>{message.suggestedTodo}</span>
            </HStack>
            <Spacer />
            <NaviPillButton
              title={isAdded ? '추가됨' : isAddingTodo ? '추가 중…' : '할 일에 추가'}
              style={isAdded ? 'success' : 'accent'}
              onClick={async () => {
                if (isAdded || isAddingTodo) return
                setAddingTodo(true)
                await model.addSuggestedTodo(message.id)
                setAddingTodo(false)
              }}
            />
          </HStack>
        )}
        {draft !== undefined && (
          <ItemBox>
            <span style={{ ...F.title(12), color: T.purple }}>답장 초안</span>
            <HStack align="flex-start">
              <span
                style={{
                  ...F.body(12),
                  color: T.ink,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  flex: 1
                }}
              >
                {draft.split('\n').filter(Boolean)[2] ?? draft}
              </span>
              <NaviPillButton title="검토 후 전송" style="primary" onClick={() => model.set('panel', { kind: 'replyReview', id: message.id })} />
            </HStack>
          </ItemBox>
        )}
      </VStack>
    </Pane>
  )
}

// MARK: - Compose

/// Figma "08 - 메일 > 새 메일": sender, 받는 사람, 제목, 내용, 임시 저장 / 보내기.
function ComposePanel({ initial, senderAddress, isSending, onClose, onSave, onSend }: {
  initial: MailDraft
  senderAddress: string
  isSending: boolean
  onClose: () => void
  onSave: (draft: MailDraft) => void
  onSend: (draft: MailDraft) => void
}) {
  const [draft, setDraft] = useState(initial)
  const canSend = draft.to.includes('@') && draft.body.trim() !== ''
  const field = (title: string, value: string, onChange: (value: string) => void) => (
    <VStack spacing={4} style={{ padding: 10, border: `1px solid ${T.border}`, borderRadius: 10 }}>
      <span style={{ ...F.body(10), color: T.grayText }}>{title}</span>
      <input value={value} aria-label={title} onChange={(e) => onChange(e.target.value)} style={{ ...F.body(12), color: T.ink }} />
    </VStack>
  )
  return (
    <Pane>
      <NaviPanelHeader title={draft.replyTo ? '답장' : '새 메일'} onClose={onClose} />
      <HStack spacing={12} style={{ height: 22 }}>
        <span style={{ ...F.body(10), color: T.grayText, width: 85 }}>보내는 사람</span>
        <span style={{ ...F.body(12), color: T.ink }}>{senderAddress}</span>
      </HStack>
      {field('받는 사람', draft.to, (to) => setDraft({ ...draft, to }))}
      {field('제목', draft.subject, (subject) => setDraft({ ...draft, subject }))}
      <VStack spacing={9} style={{ padding: 14, flex: 1, minHeight: 0, border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <span style={{ ...F.body(10), color: T.grayText }}>내용</span>
        <textarea
          value={draft.body}
          aria-label="내용"
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          style={{ ...F.body(12), color: T.ink, flex: 1 }}
        />
      </VStack>
      <HStack spacing={10}>
        <Spacer />
        <NaviPillButton title="임시 저장" size="large" disabled={isSending} onClick={() => onSave(draft)} />
        <NaviPillButton title="보내기" style="primary" size="large" disabled={!canSend || isSending} onClick={() => onSend(draft)} />
      </HStack>
    </Pane>
  )
}

// MARK: - Reply review / edit

/// Figma "08 - 메일 > 답장 초안 검토" and "> 수정": the original message, then the reply draft
/// (read-only or editable), then 초안 수정 / 이대로 답장 전송하기 (or 수정 취소 / 검토 완료).
function ReplyPanel({ model, message, isEditing, onSend }: {
  model: MailTabModel
  message: MailMessage
  isEditing: boolean
  onSend: () => void
}) {
  const [editedText, setEditedText] = useState(() => model.replyBody(message))
  return (
    <Pane>
      <NaviPanelHeader
        title={isEditing ? '답장 초안 수정' : '답장 초안 검토'}
        onClose={() => model.set('panel', { kind: 'detail', id: message.id })}
      />
      <VStack spacing={6} style={{ padding: 14 }}>
        <HStack style={{ ...F.body(10), color: T.grayText }}>
          <span className="truncate">원본 메일 · {personDisplay(message.sender)}</span>
          <Spacer />
          <span style={{ whiteSpace: 'nowrap' }}>{MailTabModel.longDate(message.receivedAt)}</span>
        </HStack>
        <span style={{ ...F.title(14), color: T.ink }}>{message.subject}</span>
        <span
          style={{ ...F.body(12), color: T.ink, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {mailSnippet(message)}
        </span>
      </VStack>
      <Divider />
      <HStack spacing={10}>
        <span style={{ ...F.title(14), color: T.ink }}>답장 내용</span>
        {!isEditing && <span style={{ ...F.body(10), color: T.purple }}>초안 · 전송 전 수정 가능</span>}
      </HStack>
      <VStack
        spacing={10}
        style={{
          padding: '15px 20px',
          background: isEditing ? T.cardWhite : T.itemBackground,
          borderRadius: 10,
          border: `1px solid ${isEditing ? T.border : 'transparent'}`,
          minHeight: 0
        }}
      >
        <HStack spacing={12} style={{ padding: '0 8px' }}>
          <span style={{ ...F.body(10), color: T.grayText }}>받는 사람</span>
          <span style={{ ...F.body(12), color: T.ink }}>
            <b>{message.sender.name}</b> &lt;{message.sender.email}&gt;
          </span>
        </HStack>
        <Divider />
        {isEditing ? (
          <textarea value={editedText} onChange={(e) => setEditedText(e.target.value)} style={{ ...F.body(12), color: T.ink, minHeight: 120 }} />
        ) : (
          <span className="scroll selectable" style={{ ...F.body(12), color: T.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {model.replyBody(message)}
          </span>
        )}
      </VStack>
      {!isEditing && <span style={{ ...F.body(10), color: T.grayText }}>전송하면 위 내용이 {message.sender.name}님에게 전달됩니다.</span>}
      <Spacer />
      <HStack spacing={10}>
        <Spacer />
        {isEditing ? (
          <>
            <NaviPillButton title="수정 취소" style="outline" size="large" onClick={() => model.set('panel', { kind: 'replyReview', id: message.id })} />
            <NaviPillButton
              title="검토 완료"
              style="primary"
              size="large"
              onClick={() => {
                model.updateReplyDraft(message.id, editedText)
                model.set('panel', { kind: 'replyReview', id: message.id })
              }}
            />
          </>
        ) : (
          <>
            <NaviPillButton
              title="초안 수정"
              size="large"
              onClick={() => {
                setEditedText(model.replyBody(message))
                model.set('panel', { kind: 'replyEdit', id: message.id })
              }}
            />
            <NaviPillButton title="이대로 답장 전송하기" style="primary" size="large" disabled={model.isSending} onClick={onSend} />
          </>
        )}
      </HStack>
    </Pane>
  )
}
