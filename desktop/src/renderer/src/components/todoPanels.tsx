import { useEffect, useState, type ReactNode } from 'react'
import { F, T } from '@/lib/theme'
import { addDays, addMonths, format, isSameDay, isToday, isTomorrow, startOfMonth, startOfWeek } from '@/lib/dates'
import type { DashboardTodo, NaviCategory, PrepSuggestion } from '@/data/types'
import type { TodoTabModel } from '@/models/todo'
import {
  HStack,
  NaviCategoryPicker,
  NaviCategoryTag,
  NaviCheckCircle,
  NaviCloseButton,
  NaviDateField,
  NaviDialogButton,
  NaviFieldBox,
  NaviIcon,
  NaviImage,
  NaviMenu,
  NaviPanel,
  NaviPanelHeader,
  NaviTextField,
  Spacer,
  VStack
} from './core'
import { ErrorText, NaviCheckbox, dueText } from './shared'

// Port of TodoPanels.swift: right-column panels of the todo tab, also used by the calendar
// tab and the floating widget.

export function Card({ children, spacing = 10, fills }: { children: ReactNode; spacing?: number; fills?: boolean }) {
  return (
    <VStack spacing={spacing} style={{ padding: 20, background: T.cardWhite, borderRadius: 10, flex: fills ? 1 : undefined, minHeight: 0 }}>
      {children}
    </VStack>
  )
}

// MARK: - Detail

/// "오늘 · 오후 5:00", "내일 · 오전 9:00", "9월 30일 · 오후 6:00", or "기한 없음".
export function deadlineText(dueAt?: Date): string {
  if (!dueAt) return '기한 없음'
  const time = format(dueAt, 'a h:mm')
  if (isToday(dueAt)) return `오늘 · ${time}`
  if (isTomorrow(dueAt)) return `내일 · ${time}`
  return `${format(dueAt, 'M월 d일')} · ${time}`
}

export function TodoDetailPanel({ model, todo }: { model: TodoTabModel; todo: DashboardTodo }) {
  const [title, setTitle] = useState(todo.title)
  const [newSubtask, setNewSubtask] = useState('')
  const titleRef = useLatest(title)

  useEffect(() => {
    setTitle(todo.title)
    // Commit the edited title when switching todos or closing the panel.
    return () => model.rename(todo.id, titleRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo.id])

  return (
    <Card spacing={20} fills>
      <NaviPanelHeader title="할 일 상세" onClose={() => model.set('panel', { kind: 'overview' })} />
      <HStack spacing={10}>
        <button type="button" aria-label={todo.isDone ? '완료 취소' : '완료'} onClick={() => model.toggle(todo.id)} style={{ display: 'flex' }}>
          <NaviCheckbox isChecked={todo.isDone} size={18} uncheckedBorder={T.border} />
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && model.rename(todo.id, title)}
          style={{ ...F.body(16, 'bold'), color: T.ink, textDecoration: todo.isDone ? 'line-through' : undefined }}
        />
      </HStack>
      <button type="button" onClick={() => model.set('panel', { kind: 'deadline', id: todo.id })} style={{ width: '100%' }}>
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
        <NaviCategoryPicker categories={model.categories} selection={todo.category} onChange={(c) => model.setCategory(c, todo.id)} />
      </HStack>
      <VStack spacing={10} style={{ flex: 1, minHeight: 0 }}>
        <HStack>
          <span style={{ ...F.title(16), color: T.dark }}>하위 할 일</span>
          <Spacer />
          {todo.subtasks.length > 0 && (
            <span style={{ ...F.tag(9), color: T.ink, padding: '2px 10px', background: T.limeLight, borderRadius: 10 }}>
              {todo.subtasks.filter((s) => s.isDone).length}/{todo.subtasks.length} 완료
            </span>
          )}
        </HStack>
        <VStack spacing={3} className="scroll" style={{ padding: '0 5px', minHeight: 0 }}>
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
  )
}

function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }))
  ref.current = value
  return ref
}

// MARK: - Deadline

