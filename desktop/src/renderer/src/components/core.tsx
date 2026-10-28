import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { F, T, naviHex, wash } from '@/lib/theme'
import { format } from '@/lib/dates'
import type { NaviCategory } from '@/data/types'

// Port of DesignSystem/NaviComponents.swift.

const iconURLs = import.meta.glob<string>('../assets/icons/*.svg', { eager: true, import: 'default', query: '?url' })

export function asset(name: string): string {
  return iconURLs[`../assets/icons/${name}.svg`] ?? ''
}

/// A Figma "Icon" component glyph: a template SVG in a square slot, tinted by `color`.
export function NaviIcon({ name, size = 15, width, height, style }: {
  name: string
  size?: number
  width?: number
  height?: number
  style?: CSSProperties
}) {
  const url = `url("${asset(name)}")`
  return (
    <span
      aria-hidden
      className="navi-icon"
      style={{ width: width ?? size, height: height ?? size, WebkitMaskImage: url, maskImage: url, ...style }}
    />
  )
}

/// A full-color asset (logos, mascot, filled star).
export function NaviImage({ name, width, height, style, alt = '' }: {
  name: string
  width?: number
  height?: number
  style?: CSSProperties
  alt?: string
}) {
  return (
    <img
      src={asset(name)}
      alt={alt}
      draggable={false}
      style={{ width, height, objectFit: 'contain', flexShrink: 0, display: 'block', ...style }}
    />
  )
}

export function NaviMascot({ width }: { width: number }) {
  return <NaviImage name="NaviMascot" width={width} alt="navi" />
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? 'spinner small' : 'spinner'} />
}

export function Spacer() {
  return <div style={{ flex: 1, minWidth: 0 }} />
}

export function HStack({ spacing = 8, align = 'center', style, children, ...rest }: {
  spacing?: number
  align?: CSSProperties['alignItems']
  style?: CSSProperties
  children?: ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: align, gap: spacing, ...style }} {...rest}>
      {children}
    </div>
  )
}

export function VStack({ spacing = 8, align = 'stretch', style, children, ...rest }: {
  spacing?: number
  align?: CSSProperties['alignItems']
  style?: CSSProperties
  children?: ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: spacing, ...style }} {...rest}>
      {children}
    </div>
  )
}

// MARK: - Popovers

/// Closes a popover when clicking outside `ref` or pressing Escape.
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  return ref
}

/// SwiftUI `Menu`: a label that opens a list of actions.
export function NaviMenu({ label, items, ariaLabel, align = 'left' }: {
  label: ReactNode
  items: { title: string; action: () => void }[]
  ariaLabel?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" aria-label={ariaLabel} onClick={() => setOpen((v) => !v)} style={{ display: 'flex', width: '100%' }}>
        {label}
      </button>
      {open && (
        <div className="menu fade-in" style={{ top: 'calc(100% + 4px)', [align]: 0 }}>
          {items.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => {
                setOpen(false)
                item.action()
              }}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// MARK: - Inputs

/// Figma "Input" sizes: regular (11pt semibold label, 14pt value), compact (10pt / 12pt).
export type FieldSize = 'regular' | 'compact'
const labelFont = (size: FieldSize) => (size === 'regular' ? F.body(11, 'semibold') : F.body(10))
const valueFont = (size: FieldSize) => (size === 'regular' ? F.body(14, 'medium') : F.body(12))

/// Figma "Input" box: a caption label above any value view, in a rounded, bordered box.
export function NaviFieldBox({ title, size = 'regular', isRequired, children, style }: {
  title: string
  size?: FieldSize
  isRequired?: boolean
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '8px 14px',
        width: '100%',
        background: T.cardWhite,
        border: `1px solid ${T.border}`,
        borderRadius: 15,
        ...style
      }}
    >
      <span style={{ ...labelFont(size), color: T.grayText, display: 'flex', gap: 3 }}>
        {title}
        {isRequired && <span style={{ color: T.red }}>*</span>}
      </span>
      <div style={{ ...valueFont(size), color: T.ink }}>{children}</div>
    </div>
  )
}

/// Figma "Input": a caption label above an editable value.
export function NaviTextField({ title, value, onChange, isSecure, isRequired, size = 'regular', onSubmit, onBlur, autoFocus }: {
  title: string
  value: string
  onChange: (value: string) => void
  isSecure?: boolean
  isRequired?: boolean
  size?: FieldSize
  onSubmit?: () => void
  onBlur?: () => void
  autoFocus?: boolean
}) {
  return (
    <NaviFieldBox title={title} size={size} isRequired={isRequired}>
      <input
        type={isSecure ? 'password' : 'text'}
        value={value}
        aria-label={title}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSubmit?.()
        }}
      />
    </NaviFieldBox>
  )
}

