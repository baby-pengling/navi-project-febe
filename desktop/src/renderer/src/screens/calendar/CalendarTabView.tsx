import { useEffect, useState, type ReactNode } from 'react'
import { F, T, naviHex, wash } from '@/lib/theme'
import { format } from '@/lib/dates'
import { useModel } from '@/lib/observable'
import type { PrepCriteria } from '@/data/edge'
import type { CalendarMode, CalendarTabModel } from '@/models/calendar'
import {
  HStack,
  NaviCategoryTag,
  NaviCheckCircle,
  NaviDialogButton,
  NaviIcon,
  NaviPanelHeader,
  NaviPillButton,
  NaviSectionHeader,
  NaviSegmentTabs,
  NaviTabHeader,
  Spacer,
  VStack
} from '@/components/core'
import { DayTimeline, ErrorText, NaviCheckbox, NewEventPanel, TodoItemRow, dashboardMeta } from '@/components/shared'
import { PrepAddedPanel, PrepDetailPanel, SuggestionCard } from '@/components/todoPanels'
import { NaviAssistantPrompt } from '@/components/AssistantPrompt'

const MODES: CalendarMode[] = ['week', 'month']

/// White card used by the calendar's columns.
function Pane({ children, spacing = 10, style }: { children: ReactNode; spacing?: number; style?: React.CSSProperties }) {
  return (
    <VStack spacing={spacing} style={{ padding: '15px 20px', background: T.cardWhite, borderRadius: 10, flex: 1, minHeight: 0, ...style }}>
      {children}
    </VStack>
  )
}

