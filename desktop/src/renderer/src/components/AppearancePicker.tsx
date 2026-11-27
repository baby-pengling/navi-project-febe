import { F, T } from '@/lib/theme'
import { COLOR_PAIRS, SHAPES, type AgentAppearance } from '@/lib/appearance'
import { HStack, NaviMascot, VStack } from './core'

const SHAPE_NAMES = { dome: '돔', cloud: '구름', square: '사각형', bean: '콩', star: '별' }
const COLOR_NAMES = { purple: '보라', coral: '코랄', blue: '파랑', mint: '민트', yellow: '노랑', pink: '분홍', teal: '청록' }

export function AppearancePicker({ value, onChange }: { value: AgentAppearance; onChange: (value: AgentAppearance) => void }) {
  const pair = COLOR_PAIRS.find((item) => item.id === value.color) ?? COLOR_PAIRS[0]
  return <VStack spacing={18}>
    <HStack spacing={16} style={{ justifyContent: 'center', background: T.cardWhite, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
      <NaviMascot width={150} shape={value.shape} main={pair.main} dot={pair.dot} />
    </HStack>
    <VStack spacing={8}>
      <span style={{ ...F.title(14), color: T.ink }}>모양 선택</span>
      <HStack spacing={6} style={{ justifyContent: 'space-between' }}>
        {SHAPES.map((shape) => <button key={shape} type="button" aria-label={`${SHAPE_NAMES[shape]} 모양`} aria-pressed={value.shape === shape} onClick={() => onChange({ ...value, shape })} style={{ flex: 1, minWidth: 0, padding: '8px 2px', borderRadius: 10, border: `2px solid ${value.shape === shape ? pair.main : T.border}`, background: value.shape === shape ? T.cardWhite : T.itemBackground, display: 'flex', justifyContent: 'center' }}><NaviMascot width={48} shape={shape} main={pair.main} dot={pair.dot} /></button>)}
      </HStack>
    </VStack>
    <VStack spacing={8}>
      <span style={{ ...F.title(14), color: T.ink }}>색상 선택</span>
      <HStack spacing={8} style={{ flexWrap: 'wrap' }}>
        {COLOR_PAIRS.map((item) => <button key={item.id} type="button" aria-label={`${COLOR_NAMES[item.id]} 색상`} aria-pressed={value.color === item.id} onClick={() => onChange({ ...value, color: item.id })} style={{ width: 42, height: 42, borderRadius: '50%', border: `2px solid ${value.color === item.id ? item.main : 'transparent'}`, padding: 3, flexShrink: 0 }}><span style={{ position: 'relative', display: 'block', width: '100%', height: '100%', borderRadius: '50%', background: item.main }}><span style={{ position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: '50%', background: item.dot, border: '1px solid #fff' }} /></span></button>)}
      </HStack>
    </VStack>
  </VStack>
}
