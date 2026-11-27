import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { T } from '@/lib/theme'

const GAP = 8
const MIN_WIDTH = 220

function savedWidth(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(`navi:columns:${key}`))
    return value >= 20 && value <= 80 ? value : fallback
  } catch {
    return fallback
  }
}

export function ResizableColumns({ id, initialLeft = 65, left, right, style }: {
  id: string
  initialLeft?: number
  left: ReactNode
  right: ReactNode
  style?: CSSProperties
}) {
  const root = useRef<HTMLDivElement>(null)
  const [leftPercent, setLeftPercent] = useState(() => savedWidth(id, initialLeft))

  const update = (percent: number) => {
    const width = root.current?.clientWidth ?? 0
    const minimum = width > MIN_WIDTH * 2 + GAP ? MIN_WIDTH / width * 100 : 25
    const next = Math.max(minimum, Math.min(100 - minimum, percent))
    setLeftPercent(next)
    try { localStorage.setItem(`navi:columns:${id}`, String(next)) } catch { /* Storage can be disabled. */ }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = root.current?.getBoundingClientRect()
    if (rect) update((event.clientX - rect.left) / rect.width * 100)
  }

  return <div ref={root} className="navi-resizable-columns" style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0, minHeight: 0, ...style }}>
    <div style={{ width: `calc(${leftPercent}% - ${GAP / 2}px)`, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{left}</div>
    <div
      role="separator"
      aria-label="섹션 너비 조절"
      aria-orientation="vertical"
      aria-valuenow={Math.round(leftPercent)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      className="navi-column-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); update(leftPercent - 2) }
        if (event.key === 'ArrowRight') { event.preventDefault(); update(leftPercent + 2) }
      }}
      style={{ width: GAP, flexShrink: 0, cursor: 'col-resize', touchAction: 'none', position: 'relative', background: 'transparent', color: T.border }}
    >
      <span aria-hidden style={{ position: 'absolute', width: 2, height: 36, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', borderRadius: 2, background: 'currentColor' }} />
    </div>
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{right}</div>
  </div>
}