/// Figma "09 일정 (주)" and "09 일정 (월)".
export function CalendarTabView({ model, onAddCategory, onStartPrep }: {
  model: CalendarTabModel
  onAddCategory: () => void
  /** Opens the "이번 주 준비를 정리하고 있어요" dialog. */
  onStartPrep: () => void
}) {
  useModel(model)
  // Re-render when the linked todos change.
  useModel(model.todoModel)

  useEffect(() => {
    void model.load()
  }, [model])

  const panel = model.panel
  const selectedEventID = panel.kind === 'eventDetail' ? panel.id : undefined
  const overview = () => model.set('panel', { kind: 'overview' })
  const categories = model.categories.map((c) => c.category)

  const navButton = (rotation: number, label: string, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{ color: T.ink, padding: '0 5px', height: 32, background: T.cardWhite, borderRadius: 5, display: 'flex', alignItems: 'center' }}
    >
      <NaviIcon name="IconChevron" style={{ transform: `rotate(${rotation}deg)` }} />
    </button>
  )

  const rightPanel = (() => {
    switch (panel.kind) {
      case 'overview':
        return <CalendarOverviewPanels model={model} onAddCategory={onAddCategory} />
      case 'newEvent':
        return (
          <NewEventPanel categories={categories} initialDraft={model.makeEventDraft()} onCancel={overview} onSave={(draft) => model.addEvent(draft)} />
        )
      case 'eventDetail': {
        const event = model.event(panel.id)
        if (!event) return null
        return (
          <NewEventPanel
            key={event.id}
            categories={categories}
            initialDraft={model.draft(event)}
            panelTitle={event.title}
            onCancel={overview}
            onSave={(draft) => model.updateEvent(event.id, draft)}
          />
        )
      }
      case 'dayDetail':
        return (
          <Pane spacing={15}>
            <NaviPanelHeader title={format(model.selectedDay, 'M월 d일 · EEEE')} onClose={overview} />
            <DayTimeline
              day={model.selectedDay}
              events={model.eventsOn(model.selectedDay)}
              onSelect={(e) => model.set('panel', { kind: 'eventDetail', id: e.id })}
            />
          </Pane>
        )
      case 'prep':
        return <CalendarPrepPanel model={model} />
      case 'prepCriteria':
        return <PrepCriteriaPanel model={model} onRecommend={onStartPrep} />
      case 'prepDetail': {
        const suggestion = model.suggestions.find((s) => s.id === panel.id)
        if (!suggestion) return null
        return (
          <PrepDetailPanel
            key={suggestion.id}
            categories={model.todoModel.categories}
            initial={suggestion}
            onCancel={() => model.set('panel', { kind: 'prep' })}
            onAdd={(s) => model.addSuggestion(s)}
          />
        )
      }
      case 'prepAdded':
        return <PrepAddedPanel added={panel.suggestions} onClose={overview} />
    }
  })()

  const rightColumn = (width: number) => (
    <VStack spacing={10} style={{ width, flexShrink: 0, minHeight: 0 }}>
      <VStack spacing={10} style={{ flex: 1, minHeight: 0 }}>
        {rightPanel}
      </VStack>
      <NaviAssistantPrompt prompt="빈 시간에 할 일을 배치해 줘" />
    </VStack>
  )

  return (
    <VStack spacing={10} style={{ height: '100%' }}>
      <NaviTabHeader title="일정" searchPrompt="일정 검색" searchText={model.searchText} onSearchChange={(t) => model.set('searchText', t)} />

      {/* Toolbar: "2026년 9월", 주/월, ‹ 오늘 ›, 이번 주 미리 준비, 새 일정 */}
      <HStack spacing={15}>
        <span style={{ ...F.title(22), color: T.dark }}>{model.monthTitle}</span>
        <Spacer />
        <NaviSegmentTabs items={MODES} selection={model.mode} onSelect={(m) => model.set('mode', m)} title={(m) => (m === 'week' ? '주' : '월')} />
        <HStack spacing={5}>
          {navButton(90, '이전', () => model.step(-1))}
          <button
            type="button"
            onClick={() => model.goToToday()}
            style={{ ...F.heading(12), color: T.grayText, padding: '0 15px', height: 32, background: T.cardWhite, borderRadius: 5 }}
          >
            오늘
          </button>
          {navButton(-90, '다음', () => model.step(1))}
        </HStack>
        <NaviPillButton title="이번 주 미리 준비" size="large" onClick={onStartPrep} />
        <NaviPillButton title="새 일정" icon="IconPlus" style="primary" size="large" onClick={() => model.set('panel', { kind: 'newEvent' })} />
      </HStack>

      {model.mode === 'week' ? (
        <VStack spacing={10} style={{ flex: 1, minHeight: 0 }}>
          <HStack spacing={4}>
            {model.weekDays.map((day) => {
              const isSelected = model.isSelected(day)
              return (
                <button
                  key={day.getTime()}
                  type="button"
                  onClick={() => model.select(day)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                    padding: '10px 0',
                    background: isSelected ? T.lavender : T.cardWhite,
                    borderRadius: 10,
                    border: `1px solid ${isSelected ? T.purple : 'transparent'}`
                  }}
                >
                  <span style={{ ...F.paperlogy(12, 'medium'), color: isSelected ? T.purple : T.grayText }}>{format(day, 'E')}</span>
                  <span style={{ ...F.paperlogy(18, 'heavy'), color: isSelected ? T.purple : T.dark }}>{format(day, 'd')}</span>
                </button>
              )
            })}
          </HStack>
          <HStack spacing={10} align="stretch" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
            <Pane spacing={15}>
              <span style={{ ...F.heading(18), color: T.ink }}>{model.dayTitle}</span>
              <DayTimeline
                day={model.selectedDay}
                events={model.eventsOn(model.selectedDay)}
                selectedEventID={selectedEventID}
                onSelect={(e) => model.set('panel', { kind: 'eventDetail', id: e.id })}
              />
            </Pane>
            {rightColumn(439)}
          </HStack>
        </VStack>
      ) : (
        <HStack spacing={10} align="stretch" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0, background: T.cardWhite, borderRadius: 10, overflow: 'hidden' }}>
            <MonthCalendarGrid model={model} />
          </div>
          {rightColumn(284)}
        </HStack>
      )}
    </VStack>
  )
}