const toLocalInput = (date: Date, pattern: string) => format(date, pattern)

/// Figma date/time input: the value reads "2026.09.17  17:00"; clicking opens a date and time
/// picker in a popover.
export function NaviDateField({ title, date, onChange, size = 'compact' }: {
  title: string
  date: Date
  onChange: (date: Date) => void
  size?: FieldSize
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const setDay = (value: string) => {
    const [y, m, d] = value.split('-').map(Number)
    if (!y || !m || !d) return
    const next = new Date(date)
    next.setFullYear(y, m - 1, d)
    onChange(next)
  }
  const setTime = (value: string) => {
    const [h, min] = value.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(min)) return
    const next = new Date(date)
    next.setHours(h, min, 0, 0)
    onChange(next)
  }
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button type="button" aria-label={title} onClick={() => setOpen((v) => !v)} style={{ width: '100%' }}>
        <NaviFieldBox title={title} size={size}>
          {NaviDateField.format(date)}
        </NaviFieldBox>
      </button>
      {open && (
        <div className="popover fade-in" style={{ top: 'calc(100% + 6px)', left: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="date"
            value={toLocalInput(date, 'yyyy-MM-dd')}
            onChange={(e) => setDay(e.target.value)}
            style={{ ...F.body(13), padding: '6px 8px', border: `1px solid ${T.border}`, borderRadius: 6 }}
          />
          <input
            type="time"
            value={toLocalInput(date, 'HH:mm')}
            onChange={(e) => setTime(e.target.value)}
            style={{ ...F.body(13), padding: '6px 8px', border: `1px solid ${T.border}`, borderRadius: 6 }}
          />
        </div>
      )}
    </div>
  )
}
/** "2026.09.17  17:00" */
NaviDateField.format = (date: Date) => format(date, 'yyyy.MM.dd  HH:mm')

// MARK: - Buttons

/// Full-width onboarding call-to-action button.
export function NaviButton({ title, style = 'primary', isEnabled = true, onClick }: {
  title: string
  style?: 'primary' | 'secondary'
  isEnabled?: boolean
  onClick: () => void
}) {
  const background = !isEnabled ? T.disabled : style === 'primary' ? T.purple : T.lavender
  const color = !isEnabled ? T.cardWhite : style === 'primary' ? T.offWhite : T.purple
  return (
    <button
      type="button"
      disabled={!isEnabled}
      onClick={onClick}
      className="hover-dim"
      style={{
        ...F.body(14, 'bold'),
        color,
        background,
        width: '100%',
        padding: '15px 25px',
        borderRadius: 15,
        textAlign: 'center'
      }}
    >
      {title}
    </button>
  )
}

export function NaviLinkButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...F.body(14, 'semibold'), color: T.purple, alignSelf: 'center' }}>
      {title}
    </button>
  )
}

