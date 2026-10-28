import { useEffect, useState } from 'react'
import { F, T } from '@/lib/theme'
import { format } from '@/lib/dates'
import { useModel } from '@/lib/observable'
import type { DashboardMail, DashboardTodo } from '@/data/types'
import type { DashboardModel } from '@/models/dashboard'
import type { SettingsModel } from '@/models/settings'
import type { MainTab } from '../MainWindow'
import { HStack, NaviCompressButton, NaviImage, NaviPanel, NaviPillButton, NaviSectionHeader, Spacer, VStack } from '@/components/core'
import { DayTimeline, NewEventPanel, NewTodoPanel, TodoAddedPanel, TodoItemRow, dashboardMeta, clockTime, useNow, ErrorText } from '@/components/shared'
import { NaviAssistantPrompt } from '@/components/AssistantPrompt'

type RightPanel = { kind: 'schedule' } | { kind: 'newTodo' } | { kind: 'todoAdded'; todo: DashboardTodo } | { kind: 'newEvent' }

/// Figma "07 - 대시보드": greeting + date header, today's todos and important mail on the left,
/// today's timeline on the right, and the assistant command input along the bottom. Without
/// Google, the mail and timeline panels show connect cards.
export function DashboardView({ model, settingsModel, onSelectTab, onConnect }: {
  model: DashboardModel
  settingsModel: SettingsModel
  onSelectTab: (tab: MainTab) => void
  /** Opens the mail / calendar tab's Google connect flow. */
  onConnect: (service: 'mail' | 'calendar') => void
}) {
  useModel(model)
  useModel(settingsModel)
  const [rightPanel, setRightPanel] = useState<RightPanel>({ kind: 'schedule' })
  const now = useNow()

  useEffect(() => {
    void model.load()
  }, [model])

  const services = settingsModel.services

  const rightColumn = (() => {
    switch (rightPanel.kind) {
      case 'schedule':
        return (
          <NaviPanel spacing={15} fillsHeight>
            {services.calendarConnected ? (
              <>
                <NaviSectionHeader title="오늘 일정" tag={`${model.todayEvents.length}개`} onViewAll={() => onSelectTab('calendar')} />
                <DayTimeline day={now} events={model.todayEvents} showsLocation={false} />
                <div>
                  <NaviPillButton title="일정 추가" icon="IconPlus" size="large" onClick={() => setRightPanel({ kind: 'newEvent' })} />
                </div>
              </>
            ) : (
              <>
                <NaviSectionHeader title="오늘 일정" />
                <ConnectCard
                  logo="GoogleCalendarLogo"
                  title="캘린더를 연동하세요"
                  message="연동하면 오늘 일정을 시간순으로 볼 수 있어요."
                  onConnect={() => onConnect('calendar')}
                />
              </>
            )}
          </NaviPanel>
        )
      case 'newTodo':
        return (
          <NewTodoPanel
            categories={model.todoCategories}
            initialDraft={model.makeTodoDraft()}
            onCancel={() => setRightPanel({ kind: 'schedule' })}
            onSave={async (draft) => setRightPanel({ kind: 'todoAdded', todo: await model.addTodo(draft) })}
          />
        )
      case 'todoAdded':
        return (
          <TodoAddedPanel
            todo={rightPanel.todo}
            onClose={() => setRightPanel({ kind: 'schedule' })}
            onOpenTodos={() => {
              setRightPanel({ kind: 'schedule' })
              onSelectTab('todo')
            }}
          />
        )
      case 'newEvent':
        return (
          <NewEventPanel
            categories={model.calendarCategories}
            initialDraft={model.makeEventDraft()}
            onCancel={() => setRightPanel({ kind: 'schedule' })}
            onSave={async (draft) => {
              await model.addEvent(draft)
              setRightPanel({ kind: 'schedule' })
            }}
          />
        )
    }
  })()

  return (
    <VStack spacing={0} style={{ height: '100%' }}>
      <VStack spacing={10} style={{ flex: 1, minHeight: 0 }}>
        <Header now={now} name={settingsModel.name} />
        <HStack spacing={10} align="stretch" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
          <VStack spacing={10} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <NaviPanel>
              <NaviSectionHeader
                title="오늘 할 일"
                tag={`${model.completedTodoCount}/${model.todos.length} 완료`}
                onViewAll={() => onSelectTab('todo')}
              />
              {model.todos.length === 0 && (
                <span style={{ ...F.body(12), color: T.grayText, padding: '8px 10px', background: T.itemBackground, borderRadius: 5 }}>
                  {model.isLoadingTodos ? '할 일을 불러오는 중이에요…' : '오늘 할 일이 없어요.'}
                </span>
              )}
              <VStack spacing={7}>
                {model.todos.slice(0, 5).map((todo) => (
                  <TodoItemRow
                    key={todo.id}
                    todo={todo}
                    meta={dashboardMeta(todo)}
                    onToggle={() => model.toggleTodo(todo.id)}
                    onOpen={() => onSelectTab('todo')}
                    onDropTodo={(dragged) => model.moveTodo(dragged, todo.id)}
                  />
                ))}
              </VStack>
              {model.errorMessage && <ErrorText>{model.errorMessage}</ErrorText>}
              <div>
                <NaviPillButton title="할 일 추가" icon="IconPlus" size="large" onClick={() => setRightPanel({ kind: 'newTodo' })} />
              </div>
            </NaviPanel>

            <NaviPanel fillsHeight style={{ overflow: 'hidden' }}>
              {services.mailConnected ? (
                <>
                  <NaviSectionHeader title="중요 메일" tag={`${model.importantMails.length}개`} onViewAll={() => onSelectTab('mail')} />
                  <VStack spacing={5} className="scroll" style={{ minHeight: 0 }}>
                    {model.importantMails.map((mail) => (
                      <DashboardMailRow key={mail.id} mail={mail} onOpen={() => onSelectTab('mail')} />
                    ))}
                  </VStack>
                </>
              ) : (
                <>
                  <NaviSectionHeader title="중요 메일" />
                  <ConnectCard
                    logo="GmailLogo"
                    title="메일 계정을 연동하세요"
                    message="연동하면 중요한 메일을 여기서 바로 볼 수 있어요."
                    onConnect={() => onConnect('mail')}
                  />
                </>
              )}
            </NaviPanel>
          </VStack>
          <div style={{ width: 418, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{rightColumn}</div>
        </HStack>
      </VStack>
      <NaviAssistantPrompt prompt="오늘 할 일을 정리해줘" />
    </VStack>
  )
}

function Header({ now, name }: { now: Date; name: string }) {
  return (
    <HStack spacing={20}>
      <span className="truncate" style={{ ...F.title(28), color: T.ink }}>
        {greeting(now, name)}
      </span>
      <Spacer />
      <HStack spacing={5} aria-label={format(now, 'yyyy년 M월 d일 EEEE')}>
        <DateChip text={format(now, 'EEE')} />
        <DateChip text={format(now, 'MM')} />
        <DateChip text={format(now, 'dd')} />
      </HStack>
      <NaviCompressButton />
    </HStack>
  )
}

function DateChip({ text }: { text: string }) {
  return (
    <span style={{ ...F.mono(25), color: T.purple, padding: '12px 8px', background: T.lavender, borderRadius: 5, lineHeight: 1 }}>
      {text}
    </span>
  )
}

function greeting(date: Date, rawName: string): string {
  const hour = date.getHours()
  const salutation =
    hour >= 5 && hour < 11 ? '좋은 아침이에요' : hour >= 11 && hour < 17 ? '좋은 오후예요' : hour >= 17 && hour < 22 ? '좋은 저녁이에요' : '편안한 밤이에요'
  const name = displayName(rawName)
  return name ? `${salutation}, ${name}님.` : `${salutation}.`
}

/// Figma greets "박서연" as "서연님": a three-syllable Hangul name drops the family name;
/// anything else is used as entered.
export function displayName(raw: string): string | undefined {
  const name = raw.trim()
  if (!name) return undefined
  const chars = [...name]
  const isHangul = chars.every((c) => c >= '가' && c <= '힣')
  return isHangul && chars.length === 3 ? chars.slice(1).join('') : name
}

function ConnectCard({ logo, title, message, onConnect }: { logo: string; title: string; message: string; onConnect: () => void }) {
  return (
    <VStack spacing={8} align="center" style={{ padding: '24px 20px', background: T.itemBackground, borderRadius: 6 }}>
      <NaviImage name={logo} width={28} height={28} />
      <span style={{ ...F.title(14), color: T.dark }}>{title}</span>
      <span style={{ ...F.body(12), color: T.grayText, textAlign: 'center' }}>{message}</span>
      {/* Starts the tab's connect flow (service choice → permissions → Google). */}
      <NaviPillButton title="Google 계정 연동하기" onClick={onConnect} />
    </VStack>
  )
}

/// Figma "Email Item / Simple": sender, bold subject | snippet, received time.
function DashboardMailRow({ mail, onOpen }: { mail: DashboardMail; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '8px 10px', background: T.itemBackground, borderRadius: 5, width: '100%' }}
    >
      <span className="truncate" style={{ ...F.body(12), color: T.ink, width: 120, flexShrink: 0 }}>
        {mail.sender}
      </span>
      <span className="truncate" style={{ ...F.body(12), color: T.grayText, flex: 1 }}>
        <b style={{ ...F.body(12, 'bold'), color: T.ink }}>{mail.subject}</b> | {mail.snippet}
      </span>
      <span style={{ ...F.body(10), color: T.graySecondary, flexShrink: 0 }}>{clockTime(mail.receivedAt)}</span>
    </button>
  )
}
