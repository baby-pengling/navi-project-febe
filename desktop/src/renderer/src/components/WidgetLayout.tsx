import { useEffect, useRef, useState, type ReactNode } from 'react'
import { F, T } from '@/lib/theme'
import { ResizableColumns } from './ResizableColumns'

export type WidgetItem<ID extends string> = { id: ID; label: string }
type SavedLayout<ID extends string> = { order: ID[]; visible: ID[] }

function readLayout<ID extends string>(key: string, items: readonly WidgetItem<ID>[]): SavedLayout<ID> {
  const ids = items.map((item) => item.id)
  try {
    const raw = JSON.parse(localStorage.getItem(`navi:widgets:${key}`) ?? 'null') as Partial<SavedLayout<ID>> | null
    const order = [...new Set((raw?.order ?? []).filter((id) => ids.includes(id))), ...ids.filter((id) => !raw?.order?.includes(id))]
    const visible = ids.filter((id) => raw?.visible?.includes(id))
    return { order, visible: visible.length ? visible : ids }
  } catch {
    return { order: ids, visible: ids }
  }
}

export function useWidgetLayout<ID extends string>(key: string, items: readonly WidgetItem<ID>[]) {
  const [layout, setLayout] = useState(() => readLayout(key, items))
  const ids = items.map((item) => item.id)
  useEffect(() => {
    try { localStorage.setItem(`navi:widgets:${key}`, JSON.stringify(layout)) } catch { /* Storage can be disabled. */ }
  }, [key, layout])
  const visible = layout.order.filter((id) => layout.visible.includes(id))
  return {
    items,
    visible,
    layout,
    toggle(id: ID) {
      setLayout((current) => {
        if (current.visible.includes(id) && current.visible.length === 1) return current
        return { ...current, visible: current.visible.includes(id) ? current.visible.filter((value) => value !== id) : [...current.visible, id] }
      })
    },
    move(id: ID, target: ID) {
      setLayout((current) => {
        const order = current.order.filter((value) => value !== id)
        order.splice(order.indexOf(target), 0, id)
        return { ...current, order }
      })
    },
    moveBy(id: ID, delta: number) {
      setLayout((current) => {
        const order = [...current.order]
        const from = order.indexOf(id)
        const to = Math.max(0, Math.min(order.length - 1, from + delta))
        order.splice(from, 1)
        order.splice(to, 0, id)
        return { ...current, order }
      })
    },
    showAll() { setLayout((current) => ({ ...current, visible: ids })) },
    reset() { setLayout({ order: ids, visible: ids }) }
  }
}

export function WidgetLayoutButton<ID extends string>({ control, inline = false }: { control: ReturnType<typeof useWidgetLayout<ID>>; inline?: boolean }) {
  const [open, setOpen] = useState(false)
  const [dragged, setDragged] = useState<ID | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeEscape) }
  }, [open])

  return <div ref={root} style={{ position: 'relative', flexShrink: 0, width: inline && open ? 260 : undefined, display: inline ? 'flex' : undefined, flexDirection: inline ? 'column' : undefined, alignItems: inline ? 'flex-end' : undefined }}>
    <button type="button" aria-label="위젯 편집" aria-expanded={open} onClick={() => setOpen(!open)} className="widget-layout-trigger" style={{ ...F.body(11, 'medium'), color: T.purple, background: T.lavender, borderRadius: 7, padding: '8px 11px' }}>위젯 편집</button>
    {open && <div className="widget-layout-popover" style={{ position: inline ? 'relative' : 'absolute', right: 0, top: inline ? 0 : 'calc(100% + 8px)', width: 260, padding: 12, borderRadius: 12, background: T.cardWhite, boxShadow: '0 12px 36px rgba(25,25,28,.16)', zIndex: 100, ...F.body(11), color: T.ink }}>
      <strong style={{ ...F.heading(13) }}>표시할 위젯과 순서</strong>
      <p style={{ ...F.body(10, 'light'), color: T.grayText, margin: '5px 0 10px' }}>드래그하거나 화살표로 순서를 바꿀 수 있어요.</p>
      {control.layout.order.map((id, index) => {
        const item = control.items.find((candidate) => candidate.id === id)
        if (!item) return null
        return <div key={id} draggable onDragStart={() => setDragged(id)} onDragEnd={() => setDragged(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragged && dragged !== id) control.move(dragged, id); setDragged(null) }} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34, borderRadius: 6, padding: '3px 4px', background: dragged === id ? T.lavender : T.itemBackground, marginBottom: 5 }}>
          <span aria-hidden style={{ color: T.graySecondary, cursor: 'grab' }}>⋮⋮</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, cursor: 'pointer' }}><input type="checkbox" checked={control.layout.visible.includes(id)} disabled={control.layout.visible.length === 1 && control.layout.visible.includes(id)} onChange={() => control.toggle(id)} />{item.label}</label>
          <button type="button" aria-label={`${item.label} 위로`} disabled={index === 0} onClick={() => control.moveBy(id, -1)} style={{ color: T.grayText, padding: 2 }}>↑</button>
          <button type="button" aria-label={`${item.label} 아래로`} disabled={index === control.layout.order.length - 1} onClick={() => control.moveBy(id, 1)} style={{ color: T.grayText, padding: 2 }}>↓</button>
        </div>
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <button type="button" onClick={control.showAll} style={{ color: T.purple, ...F.body(10, 'medium') }}>모두 추가</button>
        <button type="button" onClick={control.reset} style={{ color: T.grayText, ...F.body(10) }}>기본 배치</button>
      </div>
    </div>}
  </div>
}

export function WidgetColumns<ID extends string>({ id, visible, panels, initialLeft, style }: {
  id: string
  visible: ID[]
  panels: Record<ID, ReactNode>
  initialLeft?: number
  style?: React.CSSProperties
}) {
  if (visible.length === 1) return <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, ...style }}>{panels[visible[0]]}</div>
  return <ResizableColumns id={id} initialLeft={initialLeft} style={style} left={panels[visible[0]]} right={panels[visible[1]]} />
}

export function WidgetBoard<ID extends string>({ id, visible, panels, compactFirst, initialLeft, style }: {
  id: string
  visible: ID[]
  panels: Record<ID, ReactNode>
  compactFirst?: ID
  initialLeft?: number
  style?: React.CSSProperties
}) {
  if (visible.length < 3) return <WidgetColumns id={id} visible={visible} panels={panels} initialLeft={initialLeft} style={style} />
  const [first, second, third] = visible
  const left = <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0, minHeight: 0 }}>
    <div style={{ display: 'flex', flexDirection: 'column', flex: first === compactFirst ? '0 0 auto' : 1, minWidth: 0, minHeight: 0 }}>{panels[first]}</div>
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>{panels[second]}</div>
  </div>
  return <ResizableColumns id={id} initialLeft={initialLeft} style={style} left={left} right={panels[third]} />
}
