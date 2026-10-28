import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { F, T, naviHex } from '@/lib/theme'
import { format, isSameDay, isToday, addDays, startOfDay, DAY } from '@/lib/dates'
import { useModel } from '@/lib/observable'
import { supabase } from '@/lib/supabase'
import type { DashboardTodo, NaviCategory } from '@/data/types'
import { FloatingWidgetModel, type FloatingMail } from '@/models/floating'
import {
  HStack,
  NaviCategoryPicker,
  NaviCategoryTag,
  NaviFieldBox,
  NaviIcon,
  NaviImage,
  NaviMascot,
  NaviMenu,
  NaviPanelHeader,
  NaviPillButton,
  NaviPromptInput,
  Spacer,
  VStack
} from '@/components/core'
import { DragHandle, NaviCheckbox, NewEventPanel, ScheduleBlock, clockTime, timeRange } from '@/components/shared'
import { DeadlinePanel, deadlineText } from '@/components/todoPanels'

// Port of FloatingWidgetView.swift and FloatingScreens.swift (Figma "03-1 Floating UI"). The
// widget runs in its own transparent, always-on-top window; this view reports its size so the
// main process keeps the window fitted with the mascot anchored at the bottom right.

type OpenMain = (tab: string | null) => void

/// Panel width. Figma's frames vary between 370 and 398pt per screen; the widget keeps the
/// home screen's width so it doesn't jump while navigating.
const PANEL_WIDTH = 398

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties
const drag = { WebkitAppRegion: 'drag' } as CSSProperties

export function FloatingWidget() {
  const model = useModel(useMemo(() => new FloatingWidgetModel(), []))
  const rootRef = useRef<HTMLDivElement>(null)
  const openMain: OpenMain = (tab) => window.navi.widget.expand(tab)

  // The greeting uses the signed-in user's name, read from the shared session.
  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => {
      const metadata = data.session?.user.user_metadata ?? {}
      model.setUserName((metadata.navi_name ?? metadata.name ?? '') as string)
    })
    return window.navi.widget.onReset(() => model.reset())
  }, [model])

  // Keep the window fitted to the content.
  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return
    const report = () => window.navi.widget.resize(element.offsetWidth, element.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 'max-content',
        // Room for the panel shadow inside the transparent window.
        padding: model.isPanelOpen ? '40px 6px 6px 40px' : '0 6px 6px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end'
      }}
    >
      {model.isPanelOpen && (
        // Figma: the mascot overlaps the panel's bottom edge and sticks out past its right edge.
        <div
          className="fade-in"
          style={{
            width: PANEL_WIDTH,
            marginRight: 69,
            marginBottom: -18,
            padding: '20px 15px',
            background: T.widgetBackground,
            borderRadius: 15,
            boxShadow: '0 18px 38px rgba(26,26,36,0.2)',
            position: 'relative'
          }}
        >
          <Screen model={model} openMain={openMain} />
        </div>
      )}
      <button
        type="button"
        title={model.isPanelOpen ? '브리핑 접기' : '브리핑 열기'}
        aria-label={model.isPanelOpen ? '브리핑 접기' : '브리핑 열기'}
        onClick={() => model.setPanelOpen(!model.isPanelOpen)}
        style={{ width: 129, height: 86, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 }}
      >
        <NaviMascot width={126} />
      </button>
    </div>
  )
}

/// Routes `model.screen` to the widget screens.
function Screen({ model, openMain }: { model: FloatingWidgetModel; openMain: OpenMain }) {
  const screen = model.screen
  switch (screen.kind) {
    case 'home':
      return <HomeScreen model={model} openMain={openMain} />
    case 'mails':
      return <MailListScreen model={model} openMain={openMain} />
    case 'mailDetail': {
      const mail = model.mail(screen.id)
      return mail ? <MailDetailScreen model={model} mail={mail} openMain={openMain} /> : null
    }
    case 'events':
      return <EventListScreen model={model} openMain={openMain} />
    case 'eventDetail': {
      const event = model.event(screen.id)
      return event ? <EventFormScreen key={event.id} model={model} title={event.title} eventID={event.id} openMain={openMain} /> : null
    }
    case 'newEvent':
      return <EventFormScreen model={model} title="새 일정" fromMail={screen.fromMail} openMain={openMain} />
    case 'todos':
      return <TodoListScreen model={model} openMain={openMain} />
    case 'todoDetail': {
      const todo = model.todo(screen.id)
      return todo ? <TodoDetailScreen key={todo.id} model={model} todo={todo} openMain={openMain} /> : null
    }
    case 'deadline': {
      const todo = model.todo(screen.id)
      if (!todo) return null
      const back = () => model.setScreen({ kind: 'todoDetail', id: todo.id })
      return (
        <Chrome backTitle={todo.title} onBack={back} openMain={openMain}>
          <DeadlinePanel
            initial={todo.dueAt ?? model.newTodoDueAt}
            showsCloseButton={false}
            onCancel={back}
            onApply={(date) => {
              model.setDue(date, todo.id)
              back()
            }}
          />
        </Chrome>
      )
    }
  }
}