/// "기한 변경": month grid (일–토) with the selected day in lavender, then hour / minute /
/// 오전·오후 chips, 취소 and 적용.
export function DeadlinePanel({ initial, showsCloseButton = true, onCancel, onApply }: {
  initial: Date
  /** The floating widget hides the header X; its back link and 취소 already close the panel. */
  showsCloseButton?: boolean
  onCancel: () => void
  onApply: (date: Date) => void
}) {
  const [month, setMonth] = useState(initial)
  const [selectedDay, setSelectedDay] = useState(initial)
  const hour24 = initial.getHours()
  const [hour, setHour] = useState(hour24 % 12 === 0 ? 12 : hour24 % 12)
  const [minute, setMinute] = useState(Math.floor(initial.getMinutes() / 5) * 5)
  const [isPM, setPM] = useState(hour24 >= 12)

  const resolvedDate = () => {
    const date = new Date(selectedDay)
    date.setHours((hour % 12) + (isPM ? 12 : 0), minute, 0, 0)
    return date
  }

  const monthButton = (offset: number, rotation: number, label: string) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => setMonth(addMonths(month, offset))}
      style={{ color: T.ink, padding: 5, background: T.itemBackground, borderRadius: 5, display: 'flex' }}
    >
      <NaviIcon name="IconChevron" style={{ transform: `rotate(${rotation}deg)` }} />
    </button>
  )
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <Card spacing={20}>
      <NaviPanelHeader title="기한 변경" onClose={showsCloseButton ? onCancel : undefined} />
      <VStack spacing={15}>
        <HStack>
          <span style={{ ...F.title(16), color: T.dark }}>{format(month, 'yyyy년 M월')}</span>
          <Spacer />
          <HStack spacing={5}>
            {monthButton(-1, 90, '이전 달')}
            {monthButton(1, -90, '다음 달')}
          </HStack>
        </HStack>
        <MonthGrid month={month} selected={selectedDay} onSelect={setSelectedDay} />
      </VStack>
      <HStack>
        <span style={{ ...F.title(14), color: T.dark }}>시간</span>
        <Spacer />
        <HStack spacing={5}>
          <TimeChip value={pad(hour)} options={Array.from({ length: 12 }, (_, i) => pad(i + 1))} onSelect={(v) => setHour(Number(v))} />
          <TimeChip value={pad(minute)} options={Array.from({ length: 12 }, (_, i) => pad(i * 5))} onSelect={(v) => setMinute(Number(v))} />
          <TimeChip value={isPM ? 'PM' : 'AM'} options={['AM', 'PM']} onSelect={(v) => setPM(v === 'PM')} />
        </HStack>
      </HStack>
      <HStack spacing={10}>
        <NaviDialogButton title="취소" role="secondary" onClick={onCancel} />
        <NaviDialogButton title="적용" onClick={() => onApply(resolvedDate())} />
      </HStack>
    </Card>
  )
}