/// Compact tinted button used inside cards ("할 일 추가", "비밀번호 변경", "연결", "관리").
export function NaviPillButton({ title, icon, style = 'accent', size = 'regular', disabled, onClick }: {
  title: string
  icon?: string
  style?: 'accent' | 'success' | 'outline' | 'primary'
  size?: 'regular' | 'large'
  disabled?: boolean
  onClick: () => void
}) {
  const colors = {
    accent: [T.purple, T.lavender],
    success: [T.green, T.greenLight],
    outline: [T.grayText, T.cardWhite],
    primary: [T.cardWhite, T.purple]
  }[style]
  const radius = size === 'large' ? 10 : 8
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="hover-dim"
      style={{
        ...F.body(12, 'bold'),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        color: colors[0],
        background: colors[1],
        padding: size === 'large' ? '10px 25px' : '8px 20px',
        borderRadius: radius,
        border: style === 'outline' ? `1px solid ${T.border}` : 'none',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.6 : 1
      }}
    >
      {icon && <NaviIcon name={icon} />}
      {title}
    </button>
  )
}

/// Figma "Icon / X" (15pt, gray) as a button.
export function NaviCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="닫기" onClick={onClick} style={{ color: T.grayText, paddingRight: 5, display: 'flex' }}>
      <NaviIcon name="IconX" />
    </button>
  )
}

/// Figma dialog button row item: white "취소", lavender secondary, purple primary, or red destructive.
export function NaviDialogButton({ title, role = 'primary', isEnabled = true, onClick }: {
  title: string
  role?: 'cancel' | 'secondary' | 'primary' | 'destructive'
  isEnabled?: boolean
  onClick: () => void
}) {
  const [color, background] = {
    cancel: [T.ink, T.cardWhite],
    secondary: [T.purple, T.lavender],
    primary: [T.cardWhite, isEnabled ? T.purple : T.disabled],
    destructive: [T.cardWhite, isEnabled ? T.red : T.disabled]
  }[role]
  return (
    <button
      type="button"
      disabled={!isEnabled}
      onClick={onClick}
      className="hover-dim"
      style={{
        ...F.body(12, role === 'cancel' ? 'semibold' : 'bold'),
        color,
        background,
        flex: 1,
        padding: '10px 0',
        borderRadius: 10,
        border: role === 'cancel' ? `1px solid ${T.borderLight}` : 'none',
        textAlign: 'center'
      }}
    >
      {title}
    </button>
  )
}

/// Figma "Resize Button / Compress": hides the main window and shows the floating mini widget.
export function NaviCompressButton() {
  return (
    <button
      type="button"
      title="작게 보기"
      aria-label="작게 보기"
      onClick={() => window.navi.widget.compress()}
      className="hover-dim"
      style={{
        color: T.cardWhite,
        background: T.purple,
        borderRadius: 5,
        padding: 8,
        width: 44,
        height: 42,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <NaviIcon name="IconCompress" size={24} style={{ transform: 'rotate(90deg)' }} />
    </button>
  )
}

// MARK: - Main window building blocks

/// White rounded card that holds each main-window section.
export function NaviPanel({ spacing = 10, horizontalPadding = 20, verticalPadding = 15, fillsHeight, children, style }: {
  spacing?: number
  horizontalPadding?: number
  verticalPadding?: number
  /** Stretch the card to the available height (Figma `flex-1` panels). */
  fillsHeight?: boolean
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing,
        padding: `${verticalPadding}px ${horizontalPadding}px`,
        width: '100%',
        flex: fillsHeight ? 1 : undefined,
        minHeight: 0,
        background: T.cardWhite,
        borderRadius: 10,
        ...style
      }}
    >
      {children}
    </div>
  )
}

/// Figma "Frame Title": section title with an optional count tag and "전체 보기" link.
export function NaviSectionHeader({ title, tag, onViewAll }: { title: string; tag?: string; onViewAll?: () => void }) {
  return (
    <HStack spacing={10}>
      <span style={{ ...F.heading(18), color: T.ink }}>{title}</span>
      <Spacer />
      {tag && <NaviTag text={tag} />}
      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          style={{ ...F.body(12), color: T.grayText, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 5px 5px 10px' }}
        >
          전체 보기
          <NaviIcon name="IconChevron" style={{ transform: 'rotate(-90deg)' }} />
        </button>
      )}
    </HStack>
  )
}

