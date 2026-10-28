import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { F, T, naviHex, wash } from '@/lib/theme'
import { format, isSameDay, isToday, isTomorrow } from '@/lib/dates'
import { isServerError, isUnavailable } from '@/data/edge'
import { isEventDraftValid, isTodoDraftValid, type DashboardEvent, type DashboardTodo, type NaviCategory, type NewEventDraft, type NewTodoDraft, type SubtaskProgress } from '@/data/types'
import type { TodoMeta } from '@/models/todo'
import {
  HStack,
  NaviCategoryPicker,
  NaviCategoryTag,
  NaviCloseButton,
  NaviDateField,
  NaviDialogButton,
  NaviIcon,
  NaviImage,
  NaviPanel,
  NaviPanelHeader,
  NaviTextField,
  Spacer,
  VStack
} from './core'

// Port of TodoItemRow.swift, DayTimeline.swift, and DashboardPanels.swift.

/// SwiftUI `TimelineView(.everyMinute)`: the current time, refreshed every minute.
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/// "09:00"
export const clockTime = (date: Date) => format(date, 'HH:mm')

// MARK: - Todo row

/// Dashboard caption: "오늘 12:00" / "내일 11:00" / "9/28 09:00" for dated todos, otherwise
/// where it came from.
export function dashboardMeta(todo: DashboardTodo): TodoMeta | undefined {
  if (todo.dueAt) {
    const time = clockTime(todo.dueAt)
    if (isToday(todo.dueAt)) return { text: `오늘 ${time}` }
    if (isTomorrow(todo.dueAt)) return { text: `내일 ${time}` }
    return { text: `${format(todo.dueAt, 'M/d')} ${time}` }
  }
  if (todo.source === 'mail_suggestion') return { text: '메일에서 생성됨' }
  if (todo.source === 'calendar_suggestion') return { text: '일정에서 생성됨' }
  return undefined
}

/// HTML5 drag and drop for todo rows: the payload is the todo id.
export function useTodoDrag(id: string, onDrop?: (draggedID: string) => void) {
  const [isTarget, setTarget] = useState(false)
  return {
    isTarget,
    props: {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData('application/x-navi-todo', id)
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e: React.DragEvent) => {
        if (!onDrop || !e.dataTransfer.types.includes('application/x-navi-todo')) return
        e.preventDefault()
        setTarget(true)
      },
      onDragLeave: () => setTarget(false),
      onDrop: (e: React.DragEvent) => {
        setTarget(false)
        const dragged = e.dataTransfer.getData('application/x-navi-todo')
        if (dragged && onDrop) {
          e.preventDefault()
          onDrop(dragged)
        }
      }
    }
  }
}