/// Figma date grid: S M T W T F S header, a divider, and the week rows that touch the month;
/// days outside the month are light gray, the selected day is bold purple on lavender.
export function MonthGrid({ month, selected, onSelect }: { month: Date; selected: Date; onSelect: (day: Date) => void }) {
  const first = startOfWeek(startOfMonth(month), 0)
  const inMonth = (day: Date) => day.getMonth() === month.getMonth() && day.getFullYear() === month.getFullYear()
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d))).filter((week) =>
    week.some(inMonth)
  )
  return (
    <VStack spacing={6}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((letter, i) => (
          <span key={i} style={{ ...F.body(12.8), color: T.grayText, textAlign: 'center' }}>
            {letter}
          </span>
        ))}
      </div>
      <div style={{ height: 1, background: T.border }} />
      {weeks.map((week) => (
        <div key={week[0].getTime()} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {week.map((day) => {
            const isSelected = isSameDay(day, selected)
            return (
              <button
                key={day.getTime()}
                type="button"
                aria-label={format(day, 'M월 d일')}
                onClick={() => onSelect(day)}
                style={{ display: 'flex', justifyContent: 'center' }}
              >
                <span
                  style={{
                    ...F.body(isSelected ? 10 : 12.8, isSelected ? 'bold' : 'regular'),
                    color: isSelected ? T.purple : inMonth(day) ? T.grayText : T.border,
                    background: isSelected ? T.lavender : 'transparent',
                    width: 29.5,
                    height: 27,
                    borderRadius: 5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {day.getDate()}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </VStack>
  )
}

/// A lavender 45pt chip showing a value; opens a menu of options.
function TimeChip({ value, options, onSelect }: { value: string; options: string[]; onSelect: (value: string) => void }) {
  return (
    <NaviMenu
      align="right"
      items={options.map((option) => ({ title: option, action: () => onSelect(option) }))}
      label={
        <span style={{ ...F.title(14), color: T.purple, width: 45, padding: '5px 0', background: T.lavender, borderRadius: 5, textAlign: 'center' }}>
          {value}
        </span>
      }
    />
  )
}

// MARK: - Weekly prep

export function WeeklyPrepPanel({ model }: { model: TodoTabModel }) {
  const [isAdding, setAdding] = useState(false)
  return (
    <Card fills>
      <NaviPanelHeader title="이번 주 미리 준비" onClose={() => model.set('panel', { kind: 'overview' })} />
      <span style={{ ...F.body(12), color: T.grayText }}>
        다가오는 일정에 맞춰 추천했어요.
        <br />
        추가하기 전 이름과 기한을 확인하세요.
      </span>
      {model.isLoadingSuggestions ? (
        <span style={{ ...F.body(12), color: T.grayText, padding: '8px 0' }}>이번 주 일정을 보고 할 일을 정리하고 있어요…</span>
      ) : (
        model.suggestions.length === 0 && (
          <span style={{ ...F.body(12), color: T.grayText, padding: '8px 0' }}>{model.errorMessage ?? '이번 주에 추천할 할 일이 없어요.'}</span>
        )
      )}
      <VStack spacing={10} className="scroll" style={{ flex: 1, minHeight: 0 }}>
        {model.suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            onToggle={() => model.toggleSuggestion(suggestion.id)}
            onOpen={() => model.set('panel', { kind: 'prepDetail', id: suggestion.id })}
          />
        ))}
      </VStack>
      <HStack>
        <NaviDialogButton
          title={isAdding ? '추가 중…' : '선택한 할 일 추가'}
          isEnabled={model.suggestions.some((s) => s.isSelected) && !isAdding}
          onClick={async () => {
            setAdding(true)
            await model.addSelectedSuggestions()
            setAdding(false)
          }}
        />
      </HStack>
    </Card>
  )
}

/// Figma "Recommendation": title + category tag, deadline, and "reason · effort" with an
/// optional selection check.
export function SuggestionCard({ suggestion, onToggle, onOpen }: {
  suggestion: PrepSuggestion
  onToggle?: () => void
  onOpen?: () => void
}) {
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: T.itemBackground,
        borderRadius: 6,
        cursor: onOpen ? 'pointer' : undefined
      }}
    >
      <VStack spacing={4} style={{ flex: 1, minWidth: 0 }}>
        <HStack spacing={4}>
          <span className="truncate" style={{ ...F.title(14), color: T.ink }}>
            {suggestion.title}
          </span>
          {suggestion.category && <NaviCategoryTag category={suggestion.category} />}
        </HStack>
        <span style={{ ...F.body(12), color: T.dark }}>{dueText(suggestion.dueAt)}</span>
        {suggestion.reason && (
          <span style={{ ...F.body(10), color: T.grayText }}>
            <span style={{ color: suggestion.isUrgent ? T.red : T.grayText }}>{suggestion.reason}</span>
            {suggestion.effort && ` · ${suggestion.effort}`}
          </span>
        )}
      </VStack>
      {onToggle && (
        <button
          type="button"
          aria-label={suggestion.isSelected ? '선택 해제' : '선택'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          style={{ display: 'flex' }}
        >
          <NaviCheckCircle isOn={suggestion.isSelected} />
        </button>
      )}
    </div>
  )
}

export function PrepDetailPanel({ categories, initial, onCancel, onAdd }: {
  categories: NaviCategory[]
  initial: PrepSuggestion
  onCancel: () => void
  onAdd: (suggestion: PrepSuggestion) => Promise<void>
}) {
  const [suggestion, setSuggestion] = useState(initial)
  const [isSaving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  return (
    <NaviPanel fillsHeight>
      <NaviPanelHeader title="할 일 추천 상세" onClose={onCancel} />
      <NaviTextField title="할 일" size="compact" value={suggestion.title} onChange={(title) => setSuggestion({ ...suggestion, title })} />
      <NaviDateField title="기한" date={suggestion.dueAt} onChange={(dueAt) => setSuggestion({ ...suggestion, dueAt })} />
      <HStack>
        <span style={{ ...F.title(14), color: T.dark }}>카테고리</span>
        <Spacer />
        <NaviCategoryPicker categories={categories} selection={suggestion.category} onChange={(category) => setSuggestion({ ...suggestion, category })} />
      </HStack>
      <Spacer />
      {saveError && <ErrorText>{saveError}</ErrorText>}
      <HStack spacing={8}>
        <NaviDialogButton title="취소" role="cancel" onClick={onCancel} />
        <NaviDialogButton
          title={isSaving ? '추가 중…' : '할 일 추가'}
          isEnabled={suggestion.title.trim() !== '' && !isSaving}
          onClick={async () => {
            setSaving(true)
            try {
              await onAdd(suggestion)
            } catch {
              setSaveError('할 일을 추가하지 못했어요.')
            }
            setSaving(false)
          }}
        />
      </HStack>
    </NaviPanel>
  )
}

export function PrepAddedPanel({ added, onClose }: { added: PrepSuggestion[]; onClose: () => void }) {
  return (
    <Card fills>
      <HStack style={{ height: 26 }}>
        <Spacer />
        <NaviCloseButton onClick={onClose} />
      </HStack>
      <VStack spacing={10} align="center">
        <NaviImage name="IconCheckedCircle" width={50} height={50} />
        <span style={{ ...F.heading(18), color: T.ink }}>할 일 추가 완료</span>
        <span style={{ ...F.body(12), color: T.grayText }}>선택한 추천 할 일이 목록에 추가됐어요.</span>
      </VStack>
      <VStack spacing={10} className="scroll" style={{ flex: 1, minHeight: 0 }}>
        {added.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} />
        ))}
      </VStack>
      <HStack>
        <NaviDialogButton title="할 일 목록으로" onClick={onClose} />
      </HStack>
    </Card>
  )
}