/// Small rounded label: lime count badges ("3/4 완료", "2개") and category chips.
export function NaviTag({ text, style = 'count', tint, fontSize }: {
  text: string
  style?: 'count' | 'category'
  /** Category tags use the user's category color: tinted text on a 14% wash. */
  tint?: string
  /** Figma uses 9pt category tags in rows and 11pt ones in pickers. */
  fontSize?: number
}) {
  const color = style === 'count' ? T.dark : tint ? naviHex(tint) : T.purple
  const background = style === 'count' ? T.limeLight : tint ? wash(tint, 0.14) : T.lavender
  return (
    <span
      className="truncate"
      style={{
        ...F.tag(fontSize ?? (style === 'count' ? 11 : 9)),
        color,
        background,
        padding: style === 'count' || fontSize !== undefined ? '5px 10px' : '2px 10px',
        borderRadius: 10,
        flexShrink: 0,
        lineHeight: 1.2
      }}
    >
      {text}
    </span>
  )
}

export function NaviCategoryTag({ category, fontSize }: { category: NaviCategory; fontSize?: number }) {
  return <NaviTag text={category.name} style="category" tint={category.color} fontSize={fontSize} />
}

/// Figma "Color picker" dropdown: the selected category's tag and a chevron.
export function NaviCategoryPicker({ categories, selection, onChange, allowsNone = true }: {
  categories: NaviCategory[]
  selection?: NaviCategory
  onChange: (category: NaviCategory | undefined) => void
  allowsNone?: boolean
}) {
  return (
    <NaviMenu
      ariaLabel="카테고리"
      items={[
        ...(allowsNone ? [{ title: '카테고리 없음', action: () => onChange(undefined) }] : []),
        ...categories.map((category) => ({ title: category.name, action: () => onChange(category) }))
      ]}
      label={
        <HStack
          spacing={8}
          style={{ padding: '5px 8px', background: T.cardWhite, borderRadius: 10, border: `1px solid ${T.border}` }}
        >
          {selection ? (
            <NaviCategoryTag category={selection} fontSize={11} />
          ) : (
            <span style={{ ...F.body(11), color: T.grayText, padding: '5px 10px' }}>없음</span>
          )}
          <span style={{ color: T.ink, display: 'flex' }}>
            <NaviIcon name="IconChevron" />
          </span>
        </HStack>
      }
    />
  )
}

/// Side-panel title row ("새 할 일", "새 일정"): H4 title, close X, and a divider below.
export function NaviPanelHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <VStack spacing={10}>
      <HStack>
        <span style={{ ...F.heading(18), color: T.ink }}>{title}</span>
        <Spacer />
        {onClose && <NaviCloseButton onClick={onClose} />}
      </HStack>
      <div style={{ height: 1, background: T.border }} />
    </VStack>
  )
}

/// Header of the mail / calendar / todo tabs: H2 title, a 372pt search field, and the
/// compress button. The search field is dimmed (Figma: 40% opacity) while disabled.
export function NaviTabHeader({ title, searchPrompt, searchText, onSearchChange, isSearchEnabled = true }: {
  title: string
  searchPrompt: string
  searchText: string
  onSearchChange: (value: string) => void
  isSearchEnabled?: boolean
}) {
  return (
    <HStack>
      <span style={{ ...F.title(28), color: T.ink }}>{title}</span>
      <Spacer />
      <HStack spacing={10}>
        <HStack
          spacing={5}
          style={{
            padding: '8px 14px',
            width: 372,
            background: T.cardWhite,
            borderRadius: 10,
            opacity: isSearchEnabled ? 1 : 0.4
          }}
        >
          <span style={{ color: T.grayText, display: 'flex' }}>
            <NaviIcon name="IconSearch" />
          </span>
          <input
            value={searchText}
            disabled={!isSearchEnabled}
            placeholder={searchPrompt}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ ...F.body(14, 'medium'), color: T.ink }}
          />
        </HStack>
        <NaviCompressButton />
      </HStack>
    </HStack>
  )
}

