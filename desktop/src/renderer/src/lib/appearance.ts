export const SHAPES = ['dome', 'cloud', 'square', 'bean', 'star'] as const
export type AgentShape = typeof SHAPES[number]

export const COLOR_PAIRS = [
  { id: 'purple', main: '#7165FF', primary: '#7165FF', dot: '#D5FF63' },
  { id: 'coral', main: '#FF756B', primary: '#BD4138', dot: '#FFD657' },
  { id: 'blue', main: '#7799FF', primary: '#355CBF', dot: '#FFFFFF' },
  { id: 'mint', main: '#67D5B9', primary: '#087662', dot: '#4C3BFF' },
  { id: 'yellow', main: '#FFCE55', primary: '#866000', dot: '#7165FF' },
  { id: 'pink', main: '#F5ADBF', primary: '#A33C62', dot: '#4269EF' },
  { id: 'teal', main: '#006C63', primary: '#006C63', dot: '#FF756B' }
] as const
export type AgentColor = typeof COLOR_PAIRS[number]['id']
export type AgentAppearance = { shape: AgentShape; color: AgentColor }
export const DEFAULT_APPEARANCE: AgentAppearance = { shape: 'dome', color: 'purple' }

export function hasSavedAppearance(metadata: Record<string, unknown> | undefined): boolean {
  return SHAPES.some((shape) => shape === metadata?.navi_agent_shape)
    && COLOR_PAIRS.some((pair) => pair.id === metadata?.navi_agent_color)
}

export function readAppearance(metadata: Record<string, unknown> | undefined): AgentAppearance {
  const shape = SHAPES.find((value) => value === metadata?.navi_agent_shape) ?? DEFAULT_APPEARANCE.shape
  const color = COLOR_PAIRS.find((value) => value.id === metadata?.navi_agent_color)?.id ?? DEFAULT_APPEARANCE.color
  return { shape, color }
}

export function applyAppearance(appearance: AgentAppearance): void {
  const pair = COLOR_PAIRS.find((value) => value.id === appearance.color) ?? COLOR_PAIRS[0]
  const soft = (hex: string, opacity: number) => {
    const value = parseInt(hex.slice(1), 16)
    const mix = (shift: number) => Math.round(255 + (((value >> shift) & 255) - 255) * opacity)
    return `rgb(${mix(16)}, ${mix(8)}, ${mix(0)})`
  }
  const root = document.documentElement
  root.style.setProperty('--navi-primary', pair.primary)
  root.style.setProperty('--navi-mascot-main', pair.main)
  root.style.setProperty('--navi-soft', soft(pair.primary, 0.14))
  root.style.setProperty('--navi-dot', pair.dot)
  root.style.setProperty('--navi-dot-soft', soft(pair.dot, 0.38))
  root.style.setProperty('--navi-selected', soft(pair.primary, 0.07))
  root.dataset.naviShape = appearance.shape
}