// MARK: - Chrome

/// Screen scaffold. List screens have a back link, then the logo + title row with the settings
/// and expand buttons, then a purple subtitle and gray caption; detail screens put the buttons
/// on the back-link row and skip the title.
function Chrome({ backTitle, title, subtitle, caption, onBack, openMain, children }: {
  backTitle?: string
  title?: string
  subtitle?: string
  caption?: string
  onBack?: () => void
  openMain: OpenMain
  children: ReactNode
}) {
  const small = backTitle !== undefined
  return (
    <VStack spacing={small ? 10 : 12}>
      {title !== undefined ? (
        <>
          {backTitle && onBack && <BackButton title={backTitle} onClick={onBack} />}
          {/* The title row moves the window (SwiftUI's movable-by-background panel). */}
          <HStack spacing={10} style={drag}>
            <HStack spacing={12} style={{ minWidth: 0 }}>
              <NaviImage name="LogoMark" width={30} height={30} />
              <span className="truncate" style={{ ...F.heading(18), color: T.dark }}>
                {title}
              </span>
            </HStack>
            <Spacer />
            <HeaderButtons openMain={openMain} />
          </HStack>
        </>
      ) : (
        <HStack spacing={10} style={drag}>
          {backTitle && onBack && <BackButton title={backTitle} onClick={onBack} />}
          <Spacer />
          <HeaderButtons openMain={openMain} />
        </HStack>
      )}
      {subtitle && <span style={{ ...F.body(small ? 10 : 12), color: T.purple }}>{subtitle}</span>}
      {caption && <span style={{ ...F.body(small ? 10 : 12), color: T.grayText }}>{caption}</span>}
      {children}
    </VStack>
  )
}

/// "‹ 오늘의 브리핑"
function BackButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${title}(으)로 돌아가기`}
      onClick={onClick}
      style={{ ...noDrag, ...F.body(12), color: T.grayText, display: 'flex', alignItems: 'center', gap: 5, padding: '0 5px', minWidth: 0, alignSelf: 'flex-start' }}
    >
      <NaviIcon name="IconChevron" style={{ transform: 'rotate(90deg)' }} />
      <span className="truncate">{title}</span>
    </button>
  )
}

/// Settings gear and the purple "Resize Button / Expand".
function HeaderButtons({ openMain }: { openMain: OpenMain }) {
  return (
    <HStack spacing={10} style={noDrag}>
      <button type="button" title="설정" aria-label="설정" onClick={() => openMain('settings')} style={{ color: T.grayText, width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <NaviIcon name="SidebarSettings" width={12.6} height={14} />
      </button>
      <button
        type="button"
        title="큰 화면으로 보기"
        aria-label="큰 화면으로 보기"
        onClick={() => openMain(null)}
        style={{ color: T.cardWhite, background: T.purple, borderRadius: 5, padding: 5, width: 32, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <NaviIcon name="IconExpand" size={18} />
      </button>
    </HStack>
  )
}

// MARK: - Shared pieces

/// Figma "Input" at the bottom of the widget. The assistant isn't connected yet, so sending
/// only clears the field.
function PromptInput({ prompt, isOutlined }: { prompt: string; isOutlined?: boolean }) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${isOutlined ? T.border : 'transparent'}` }}>
      {/* TODO: Send to the `assistant` Edge Function once the widget is wired up. */}
      <NaviPromptInput prompt={prompt} onSubmit={() => {}} />
    </div>
  )
}