// MARK: - Month grid

/// Figma "September 2026 · month grid": weekday header, then one row per week; today's number
/// is a purple square, the selected day's column is tinted, and events are small tinted chips.
function MonthCalendarGrid({ model }: { model: CalendarTabModel }) {
  const weeks = model.monthWeeks
  const line = `1px solid ${T.border}`
  return (
    <div style={{ display: 'grid', gridTemplateRows: `36px repeat(${weeks.length}, 1fr)`, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: line }}>
        {['일', '월', '화', '수', '목', '금', '토'].map((name, index) => (
          <span
            key={name}
            style={{
              ...F.paperlogy(14),
              color: T.grayMain,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderLeft: index > 0 ? line : undefined
            }}
          >
            {name}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].getTime()} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: line, minHeight: 0 }}>
          {week.map((day, index) => {
            const isToday = model.isToday(day)
            const inMonth = model.isInSelectedMonth(day)
            const events = model.eventsOn(day)
            return (
              <button
                key={day.getTime()}
                type="button"
                aria-label={`${format(day, 'M월 d일')}, 일정 ${events.length}개`}
                onClick={() => model.select(day)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  padding: '6px 7px 0',
                  minWidth: 0,
                  overflow: 'hidden',
                  borderLeft: index > 0 ? line : undefined,
                  background: model.isSelected(day) && model.panel.kind === 'dayDetail' ? T.selectedCell : T.cardWhite
                }}
              >
                <span
                  style={{
                    ...F.body(10, isToday ? 'bold' : 'regular'),
                    color: isToday ? T.cardWhite : inMonth ? T.primaryText : T.border,
                    background: isToday ? T.purple : 'transparent',
                    width: 23,
                    height: 23,
                    borderRadius: 5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {day.getDate()}
                </span>
                {events.slice(0, 3).map((event) => {
                  const tint = event.category ? naviHex(event.category.color) : T.purple
                  return (
                    <span
                      key={event.id}
                      className="truncate"
                      style={{
                        ...F.body(10, 'bold'),
                        color: tint,
                        background: wash(tint, 0.14),
                        borderRadius: 3,
                        padding: '0 4px',
                        height: 20,
                        lineHeight: '20px',
                        width: '100%',
                        flexShrink: 0
                      }}
                    >
                      {event.title}
                    </span>
                  )
                })}
                {events.length > 3 && <span style={{ ...F.body(9), color: T.grayText }}>+{events.length - 3}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// MARK: - Overview panels

function CalendarOverviewPanels({ model, onAddCategory }: { model: CalendarTabModel; onAddCategory: () => void }) {
  return (
    <>
      <Pane>
        <NaviSectionHeader title="일정에서 만든 할 일" tag={`${model.calendarTodos.length}개`} />
        <VStack spacing={7} className="scroll" style={{ minHeight: 0 }}>
          {model.calendarTodos.length === 0 && (
            <span style={{ ...F.body(12), color: T.grayText }}>일정에서 만든 할 일이 아직 없어요. "이번 주 미리 준비"로 추천을 받아 보세요.</span>
          )}
          {model.calendarTodos.map((todo) => (
            <TodoItemRow
              key={todo.id}
              todo={todo}
              meta={dashboardMeta(todo)}
              showsDetails={false}
              onToggle={() => model.todoModel.toggle(todo.id)}
              onOpen={() => {}}
            />
          ))}
        </VStack>
      </Pane>
      <Pane spacing={15}>
        <HStack>
          <span style={{ ...F.heading(18), color: T.ink }}>카테고리</span>
          <Spacer />
          <NaviPillButton title="추가" icon="IconPlus" onClick={onAddCategory} />
        </HStack>
        <VStack spacing={10} className="scroll" style={{ padding: '0 10px', minHeight: 0 }}>
          {model.categories.length === 0 && <span style={{ ...F.body(12), color: T.grayText }}>카테고리를 추가해 일정을 나눠 보세요.</span>}
          {model.categories.map((item) => (
            <button
              key={item.category.id}
              type="button"
              aria-label={`${item.category.name} 표시`}
              aria-pressed={item.isVisible}
              onClick={() => model.toggleVisibility(item.category.id)}
              style={{ display: 'flex', alignItems: 'center', width: '100%' }}
            >
              <NaviCategoryTag category={item.category} fontSize={11} />
              <Spacer />
              <NaviCheckbox isChecked={item.isVisible} />
            </button>
          ))}
        </VStack>
        {model.errorMessage && <ErrorText>{model.errorMessage}</ErrorText>}
      </Pane>
    </>
  )
}

// MARK: - Prep panels

function CalendarPrepPanel({ model }: { model: CalendarTabModel }) {
  return (
    <Pane>
      <NaviPanelHeader title="이번 주 미리 준비" onClose={() => model.set('panel', { kind: 'overview' })} />
      <span style={{ ...F.body(12), color: T.grayText }}>
        {model.weekRangeText} · 추천을 검토해 주세요.
        <br />
        선택한 항목만 반영하며, 일정은 바꾸지 않아요.
      </span>
      <HStack>
        <NaviDialogButton title="추천 기준 확인" role="secondary" onClick={() => model.set('panel', { kind: 'prepCriteria' })} />
      </HStack>
      <VStack spacing={5} className="scroll" style={{ flex: 1, minHeight: 0 }}>
        {model.suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            onToggle={() => model.toggleSuggestion(suggestion.id)}
            onOpen={() => model.set('panel', { kind: 'prepDetail', id: suggestion.id })}
          />
        ))}
      </VStack>
      <AddSelectedButton isEnabled={model.suggestions.some((s) => s.isSelected)} onAdd={() => model.addSelectedSuggestions()} />
    </Pane>
  )
}

function AddSelectedButton({ isEnabled, onAdd }: { isEnabled: boolean; onAdd: () => Promise<void> }) {
  const [isAdding, setAdding] = useState(false)
  return (
    <HStack>
      <NaviDialogButton
        title={isAdding ? '추가 중…' : '선택한 할 일 추가'}
        isEnabled={isEnabled && !isAdding}
        onClick={async () => {
          setAdding(true)
          await onAdd()
          setAdding(false)
        }}
      />
    </HStack>
  )
}

const CRITERIA: { key: keyof PrepCriteria; title: string }[] = [
  { key: 'mail', title: '메일' },
  { key: 'incompleteTodos', title: '미완료 할 일' },
  { key: 'relatedTodos', title: '연관 할 일' },
  { key: 'userPattern', title: '사용자 패턴' }
]

function PrepCriteriaPanel({ model, onRecommend }: { model: CalendarTabModel; onRecommend: () => void }) {
  return (
    <Pane>
      <NaviPanelHeader title="추천 기준" onClose={() => model.set('panel', { kind: 'overview' })} />
      {CRITERIA.map(({ key, title }) => (
        <button
          key={key}
          type="button"
          aria-pressed={model.criteria[key]}
          onClick={() => model.set('criteria', { ...model.criteria, [key]: !model.criteria[key] })}
          style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', background: T.itemBackground, borderRadius: 6, width: '100%' }}
        >
          <span style={{ ...F.title(14), color: T.ink }}>{title}</span>
          <Spacer />
          <NaviCheckCircle isOn={model.criteria[key]} />
        </button>
      ))}
      <span style={{ ...F.body(12), color: T.grayText }}>
        패턴: 최근 4주 · 준비 완료 시점
        <br />
        미연동 서비스의 정보는 사용하지 않아요.
      </span>
      <Spacer />
      <HStack>
        <NaviDialogButton title="이 기준으로 다시 추천" onClick={onRecommend} />
      </HStack>
    </Pane>
  )
}
