import { useEffect, useLayoutEffect, useRef } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import type { ChatMessage, ChatSession } from '@/data/types'
import { ChatTabModel } from '@/models/chat'
import { HStack, NaviIcon, NaviMascot, NaviPromptInput, NaviTabHeader, VStack } from '@/components/core'

const LimeDot = () => <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.lime, flexShrink: 0 }} />

/// Figma "11 - 채팅": recent topic sessions on the left, the selected conversation and the
/// prompt input on the right.
export function ChatTabView({ model }: { model: ChatTabModel }) {
  useModel(model)

  useEffect(() => {
    void model.load()
  }, [model])

  const session = model.selectedSession

  return (
    <VStack spacing={10} style={{ height: '100%' }}>
      <NaviTabHeader title="채팅" searchPrompt="대화 검색" searchText={model.searchText} onSearchChange={(t) => model.setSearchText(t)} />
      <HStack spacing={10} align="stretch" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
        <VStack spacing={10} style={{ width: 271, flexShrink: 0, padding: '15px 10px', background: T.cardWhite, borderRadius: 10 }}>
          <HStack spacing={10}>
            <span style={{ ...F.title(18), color: T.dark, whiteSpace: 'nowrap' }}>최근 대화</span>
            <LimeDot />
            <span style={{ ...F.body(10), color: T.grayText }}>대화는 주제별 세션으로 저장됩니다.</span>
          </HStack>
          <button
            type="button"
            onClick={() => model.newChat()}
            className="hover-dim"
            style={{
              ...F.body(12, 'bold'),
              color: T.cardWhite,
              background: T.purple,
              borderRadius: 10,
              padding: '10px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5
            }}
          >
            <NaviIcon name="IconPlus" />새 대화
          </button>
          <VStack spacing={5} className="scroll" style={{ flex: 1, minHeight: 0 }}>
            {model.visibleSessions.length === 0 && (
              <span style={{ ...F.body(12), color: T.grayText, paddingTop: 20, textAlign: 'center' }}>대화가 없어요.</span>
            )}
            {model.visibleSessions.map((s) => (
              <SessionRow key={s.id} session={s} isSelected={s.id === model.selectedID} onClick={() => model.select(s.id)} />
            ))}
          </VStack>
        </VStack>

        <VStack spacing={10} style={{ flex: 1, minWidth: 0 }}>
          <VStack spacing={15} style={{ flex: 1, minHeight: 0, padding: '15px 20px', background: T.cardWhite, borderRadius: 10 }}>
            {session && (
              <HStack spacing={15}>
                <span className="truncate" style={{ ...F.heading(18), color: T.ink }}>
                  {session.title}
                </span>
                <LimeDot />
                <span style={{ ...F.body(10), color: T.grayText, whiteSpace: 'nowrap' }}>{ChatTabModel.relativeTime(session.updatedAt)}</span>
              </HStack>
            )}
            {session && session.messages.length > 0 ? <Messages model={model} session={session} /> : <EmptyConversation />}
          </VStack>
          <NaviPromptInput prompt="무엇이든 물어보세요" onSubmit={(text) => model.send(text)} />
        </VStack>
      </HStack>
    </VStack>
  )
}

function Messages({ model, session }: { model: ChatTabModel; session: ChatSession }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isResponding = model.respondingIDs.has(session.id)
  // Messages sit at the bottom of the panel, newest last; follow new ones.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [session.id, session.messages.length, isResponding])

  return (
    <div ref={scrollRef} className="scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <VStack spacing={15} style={{ marginTop: 'auto' }}>
        {session.messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <span
                className="selectable"
                style={{
                  ...F.body(14),
                  color: T.cardWhite,
                  background: T.purple,
                  lineHeight: 1.5,
                  padding: '15px 30px',
                  borderRadius: 15,
                  maxWidth: 547,
                  whiteSpace: 'pre-wrap'
                }}
              >
                {message.text}
              </span>
            </div>
          ) : (
            <NaviAnswer
              key={message.id}
              message={message}
              isAdded={model.addedMessageIDs.has(message.id)}
              onAddTodos={() => void model.addTodos(message)}
            />
          )
        )}
        {isResponding && <span style={{ ...F.body(12), color: T.grayText }}>navi가 답변을 만들고 있어요…</span>}
        {model.errorMessage && <span style={{ ...F.body(12), color: T.red }}>{model.errorMessage}</span>}
      </VStack>
    </div>
  )
}

function EmptyConversation() {
  return (
    <VStack spacing={15} align="center" style={{ flex: 1, justifyContent: 'center' }}>
      <NaviMascot width={120} />
      <span style={{ ...F.heading(18), color: T.ink }}>무엇을 도와드릴까요?</span>
      <span style={{ ...F.body(12), color: T.grayText }}>일정, 메일, 할 일을 참고해 답해 드려요.</span>
    </VStack>
  )
}

/// Figma "Chat Item": title and relative time; lavender with a purple title when selected.
function SessionRow({ session, isSelected, onClick }: { session: ChatSession; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '8px 10px',
        width: '100%',
        borderRadius: 5,
        background: isSelected ? T.lavender : 'transparent',
        flexShrink: 0
      }}
    >
      <span className="truncate" style={{ ...F.body(12, 'bold'), color: isSelected ? T.purple : T.dark, maxWidth: '100%' }}>
        {session.title}
      </span>
      <span style={{ ...F.body(10), color: T.grayText }}>{ChatTabModel.relativeTime(session.updatedAt)}</span>
    </button>
  )
}

/// Figma "Chat Message / navi" plus the "참고한 정보" card.
function NaviAnswer({ message, isAdded, onAddTodos }: { message: ChatMessage; isAdded: boolean; onAddTodos: () => void }) {
  return (
    <VStack spacing={10} style={{ maxWidth: 547 }}>
      <VStack spacing={20} className="selectable" style={{ color: T.ink, padding: '15px 30px', background: T.itemBackground, borderRadius: 15 }}>
        <span style={F.body(14, 'bold')}>{message.text}</span>
        {message.items.length > 0 && (
          <VStack spacing={0} style={{ ...F.body(14), lineHeight: 1.5 }}>
            {message.items.map((item, index) => (
              <span key={index}>{message.items.length > 1 ? `${index + 1}. ${item}` : item}</span>
            ))}
          </VStack>
        )}
        {message.suggestedTodos.length > 0 && (
          <div>
            <button
              type="button"
              disabled={isAdded}
              onClick={onAddTodos}
              style={{
                ...F.body(12, 'bold'),
                color: T.purple,
                background: T.lavender,
                padding: '8px 20px',
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              {isAdded && <NaviIcon name="IconCheck" />}
              {isAdded ? '추가됨' : '할 일에 추가'}
            </button>
          </div>
        )}
      </VStack>
      {message.context && (
        <VStack spacing={10} style={{ padding: '10px 20px', background: T.itemBackground, borderRadius: 10 }}>
          <span style={{ ...F.title(12), color: T.purple }}>참고한 정보</span>
          <span style={{ ...F.body(12), color: T.ink }}>{message.context}</span>
        </VStack>
      )}
    </VStack>
  )
}