/// Full-width button under the widget cards ("새 일정 만들기", "이번 주 미리 준비하기").
function WideButton({ title, isPrimary, onClick }: { title: string; isPrimary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover-dim"
      style={{
        ...F.body(12, 'bold'),
        color: isPrimary ? T.cardWhite : T.purple,
        background: isPrimary ? T.purple : T.lavender,
        padding: '10px 0',
        borderRadius: 10,
        width: '100%',
        textAlign: 'center'
      }}
    >
      {title}
    </button>
  )
}

/// White card holding a screen's list.
function Card({ children, spacing = 10, padding = '10px 10px' }: { children: ReactNode; spacing?: number; padding?: string }) {
  return (
    <VStack spacing={spacing} style={{ padding, background: T.cardWhite, borderRadius: 10 }}>
      {children}
    </VStack>
  )
}

// MARK: - Home

/// Figma "00 - 브리핑 · 시작": greeting, then 중요 메일 / 오늘 일정 / 미리 준비할 일 cards.
function HomeScreen({ model, openMain }: { model: FloatingWidgetModel; openMain: OpenMain }) {
  const now = new Date()
  const hour = now.getHours()
  const salutation = hour >= 5 && hour < 12 ? '좋은 아침이에요' : hour >= 12 && hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요'
  const greeting = model.userName ? `${salutation}, ${model.userName}님.` : `${salutation}.`
  const itemCount = model.mails.length + model.events.length + model.openTodos.length
  return (
    <Chrome
      title={greeting}
      subtitle={format(now, 'M월 d일 EEEE · a h:mm')}
      caption={`오늘 놓치면 안 될 ${itemCount}가지를 먼저 정리했어요.`}
      openMain={openMain}
    >
      <BriefSection title={`중요 메일 ${model.mails.length}개`} icon="SidebarMail" tint={T.purple} wash={T.lavender} onViewAll={() => model.setScreen({ kind: 'mails' })}>
        {model.mails.map((mail, index) => (
          <BriefItem key={mail.id} badge={String(index + 1)} title={mail.briefTitle} tint={T.purple} onClick={() => model.setScreen({ kind: 'mailDetail', id: mail.id })} />
        ))}
      </BriefSection>
      <BriefSection title={`오늘 일정 ${model.events.length}개`} icon="SidebarCalendar" tint={T.blue} wash={T.blueLight} onViewAll={() => model.setScreen({ kind: 'events' })}>
        {model.sortedEvents.map((event) => (
          <BriefItem key={event.id} badge={clockTime(event.startAt)} title={event.title} tint={T.blue} onClick={() => model.setScreen({ kind: 'eventDetail', id: event.id })} />
        ))}
      </BriefSection>
      <BriefSection title={`미리 준비할 일 ${model.openTodos.length}개`} icon="SidebarTodo" tint={T.green} wash={T.greenLight} onViewAll={() => model.setScreen({ kind: 'todos' })}>
        {model.openTodos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} model={model} />
        ))}
      </BriefSection>
      <PromptInput prompt="내가 놓친 할 일이 있어?" isOutlined />
    </Chrome>
  )
}

