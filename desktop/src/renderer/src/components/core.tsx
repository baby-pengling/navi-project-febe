import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { F, T, naviHex, wash } from '@/lib/theme'
import type { AgentShape } from '@/lib/appearance'
import { addDays, addMonths, format, isSameDay, startOfMonth, startOfWeek } from '@/lib/dates'
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

export function NaviLogoMark({ width }: { width: number }) {
  return <svg aria-label="navi" role="img" viewBox="0 0 30 30" width={width} height={width} style={{ display: 'block', flexShrink: 0 }}>
    <path d="M15 0C23.2842 0 30 6.7158 30 15c0 .4335-.0184.8627-.0541 1.2869-.1693 1.9914-2.5445 2.5201-3.9408 1.0901-.5937-.608-.8496-1.4568-.8438-2.3067v-.0703c0-5.6119-4.5492-10.1611-10.1611-10.1611S4.8389 9.3881 4.8389 15 9.3881 25.1611 15 25.1611c1.0666 0 2.095-.1642 3.061-.4689 1.0782-.3401 2.3008-.1854 3.0907.6236 1.1094 1.1363.9083 3.0174-.5654 3.6093A14.96 14.96 0 0 1 15 30C6.7157 30 0 23.2843 0 15S6.7158 0 15 0Z" fill={T.purple} />
    <circle cx="25.8317" cy="23.5478" r="2.90323" fill={T.lime} />
  </svg>
}

export function NaviMascot({ width, shape, main, dot }: { width: number; shape?: AgentShape; main?: string; dot?: string }) {
  return <svg role="img" aria-label="navi 캐릭터" className={`navi-mascot ${shape ? `shape-${shape}` : 'shape-current'}`} viewBox="0 0 120 100" width={width} height={width * 100 / 120} style={{ flexShrink: 0, overflow: 'visible', '--mascot-main': main ?? 'var(--navi-mascot-main, #7165FF)', '--mascot-dot': dot ?? T.lime } as CSSProperties}>
    <path className="navi-shape navi-shape-dome" d="M13 75C13 44 31 15 58 15c29 0 46 26 46 60 0 14-15 18-46 18S13 89 13 75Z" />
    <path className="navi-shape navi-shape-cloud" d="M15 73c-8-17 0-34 16-39 5-19 31-25 44-9 18-3 30 10 27 25 10 15 2 36-19 41H38C25 91 18 85 15 73Z" />
    <path className="navi-shape navi-shape-square" d="M38 15h42c17 0 25 10 25 26v29c0 16-9 23-25 23H38c-17 0-25-8-25-24V39c0-16 9-24 25-24Z" />
    <path className="navi-shape navi-shape-bean" d="M55 14c17-6 25 7 36 26 12 19 20 32 11 45-6 9-23 10-44 9-23 0-40-2-46-11-8-13 2-31 14-47 10-13 19-20 29-22Z" />
    <path className="navi-shape navi-shape-star" d="M59 12c10 0 13 17 21 21 7 5 23 5 26 15 3 9-10 20-10 28 0 9 3 17-5 21-8 5-22-5-32-5s-23 10-32 5c-9-5-5-17-6-24-2-8-13-16-10-25 3-10 20-11 27-16 8-5 11-20 21-20Z" />
    <circle cx="45" cy="49" r="12" fill="white"/><circle cx="75" cy="49" r="12" fill="white"/>
    <circle cx="41" cy="47" r="6" fill="#19191C"/><circle cx="71" cy="47" r="6" fill="#19191C"/>
    <circle cx="111" cy="83" r="8" fill="var(--mascot-dot)"/>
  </svg>
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
export function NaviTextField({ title, value, onChange, isSecure, isRequired, isError, size = 'regular', onSubmit, onBlur, autoFocus }: {
  title: string
  value: string
  onChange: (value: string) => void
  isSecure?: boolean
  isRequired?: boolean
  isError?: boolean
  size?: FieldSize
  onSubmit?: () => void
  onBlur?: () => void
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <NaviFieldBox title={title} size={size} isRequired={isRequired} style={{ borderColor: isError ? T.red : focused ? T.ink : T.border }}>
      <input
        type={isSecure ? 'password' : 'text'}
        value={value}
        aria-label={title}
        aria-invalid={isError || undefined}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); onBlur?.() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSubmit?.()
        }}
      />
    </NaviFieldBox>
  )
}