// MARK: - Dialogs

/// Figma dialog surface: 460pt wide white card with a soft shadow.
export function NaviDialogCard({ children, spacing = 10 }: { children: ReactNode; spacing?: number }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing,
        padding: '22px 24px',
        width: 460,
        background: T.cardWhite,
        borderRadius: 14,
        boxShadow: '0 10px 28px rgba(0,0,0,0.14)'
      }}
    >
      {children}
    </div>
  )
}

// MARK: - Tabs, subtitles, prompt input

/// Figma "Tab": selected is lavender with a purple border and bold purple label.
export function NaviSegmentTabs<Item>({ items, selection, onSelect, title, isEqual = (a, b) => a === b }: {
  items: Item[]
  selection: Item
  onSelect: (item: Item) => void
  title: (item: Item) => string
  isEqual?: (a: Item, b: Item) => boolean
}) {
  return (
    <HStack spacing={10} style={{ flexWrap: 'wrap' }}>
      {items.map((item) => {
        const isSelected = isEqual(item, selection)
        return (
          <button
            key={title(item)}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(item)}
            style={{
              ...F.paperlogy(14, isSelected ? 'bold' : 'regular'),
              color: isSelected ? T.purple : T.grayText,
              background: isSelected ? T.lavender : T.cardWhite,
              padding: '7px 25px',
              borderRadius: 8,
              border: `1px solid ${isSelected ? T.purple : 'transparent'}`
            }}
          >
            {title(item)}
          </button>
        )
      })}
    </HStack>
  )
}

/// Figma "Subtitle": a 16pt group heading with a count chip; red when `isAlert` (기한 지남).
export function NaviGroupSubtitle({ title, count, isAlert }: { title: string; count: number; isAlert?: boolean }) {
  return (
    <HStack spacing={15}>
      <span style={{ ...F.title(16), color: isAlert ? T.red : T.dark }}>{title}</span>
      <span
        style={{
          ...F.paperlogy(11, 'medium'),
          color: isAlert ? T.red : T.grayText,
          background: isAlert ? T.redLight : T.itemBackground,
          padding: '5px 10px',
          minWidth: 28,
          textAlign: 'center',
          borderRadius: 10
        }}
      >
        {count}
      </span>
    </HStack>
  )
}

/// Figma "Input / Chat": a white prompt bar with a purple ↑ send button, or a lavender
/// "Enter" button for the todo quick-add bar.
export function NaviPromptInput({ prompt, action = 'send', onSubmit }: {
  prompt: string
  action?: 'send' | 'enter'
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState('')
  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setText('')
  }
  return (
    <HStack style={{ padding: '8px 14px', background: T.cardWhite, borderRadius: 12 }}>
      <input
        value={text}
        placeholder={prompt}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
        }}
        style={{ ...F.body(14, 'medium'), color: T.ink, flex: 1 }}
      />
      <button
        type="button"
        aria-label={action === 'send' ? '보내기' : '추가'}
        onClick={submit}
        className="hover-dim"
        style={
          action === 'send'
            ? { color: T.cardWhite, background: T.purple, padding: '10px 15px', borderRadius: 10, display: 'flex' }
            : { ...F.body(12, 'bold'), color: T.purple, background: T.lavender, padding: '10px 25px', borderRadius: 10 }
        }
      >
        {action === 'send' ? <NaviIcon name="IconUpArrow" /> : 'Enter'}
      </button>
    </HStack>
  )
}

/// A Figma "Checked" toggle: a 30pt green circle with a checkmark; off is an outlined circle.
export function NaviCheckCircle({ isOn, size = 30 }: { isOn: boolean; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: isOn ? T.greenLight : T.cardWhite,
        border: `1px solid ${isOn ? 'transparent' : T.border}`,
        color: T.green,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      {isOn && <NaviIcon name="IconCheck" width={size * 0.43} height={size * 0.32} />}
    </span>
  )
}