/// Figma "Brief Title" + list: a tinted subtitle chip with the section icon, "전체 보기 ›".
function BriefSection({ title, icon, tint, wash, onViewAll, children }: {
  title: string
  icon: string
  tint: string
  wash: string
  onViewAll: () => void
  children: ReactNode
}) {
  return (
    <Card spacing={8} padding="7px 10px">
      <HStack>
        <HStack spacing={6} style={{ color: tint, background: wash, padding: '2px 5px', borderRadius: 5 }}>
          <span style={{ width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <NaviIcon name={icon} size={13} />
          </span>
          <span style={F.heading(12)}>{title}</span>
        </HStack>
        <Spacer />
        <button type="button" onClick={onViewAll} style={{ ...F.body(12), color: T.grayText, display: 'flex', alignItems: 'center', gap: 5, padding: '0 5px' }}>
          전체 보기
          <NaviIcon name="IconChevron" style={{ transform: 'rotate(-90deg)' }} />
        </button>
      </HStack>
      <VStack spacing={5}>{children}</VStack>
    </Card>
  )
}

/// Figma "Brief Item": a small numbered / time badge and a one-line title.
function BriefItem({ badge, title, tint, onClick }: { badge: string; title: string; tint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 5px', background: T.itemBackground, borderRadius: 4, width: '100%' }}
    >
      <span style={{ ...F.title(8), color: T.cardWhite, background: tint, padding: '3px 5px', borderRadius: 5 }}>{badge}</span>
      <span className="truncate" style={{ ...F.body(12), color: T.ink }}>
        {title}
      </span>
    </button>
  )
}

/// Figma "Action Item" as the widget draws it. Tapping the row opens the todo.
function TodoRow({ todo, model }: { todo: DashboardTodo; model: FloatingWidgetModel }) {
  return (
    <div
      onClick={() => model.setScreen({ kind: 'todoDetail', id: todo.id })}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', background: T.itemBackground, borderRadius: 5, cursor: 'pointer' }}
    >
      <HStack spacing={5} style={{ minWidth: 0, flex: 1 }}>
        <DragHandle />
        <HStack spacing={10} style={{ minWidth: 0 }}>
          <button
            type="button"
            aria-label={`${todo.title} ${todo.isDone ? '완료' : '미완료'}`}
            onClick={(e) => {
              e.stopPropagation()
              model.toggleTodo(todo.id)
            }}
            style={{ display: 'flex' }}
          >
            <NaviCheckbox isChecked={todo.isDone} />
          </button>
          <span className="truncate" style={{ ...F.body(12), color: T.ink, textDecoration: todo.isDone ? 'line-through' : undefined }}>
            {todo.title}
          </span>
        </HStack>
      </HStack>
      <HStack spacing={10} style={{ flexShrink: 0 }}>
        {todo.category && <NaviCategoryTag category={todo.category} />}
        {todo.dueAt && <span style={{ ...F.body(10), color: T.grayText }}>{FloatingWidgetModel.time(todo.dueAt)}</span>}
      </HStack>
    </div>
  )
}

// MARK: - Mail

/// "오늘 08:12", "어제", or "9월 12일".
function receivedText(date: Date): string {
  if (isToday(date)) return `오늘 ${clockTime(date)}`
  if (isSameDay(date, addDays(new Date(), -1))) return '어제'
  return format(date, 'M월 d일')
}

/// "01 - 메일 브리핑": the briefing mails, most urgent first.
function MailListScreen({ model, openMain }: { model: FloatingWidgetModel; openMain: OpenMain }) {
  return (
    <Chrome
      backTitle="오늘의 브리핑"
      title="오늘 확인해야 하는 메일"
      subtitle={`우선 메일 · ${model.mails.length}개`}
      caption="급한 순서대로 정리했어요. 메일을 누르면 답장 초안을 볼 수 있어요."
      onBack={() => model.setScreen({ kind: 'home' })}
      openMain={openMain}
    >
      <Card>
        {model.mails.map((mail) => (
          <button
            key={mail.id}
            type="button"
            onClick={() => model.setScreen({ kind: 'mailDetail', id: mail.id })}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', background: T.itemBackground, borderRadius: 10, width: '100%' }}
          >
            <span style={{ ...F.body(10), color: T.grayText, height: 18, display: 'flex', alignItems: 'center' }}>
              {mail.message.sender.name} · {receivedText(mail.message.receivedAt)}
            </span>
            <span className="truncate" style={{ ...F.heading(14), color: T.ink, maxWidth: '100%' }}>
              {mail.message.subject}
            </span>
            <span className="truncate" style={{ ...F.body(10), color: T.grayText, maxWidth: '100%' }}>
              {mail.actionNote}
            </span>
          </button>
        ))}
      </Card>
      <PromptInput prompt="여기서 제일 빨리 답장해야 하는 메일은 뭐야?" isOutlined />
    </Chrome>
  )
}

const ItemBox = ({ children, spacing = 5 }: { children: ReactNode; spacing?: number }) => (
  <VStack spacing={spacing} style={{ padding: '8px 10px', background: T.itemBackground, borderRadius: 10 }}>
    {children}
  </VStack>
)

/// "01 - 메일 브리핑 > 상세": the message with its AI summary, a suggested todo and event, and
/// the reply draft.
function MailDetailScreen({ model, mail, openMain }: { model: FloatingWidgetModel; mail: FloatingMail; openMain: OpenMain }) {
  const message = mail.message
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(message.receivedAt).getTime()) / DAY)
  const dateText = `${format(message.receivedAt, 'yyyy년 M월 d일')} (${days <= 0 ? '오늘' : `${days}일 전`})`
  const todoAdded = model.addedTodoMailIDs.has(mail.id)
  const eventAdded = model.addedEventMailIDs.has(mail.id)

  const suggestionRow = (leading: ReactNode, text: string, actionTitle: string, isAdded: boolean, onClick: () => void) => (
    <HStack spacing={10} style={{ padding: '8px 10px', background: T.itemBackground, borderRadius: 10 }}>
      {leading}
      <span style={{ ...F.body(12), color: T.ink, flex: 1 }}>{text}</span>
      <NaviPillButton title={actionTitle} style={isAdded ? 'success' : 'accent'} disabled={isAdded} onClick={onClick} />
    </HStack>
  )

  return (
    <Chrome backTitle="오늘 확인해야 하는 메일" onBack={() => model.setScreen({ kind: 'mails' })} openMain={openMain}>
      <Card spacing={15} padding="10px 15px">
        <VStack spacing={10}>
          <span style={{ ...F.title(14), color: T.ink }}>{message.subject}</span>
          <div style={{ height: 1, background: T.border }} />
          <HStack spacing={5}>
            <HStack spacing={10} style={{ minWidth: 0, flex: 1 }}>
              <span style={{ ...F.body(12, 'bold'), color: T.ink, whiteSpace: 'nowrap' }}>{message.sender.name}</span>
              <span className="truncate" style={{ ...F.body(10), color: T.grayText }}>
                &lt;{message.sender.email}&gt;
              </span>
            </HStack>
            <span style={{ ...F.body(10), color: T.grayText, whiteSpace: 'nowrap' }}>{dateText}</span>
          </HStack>
        </VStack>
        <VStack spacing={15}>
          <span className="selectable" style={{ ...F.body(10), color: T.ink, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {message.body}
          </span>
          <VStack spacing={5}>
            {message.summary.length > 0 && (
              <ItemBox>
                <span style={{ ...F.title(12), color: T.purple }}>AI 요약</span>
                {message.summary.map((line, i) => (
                  <HStack key={i} spacing={6} align="baseline" style={{ ...F.body(12), color: T.ink, paddingLeft: 6 }}>
                    <span>•</span>
                    <span>
                      {line.lead ? (
                        <>
                          <b>{line.lead}</b>: {line.text}
                        </>
                      ) : (
                        line.text
                      )}
                    </span>
                  </HStack>
                ))}
              </ItemBox>
            )}
            {message.suggestedTodo &&
              suggestionRow(<NaviCheckbox isChecked={todoAdded} />, message.suggestedTodo, todoAdded ? '추가됨' : '할 일에 추가', todoAdded, () =>
                model.addSuggestedTodo(mail.id)
              )}
            {mail.suggestedEvent &&
              suggestionRow(
                <span style={{ color: T.grayText, width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <NaviIcon name="SidebarCalendar" width={13.35} height={12.69} />
                </span>,
                mail.suggestedEvent,
                eventAdded ? '추가됨' : '일정에 추가',
                eventAdded,
                () => model.setScreen({ kind: 'newEvent', fromMail: mail.id })
              )}
            {message.replyDraft && (
              <ItemBox>
                <span style={{ ...F.title(12), color: T.purple }}>답장 초안</span>
                <VStack spacing={10}>
                  <span style={{ ...F.body(12), color: T.ink, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{message.replyDraft}</span>
                  {/* Review / edit / send lives in the main window's mail tab. */}
                  <WideButton title="검토 후 전송" isPrimary onClick={() => openMain('mail')} />
                </VStack>
              </ItemBox>
            )}
          </VStack>
        </VStack>
      </Card>
    </Chrome>
  )
}

// MARK: - Calendar

/// "02 - 오늘 일정": today's events as schedule blocks.
function EventListScreen({ model, openMain }: { model: FloatingWidgetModel; openMain: OpenMain }) {
  const next = model.nextEvent
  return (
    <Chrome
      backTitle="오늘의 브리핑"
      title="오늘 일정"
      subtitle={`${FloatingWidgetModel.dayTitle()} · 일정 ${model.events.length}개`}
      caption={next ? `다음 일정은 ${clockTime(next.startAt)} ${next.title}이에요.` : '오늘 남은 일정이 없어요.'}
      onBack={() => model.setScreen({ kind: 'home' })}
      openMain={openMain}
    >
      {model.events.length > 0 && (
        <Card>
          {model.sortedEvents.map((event) => (
            <button key={event.id} type="button" onClick={() => model.setScreen({ kind: 'eventDetail', id: event.id })} style={{ width: '100%' }}>
              <ScheduleBlock
                title={event.title}
                timeRange={timeRange(event.startAt, event.endAt)}
                location={event.location}
                tint={event.category ? naviHex(event.category.color) : T.purple}
              />
            </button>
          ))}
        </Card>
      )}
      <VStack spacing={10}>
        <WideButton title="새 일정 만들기" isPrimary onClick={() => model.setScreen({ kind: 'newEvent' })} />
        {/* The weekly prep flow lives in the main window's calendar tab. */}
        <WideButton title="이번 주 미리 준비하기" onClick={() => openMain('calendar')} />
      </VStack>
      <PromptInput prompt="빈 시간에 할 일을 배치해 줘" />
    </Chrome>
  )
}

/// "02 - 오늘 일정 > 상세" / "> 새 일정": the main window's event form inside the widget.
function EventFormScreen({ model, title, eventID, fromMail, openMain }: {
  model: FloatingWidgetModel
  title: string
  eventID?: string
  fromMail?: string
  openMain: OpenMain
}) {
  const [initialDraft] = useState(() => {
    const event = eventID ? model.event(eventID) : undefined
    return event ? model.draft(event) : model.newEventDraft(fromMail)
  })
  const goBack = () => model.setScreen(fromMail ? { kind: 'mailDetail', id: fromMail } : { kind: 'events' })
  return (
    <Chrome backTitle={(fromMail && model.mail(fromMail)?.message.subject) || '오늘 일정'} onBack={goBack} openMain={openMain}>
      <div style={{ height: 560, display: 'flex', flexDirection: 'column' }}>
        <NewEventPanel
          categories={model.calendarCategories}
          initialDraft={initialDraft}
          panelTitle={title}
          onCancel={goBack}
          onSave={async (draft) => {
            // TODO: Write through the `calendar` Edge Function once the widget is wired up.
            model.saveEvent(draft, eventID)
            if (fromMail) model.markEventAdded(fromMail)
            goBack()
          }}
        />
      </div>
    </Chrome>
  )
}

// MARK: - Todo

/// "03 - 오늘 할 일": today's todos with an inline add row.
function TodoListScreen({ model, openMain }: { model: FloatingWidgetModel; openMain: OpenMain }) {
  const [newTitle, setNewTitle] = useState('')
  const [newCategory, setNewCategory] = useState<NaviCategory | undefined>(model.todoCategories[0])
  const add = () => {
    // TODO: Insert through the `todos` TABLE once the widget is wired up.
    model.addTodo(newTitle, newCategory, model.newTodoDueAt)
    setNewTitle('')
  }
  return (
    <Chrome
      backTitle="오늘의 브리핑"
      title="오늘 할 일"
      subtitle={`${FloatingWidgetModel.dayTitle()} · 할 일 ${model.todos.length}개`}
      onBack={() => model.setScreen({ kind: 'home' })}
      openMain={openMain}
    >
      <Card>
        {model.todos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} model={model} />
        ))}
        {/* Figma's add row: checkbox, "할 일 추가" field, a compact category picker, and the time. */}
        <HStack spacing={10} style={{ padding: '5px 10px', background: T.itemBackground, borderRadius: 5 }}>
          <HStack spacing={10} style={{ flex: 1, minWidth: 0 }}>
            <NaviCheckbox isChecked={false} />
            <input
              value={newTitle}
              placeholder="할 일 추가"
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
              style={{ ...F.body(12), color: T.ink }}
            />
          </HStack>
          <HStack spacing={10} style={{ flexShrink: 0 }}>
            <NaviMenu
              ariaLabel="카테고리"
              align="right"
              items={[
                { title: '카테고리 없음', action: () => setNewCategory(undefined) },
                ...model.todoCategories.map((c) => ({ title: c.name, action: () => setNewCategory(c) }))
              ]}
              label={
                <HStack spacing={3} style={{ padding: 3, background: T.cardWhite, borderRadius: 5, border: `1px solid ${T.border}` }}>
                  {newCategory ? <NaviCategoryTag category={newCategory} /> : <span style={{ ...F.body(9), color: T.grayText, padding: '0 6px' }}>없음</span>}
                  <span style={{ color: T.ink, display: 'flex' }}>
                    <NaviIcon name="IconChevron" size={10} />
                  </span>
                </HStack>
              }
            />
            <span style={{ ...F.body(10), color: T.grayText }}>{FloatingWidgetModel.time(model.newTodoDueAt)}</span>
          </HStack>
        </HStack>
      </Card>
      {/* The weekly prep flow lives in the main window's todo tab. */}
      <WideButton title="이번 주 미리 준비하기" onClick={() => openMain('todo')} />
      <PromptInput prompt="오늘 할 일과 관련된 다른 할 일이 있을까?" />
    </Chrome>
  )
}

/// "03 - 오늘 할 일 > 상세": title, deadline, category, and subtasks.
function TodoDetailScreen({ model, todo, openMain }: { model: FloatingWidgetModel; todo: DashboardTodo; openMain: OpenMain }) {
  const [title, setTitle] = useState(todo.title)
  const [newSubtask, setNewSubtask] = useState('')
  const titleRef = useRef(title)
  titleRef.current = title
  useEffect(() => () => model.renameTodo(todo.id, titleRef.current), [model, todo.id])

  return (
    <Chrome backTitle="오늘 할 일" onBack={() => model.setScreen({ kind: 'todos' })} openMain={openMain}>
      <Card spacing={20} padding="20px">
        <NaviPanelHeader title="할 일 상세" />
        <HStack spacing={10}>
          <button type="button" aria-label={todo.isDone ? '완료 취소' : '완료'} onClick={() => model.toggleTodo(todo.id)} style={{ display: 'flex' }}>
            <NaviCheckbox isChecked={todo.isDone} size={18} uncheckedBorder={T.border} />
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && model.renameTodo(todo.id, title)}
            style={{ ...F.body(16, 'bold'), color: T.ink, textDecoration: todo.isDone ? 'line-through' : undefined }}
          />
        </HStack>
        <button type="button" onClick={() => model.setScreen({ kind: 'deadline', id: todo.id })} style={{ width: '100%' }}>
          <NaviFieldBox title="기한">
            <HStack>
              {deadlineText(todo.dueAt)}
              <Spacer />
              <NaviIcon name="IconChevron" style={{ transform: 'rotate(-90deg)' }} />
            </HStack>
          </NaviFieldBox>
        </button>
        <HStack>
          <span style={{ ...F.title(14), color: T.dark }}>카테고리</span>
          <Spacer />
          <NaviCategoryPicker categories={model.todoCategories} selection={todo.category} onChange={(c) => model.setCategory(c, todo.id)} />
        </HStack>
        <VStack spacing={10}>
          <HStack>
            <span style={{ ...F.title(16), color: T.dark }}>하위 할 일</span>
            <Spacer />
            {todo.subtasks.length > 0 && (
              <span style={{ ...F.tag(9), color: T.ink, padding: '2px 10px', background: T.limeLight, borderRadius: 10 }}>
                {todo.subtasks.filter((s) => s.isDone).length}/{todo.subtasks.length} 완료
              </span>
            )}
          </HStack>
          <VStack spacing={3} style={{ padding: '0 5px' }}>
            {todo.subtasks.map((subtask) => (
              <button
                key={subtask.id}
                type="button"
                onClick={() => model.toggleSubtask(subtask.id, todo.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 7px', width: '100%' }}
              >
                <NaviCheckbox isChecked={subtask.isDone} />
                <span style={{ ...F.body(12), color: T.ink, textDecoration: subtask.isDone ? 'line-through' : undefined }}>{subtask.title}</span>
              </button>
            ))}
            <HStack spacing={10} style={{ padding: '5px 7px', background: T.itemBackground, borderRadius: 5 }}>
              <NaviCheckbox isChecked={false} />
              <input
                value={newSubtask}
                placeholder="할 일 추가"
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                  model.addSubtask(newSubtask, todo.id)
                  setNewSubtask('')
                }}
                style={F.body(12)}
              />
            </HStack>
          </VStack>
        </VStack>
      </Card>
      <PromptInput prompt="오늘 할 일과 관련된 다른 할 일이 있을까?" />
    </Chrome>
  )
}