/// Figma date/time input: the value reads "2026.09.17  17:00"; clicking opens a date and time
/// picker in a popover.
export function NaviDateField({ title, date, onChange, size = 'compact' }: {
  title: string
  date: Date
  onChange: (date: Date) => void
  size?: FieldSize
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => startOfMonth(date))
  const ref = useDismiss(open, () => setOpen(false))
  const setDay = (day: Date) => {
    const next = new Date(date)
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate())
    onChange(next)
  }
  const setTime = (hour: number, minute: number) => {
    const next = new Date(date)
    next.setHours(hour, minute, 0, 0)
    onChange(next)
  }
  const first = startOfWeek(month, 0)
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index))
  const hour = date.getHours() % 12 || 12
  const isPM = date.getHours() >= 12
  const timeSelectStyle: CSSProperties = { ...F.body(12), color: T.purple, background: T.lavender, border: 0, borderRadius: 6, padding: '6px 3px', textAlign: 'center' }
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', minWidth: 0 }}>
      <button type="button" aria-label={title} aria-expanded={open} onClick={() => { setMonth(startOfMonth(date)); setOpen((v) => !v) }} style={{ width: '100%' }}>
        <NaviFieldBox title={title} size={size}>
          {NaviDateField.format(date)}
        </NaviFieldBox>
      </button>
      {open && (
        <div className="popover fade-in" style={{ top: 'calc(100% + 6px)', ...(title === '종료' ? { right: 0 } : { left: 0 }), width: 246, zIndex: 90, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <HStack>
            <span style={{ ...F.title(13), color: T.dark, flex: 1 }}>{format(month, 'yyyy년 M월')}</span>
            <button type="button" aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))} style={{ color: T.purple, padding: '4px 8px', background: T.lavender, borderRadius: 5 }}>‹</button>
            <button type="button" aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))} style={{ color: T.purple, padding: '4px 8px', background: T.lavender, borderRadius: 5 }}>›</button>
          </HStack>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
            {['일', '월', '화', '수', '목', '금', '토'].map((label) => <span key={label} style={{ ...F.body(10), color: T.grayText, padding: 4 }}>{label}</span>)}
            {days.map((day) => <button key={day.toISOString()} type="button" aria-label={format(day, 'yyyy년 M월 d일')} onClick={() => setDay(day)} style={{ ...F.body(11, isSameDay(day, date) ? 'bold' : 'regular'), color: isSameDay(day, date) ? T.purple : day.getMonth() === month.getMonth() ? T.ink : T.graySecondary, background: isSameDay(day, date) ? T.lavender : 'transparent', borderRadius: 5, height: 27, textAlign: 'center' }}>{day.getDate()}</button>)}
          </div>
          <HStack spacing={5}>
            <span style={{ ...F.body(11), color: T.grayText, flex: 1 }}>시간</span>
            <select aria-label="시" value={hour} onChange={(e) => setTime((Number(e.target.value) % 12) + (isPM ? 12 : 0), date.getMinutes())} style={timeSelectStyle}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}</select>
            <span>:</span>
            <select aria-label="분" value={date.getMinutes()} onChange={(e) => setTime(date.getHours(), Number(e.target.value))} style={timeSelectStyle}>{Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}</select>
            <select aria-label="오전 오후" value={isPM ? 'PM' : 'AM'} onChange={(e) => setTime((date.getHours() % 12) + (e.target.value === 'PM' ? 12 : 0), date.getMinutes())} style={timeSelectStyle}><option>AM</option><option>PM</option></select>
          </HStack>
          <button type="button" onClick={() => setOpen(false)} style={{ ...F.body(12, 'semibold'), color: T.cardWhite, background: T.purple, borderRadius: 7, padding: 7, textAlign: 'center' }}>적용</button>
        </div>
      )}
    </div>
  )
}
/** "2026.09.17  17:00" */
NaviDateField.format = (date: Date) => format(date, 'yyyy.MM.dd  HH:mm')

// MARK: - Buttons

/// Full-width onboarding call-to-action button.
export function NaviButton({ title, style = 'primary', isEnabled = true, isLoading = false, onClick }: {
  title: string
  style?: 'primary' | 'secondary'
  isEnabled?: boolean
  isLoading?: boolean
  onClick: () => void
}) {
  const background = !isEnabled ? T.disabled : style === 'primary' ? T.purple : T.lavender
  const color = !isEnabled ? T.cardWhite : style === 'primary' ? T.offWhite : T.purple
  return (
    <button
      type="button"
      disabled={!isEnabled || isLoading}
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
      {isLoading ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="navi-loading-logo"><NaviMascot width={22} /></span>{title}</span> : title}
    </button>
  )
}

export function NaviLinkButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" className="navi-link-button" onClick={onClick} style={{ ...F.body(14, 'semibold'), color: T.purple, alignSelf: 'center' }}>
      {title}
    </button>
  )
}

/// Compact tinted button used inside cards ("할 일 추가", "비밀번호 변경", "연결", "관리").
export function NaviPillButton({ title, icon, style = 'accent', size = 'regular', disabled, isLoading = false, onClick }: {
  title: string
  icon?: string
  style?: 'accent' | 'success' | 'outline' | 'primary'
  size?: 'regular' | 'large'
  disabled?: boolean
  isLoading?: boolean
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
      disabled={disabled || isLoading}
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
      {isLoading ? <span className="navi-loading-logo"><NaviMascot width={18} /></span> : icon && <NaviIcon name={icon} />}
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
export function NaviDialogButton({ title, role = 'primary', isEnabled = true, isLoading = false, onClick }: {
  title: string
  role?: 'cancel' | 'secondary' | 'primary' | 'destructive'
  isEnabled?: boolean
  isLoading?: boolean
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
      {isLoading ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Spinner small />{title} 중…</span> : title}
    </button>
  )
}

/// Figma "Resize Button / Compress": hides the main window and shows the floating mini widget.
export function NaviCompressButton({ compact = false }: { compact?: boolean }) {
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
        width: compact ? 36 : 44,
        height: compact ? 35 : 42,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <NaviIcon name="IconCompress" size={compact ? 19 : 24} style={{ transform: 'rotate(90deg)' }} />
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
        overflowY: fillsHeight ? 'auto' : undefined,
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
  const color = style === 'count' ? T.dark : tint ? tint.startsWith('var(') ? tint : naviHex(tint) : T.purple
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
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-label="카테고리" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
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
      </button>
      {open && <div className="menu fade-in" style={{ top: 'calc(100% + 4px)', right: 0, zIndex: 80, minWidth: 160 }}>
        {allowsNone && <button type="button" className="category-none-option" onClick={() => { onChange(undefined); setOpen(false) }} style={{ ...F.body(12), color: T.ink, background: T.itemBackground, borderRadius: 6 }}>카테고리 없음</button>}
        {categories.map((category) => <button key={category.id} type="button" onClick={() => { onChange(category); setOpen(false) }}><NaviCategoryTag category={category} fontSize={11} /></button>)}
      </div>}
    </div>
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