/// Figma "Action Item": drag handle, checkbox, title (+ subtask chevron) on the left;
/// subtask progress, category tag, and a due time / origin caption on the right.
export function TodoItemRow({ todo, meta, isSelected, showsDetails = true, onToggle, onOpen, onDropTodo, onClick }: {
  todo: DashboardTodo
  meta?: TodoMeta
  isSelected?: boolean
  /** Progress, category tag, and subtask chevron; the calendar's list shows only the caption. */
  showsDetails?: boolean
  onToggle: () => void
  onOpen: () => void
  /** Drop target: another todo was dropped on this row. */
  onDropTodo?: (draggedID: string) => void
  onClick?: () => void
}) {
  const drag = useTodoDrag(todo.id, onDropTodo)
  return (
    <div
      {...drag.props}
      onClick={onClick}
      className={drag.isTarget ? 'drop-target' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 5,
        background: isSelected ? T.lavender : T.itemBackground,
        border: `1px solid ${isSelected ? T.purple : 'transparent'}`,
        cursor: onClick ? 'pointer' : undefined
      }}
    >
      <HStack spacing={15} style={{ minWidth: 0, flex: 1 }}>
        <DragHandle />
        <HStack spacing={10} style={{ minWidth: 0 }}>
          <button
            type="button"
            aria-label={`${todo.title} ${todo.isDone ? '완료' : '미완료'}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            style={{ display: 'flex' }}
          >
            <NaviCheckbox isChecked={todo.isDone} />
          </button>
          <span
            className="truncate"
            style={{ ...F.body(12), color: T.ink, textDecoration: todo.isDone ? 'line-through' : undefined }}
          >
            {todo.title}
          </span>
          {showsDetails && todo.subtaskProgress && (
            <button
              type="button"
              aria-label="하위 할 일 보기"
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
              style={{ color: T.ink, display: 'flex' }}
            >
              <NaviIcon name="IconChevron" style={{ transform: 'rotate(-90deg)' }} />
            </button>
          )}
        </HStack>
      </HStack>
      <HStack spacing={10} style={{ flexShrink: 0 }}>
        {showsDetails && todo.subtaskProgress && <SubtaskProgressBar progress={todo.subtaskProgress} />}
        {showsDetails && todo.category && <NaviCategoryTag category={todo.category} />}
        {meta && (
          <span style={{ ...F.body(10), color: meta.isOverdue ? T.red : T.graySecondary, whiteSpace: 'nowrap' }}>{meta.text}</span>
        )}
      </HStack>
    </div>
  )
}

/// Figma "Drag" icon: a 2×3 grid of 2pt dots at 40% opacity.
export function DragHandle() {
  return (
    <span
      aria-hidden
      style={{
        width: 15,
        height: 15,
        display: 'grid',
        gridTemplateColumns: '2px 2px',
        gridAutoRows: '2px',
        gap: 2,
        alignContent: 'center',
        justifyContent: 'center',
        opacity: 0.4,
        cursor: 'grab',
        flexShrink: 0
      }}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} style={{ background: T.grayText, borderRadius: 1 }} />
      ))}
    </span>
  )
}

/// Figma "Checkbox": outlined when open, filled gray with a white check when done.
export function NaviCheckbox({ isChecked, size = 15, uncheckedBorder = T.graySecondary }: {
  isChecked: boolean
  size?: number
  uncheckedBorder?: string
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 2,
        background: isChecked ? T.graySecondary : T.cardWhite,
        border: isChecked ? 'none' : `1px solid ${uncheckedBorder}`,
        color: T.cardWhite,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      {isChecked && <NaviIcon name="IconCheck" width={size * 0.69} height={size * 0.5} />}
    </span>
  )
}

export function SubtaskProgressBar({ progress }: { progress: SubtaskProgress }) {
  const fraction = progress.total > 0 ? progress.done / progress.total : 0
  return (
    <HStack spacing={5} aria-label={`하위 할 일 ${progress.total}개 중 ${progress.done}개 완료`}>
      <span style={{ width: 100, height: 7, borderRadius: 3, background: T.cardWhite, overflow: 'hidden', display: 'block' }}>
        <span style={{ width: 100 * fraction, height: 7, borderRadius: 3, background: T.purple, display: 'block' }} />
      </span>
      <span style={{ ...F.body(10), color: T.grayText }}>
        {progress.done}/{progress.total}
      </span>
    </HStack>
  )
}

// MARK: - Day timeline

const HOUR_HEIGHT = 72
/// Each hour's line sits half a label below its slot's top, so a slot scrolled to the top
/// keeps its label fully visible.
const TOP_INSET = 6

const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes()
const yFor = (date: Date) => TOP_INSET + (minutesOf(date) / 60) * HOUR_HEIGHT

/// Figma "Schedule - Hour" / "Schedule Block": an hourly ruler with event blocks laid out
/// proportionally and, for today, a red current-time marker. Scrolls to the current hour (or
/// the first event, if earlier) on appear. Used by the dashboard and the calendar tab.
export function DayTimeline({ day, events, showsLocation = true, selectedEventID, onSelect, style }: {
  day: Date
  events: DashboardEvent[]
  showsLocation?: boolean
  selectedEventID?: string
  onSelect?: (event: DashboardEvent) => void
  style?: CSSProperties
}) {
  const now = useNow()
  const scrollRef = useRef<HTMLDivElement>(null)
  const showsNow = isSameDay(now, day)

  useLayoutEffect(() => {
    const firstEvent = events.filter((e) => !e.isAllDay).map((e) => e.startAt.getHours())
    const first = firstEvent.length ? Math.min(...firstEvent) : undefined
    const hour = isToday(day) ? Math.min(new Date().getHours(), first ?? 24) : (first ?? 8)
    scrollRef.current?.scrollTo({ top: hour * HOUR_HEIGHT })
    // Scroll on appear and when the day changes, like the Swift view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.getTime()])

  const isNearNow = (hour: number) => Math.abs(minutesOf(now) - hour * 60) < 10

  return (
    <div ref={scrollRef} className="scroll" style={{ flex: 1, minHeight: 0, position: 'relative', ...style }}>
      <div style={{ position: 'relative', height: 24 * HOUR_HEIGHT }}>
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} style={{ height: HOUR_HEIGHT }}>
            <HStack spacing={15} style={{ height: 12 }}>
              <span
                style={{
                  ...F.body(10, 'semibold'),
                  letterSpacing: 1,
                  color: T.grayText,
                  width: 35,
                  textAlign: 'right',
                  opacity: showsNow && isNearNow(hour) ? 0 : 1
                }}
              >
                {String(hour).padStart(2, '0')}:00
              </span>
              <span style={{ flex: 1, height: 1, background: T.border }} />
            </HStack>
          </div>
        ))}

        {events
          .filter((e) => !e.isAllDay && isSameDay(e.startAt, day))
          .map((event) => {
            const height = Math.max(yFor(event.endAt) - yFor(event.startAt) - 6, 34)
            const tint = event.category ? naviHex(event.category.color) : T.purple
            return (
              <div
                key={event.id}
                onClick={() => onSelect?.(event)}
                style={{
                  position: 'absolute',
                  top: yFor(event.startAt) + 3,
                  left: 50,
                  right: 0,
                  height,
                  borderRadius: 5,
                  overflow: 'hidden',
                  border: `1px solid ${event.id === selectedEventID ? tint : 'transparent'}`,
                  cursor: onSelect ? 'pointer' : undefined
                }}
              >
                <ScheduleBlock
                  title={event.title}
                  timeRange={timeRange(event.startAt, event.endAt)}
                  location={showsLocation ? event.location : undefined}
                  tint={tint}
                  isCompact={height < 54}
                  style={{ height: '100%' }}
                />
              </div>
            )
          })}

        {showsNow && (
          <HStack
            spacing={15}
            aria-label={`현재 시각 ${clockTime(now)}`}
            style={{ position: 'absolute', top: yFor(now) - 6, left: 0, right: 0, height: 12, pointerEvents: 'none' }}
          >
            <span style={{ ...F.body(10, 'semibold'), letterSpacing: 1, color: T.red, width: 35, textAlign: 'right' }}>
              {clockTime(now)}
            </span>
            <HStack spacing={0} style={{ flex: 1 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: T.redLight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: T.red }} />
              </span>
              <span style={{ flex: 1, height: 1, background: T.red }} />
            </HStack>
          </HStack>
        )}
      </div>
    </div>
  )
}

// MARK: - Schedule block

/// "09:00 - 10:00"
export const timeRange = (start: Date, end: Date) => `${clockTime(start)} - ${clockTime(end)}`

/// Figma "Schedule Block": category-tinted card with the title, a clock + time range, and an
/// optional "| 📍 location". Short events collapse to one line.
export function ScheduleBlock({ title, timeRange, location, tint, isCompact, style }: {
  title: string
  timeRange: string
  location?: string
  tint: string
  isCompact?: boolean
  style?: CSSProperties
}) {
  const details = (
    <HStack spacing={5} style={{ ...F.body(9, 'bold'), minWidth: 0 }}>
      <span style={{ width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <NaviIcon name="IconClock" size={12} />
      </span>
      <span style={{ whiteSpace: 'nowrap' }}>{timeRange}</span>
      {location && (
        <>
          <span>|</span>
          <span style={{ width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <NaviIcon name="IconLocation" width={10} height={12} />
          </span>
          <span className="truncate">{location}</span>
        </>
      )}
    </HStack>
  )
  const titleText = (
    <span className="truncate" style={F.title(14)}>
      {title}
    </span>
  )
  return (
    <div
      style={{
        color: tint,
        padding: '8px 12px',
        width: '100%',
        background: wash(tint, 0.14),
        borderRadius: 5,
        display: 'flex',
        flexDirection: isCompact ? 'row' : 'column',
        alignItems: isCompact ? 'center' : 'flex-start',
        gap: isCompact ? 8 : 5,
        overflow: 'hidden',
        ...style
      }}
    >
      {titleText}
      {details}
    </div>
  )
}

// MARK: - New todo

function useSave<T>(onSave: (value: T) => Promise<void>, errorFor: (error: unknown) => string) {
  const [isSaving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const save = async (value: T) => {
    if (isSaving) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(value)
    } catch (error) {
      setSaveError(errorFor(error))
    } finally {
      setSaving(false)
    }
  }
  return { isSaving, saveError, save }
}

function FieldRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <HStack>
      <span style={{ ...F.title(14), color: T.dark }}>{title}</span>
      <Spacer />
      {children}
    </HStack>
  )
}

export function NewTodoPanel({ categories, initialDraft, onCancel, onSave }: {
  categories: NaviCategory[]
  initialDraft: NewTodoDraft
  onCancel: () => void
  onSave: (draft: NewTodoDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState(initialDraft)
  const { isSaving, saveError, save } = useSave(onSave, () => '할 일을 저장하지 못했어요. 다시 시도해 주세요.')
  const submit = () => {
    if (isTodoDraftValid(draft)) save(draft)
  }
  return (
    <NaviPanel fillsHeight>
      <NaviPanelHeader title="새 할 일" onClose={onCancel} />
      <NaviTextField title="할 일" size="compact" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} onSubmit={submit} autoFocus />
      <NaviDateField title="기한" date={draft.dueAt} onChange={(dueAt) => setDraft({ ...draft, dueAt })} />
      <FieldRow title="카테고리">
        <NaviCategoryPicker categories={categories} selection={draft.category} onChange={(category) => setDraft({ ...draft, category })} />
      </FieldRow>
      <Spacer />
      {saveError && <ErrorText>{saveError}</ErrorText>}
      <HStack spacing={8}>
        <NaviDialogButton title="취소" role="cancel" onClick={onCancel} />
        <NaviDialogButton title={isSaving ? '저장 중…' : '할 일 저장'} isEnabled={isTodoDraftValid(draft) && !isSaving} onClick={submit} />
      </HStack>
    </NaviPanel>
  )
}

/// "9월 17일 · 오후 5:00"
export const dueText = (date: Date) => format(date, 'M월 d일 · a h:mm')

/// "할 일 추가 완료": green check, summary card of the new todo, and a way to the todo list.
export function TodoAddedPanel({ todo, onClose, onOpenTodos }: { todo: DashboardTodo; onClose: () => void; onOpenTodos: () => void }) {
  // Todos due on another day don't show up under "오늘 할 일", so say where they went.
  const message =
    todo.dueAt && !isToday(todo.dueAt)
      ? '새 할 일이 목록에 추가됐어요. 기한 날짜의 할 일에서 볼 수 있어요.'
      : '새 할 일이 목록에 추가됐어요.'
  return (
    <VStack spacing={10} style={{ padding: 20, flex: 1, minHeight: 0, background: T.cardWhite, borderRadius: 10 }}>
      <HStack style={{ height: 26 }}>
        <Spacer />
        <NaviCloseButton onClick={onClose} />
      </HStack>
      <VStack spacing={10} align="center">
        <NaviImage name="IconCheckedCircle" width={50} height={50} />
        <span style={{ ...F.heading(18), color: T.ink }}>할 일 추가 완료</span>
        <span style={{ ...F.body(12), color: T.grayText, textAlign: 'center' }}>{message}</span>
      </VStack>
      <VStack spacing={4} style={{ padding: '8px 10px', background: T.itemBackground, borderRadius: 6 }}>
        <HStack spacing={4}>
          <span className="truncate" style={{ ...F.title(14), color: T.ink }}>
            {todo.title}
          </span>
          {todo.category && <NaviCategoryTag category={todo.category} />}
        </HStack>
        {todo.dueAt && <span style={{ ...F.body(12), color: T.dark }}>{dueText(todo.dueAt)}</span>}
      </VStack>
      <Spacer />
      <HStack>
        <NaviDialogButton title="할 일 목록으로" onClick={onOpenTodos} />
      </HStack>
    </VStack>
  )
}

// MARK: - New event

export function eventSaveError(error: unknown): string {
  if (isServerError(error)) return error.message
  if (isUnavailable(error)) return '캘린더 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
  return '일정을 저장하지 못했어요. 다시 시도해 주세요.'
}

export function NewEventPanel({ categories, initialDraft, panelTitle = '새 일정', onCancel, onSave }: {
  categories: NaviCategory[]
  initialDraft: NewEventDraft
  /** "새 일정", or the event's title when editing. */
  panelTitle?: string
  onCancel: () => void
  /** Writes Google Calendar through the `calendar` Edge Function; throws to keep the form. */
  onSave: (draft: NewEventDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState(initialDraft)
  const { isSaving, saveError, save } = useSave(onSave, eventSaveError)
  const isValid = isEventDraftValid(draft)
  // Keep the event's length when the start moves, like Calendar does.
  const setStart = (startAt: Date) =>
    setDraft({ ...draft, startAt, endAt: new Date(startAt.getTime() + (draft.endAt.getTime() - draft.startAt.getTime())) })
  return (
    <NaviPanel fillsHeight>
      <NaviPanelHeader title={panelTitle} onClose={onCancel} />
      <NaviTextField title="일정 이름" size="compact" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} autoFocus />
      <FieldRow title="카테고리">
        <NaviCategoryPicker categories={categories} selection={draft.category} onChange={(category) => setDraft({ ...draft, category })} />
      </FieldRow>
      <VStack spacing={5}>
        <span style={{ ...F.title(14), color: T.ink }}>기간</span>
        <HStack spacing={8}>
          <NaviDateField title="시작" date={draft.startAt} onChange={setStart} />
          <NaviDateField title="종료" date={draft.endAt} onChange={(endAt) => setDraft({ ...draft, endAt })} />
        </HStack>
        {draft.endAt <= draft.startAt && <ErrorText>종료 시간은 시작 시간보다 늦어야 해요.</ErrorText>}
      </VStack>
      <NaviTextField title="장소" size="compact" value={draft.location} onChange={(location) => setDraft({ ...draft, location })} />
      <VStack spacing={8}>
        <span style={{ ...F.title(14), color: T.ink }}>미리보기</span>
        <ScheduleBlock
          title={draft.title || '새 일정'}
          timeRange={timeRange(draft.startAt, draft.endAt)}
          location={draft.location || undefined}
          tint={draft.category ? naviHex(draft.category.color) : T.purple}
        />
      </VStack>
      <Spacer />
      {saveError && <ErrorText>{saveError}</ErrorText>}
      <HStack spacing={8}>
        <NaviDialogButton title="취소" role="cancel" onClick={onCancel} />
        <NaviDialogButton title={isSaving ? '저장 중…' : '일정 저장'} isEnabled={isValid && !isSaving} onClick={() => isValid && save(draft)} />
      </HStack>
    </NaviPanel>
  )
}

export function ErrorText({ children, size = 10 }: { children: ReactNode; size?: number }) {
  return <span style={{ ...F.body(size), color: T.red }}>{children}</span>
}
