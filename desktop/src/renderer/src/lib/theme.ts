import type { CSSProperties } from 'react'

/// Color tokens from the Figma file's variables (`NaviTheme` in Swift).
export const T = {
  purple: '#7165FF', // Purple/Main
  ink: '#19191C', // Black/Main
  dark: '#2E434E', // Dark
  grayMain: '#6B7B86', // Gray/Main
  primaryText: '#455E6A', // Primary/Main
  blue: '#3366CC', // Blue/Main
  blueLight: '#E8F0FF', // Blue/Light
  /** Floating widget surface behind its white cards. */
  widgetBackground: '#F6F6F6', // White/Bg
  /** Selected day column in the month grid. */
  selectedCell: '#F6F5FF',
  grayText: '#75737A', // Gray/Text
  graySecondary: '#94A0AA', // Gray/Secondary
  border: '#DBD9E0', // Gray/Border
  borderLight: '#E6EAEE', // Gray/Border-light
  lavender: '#ECEAFF', // Background
  lime: '#D5FF63', // Lime/Main
  limeLight: '#ECFFBA', // Lime/Light
  green: '#2EA366', // Green/Main
  greenLight: '#E3F8E2', // Green/Light
  red: '#E5404F', // Red/Main
  redLight: '#FFE3E5', // Red/Light
  cardWhite: '#FFFFFF', // White/White
  offWhite: '#F8F9FA',
  /** Row fill inside cards (todo rows, mail rows, settings rows). */
  itemBackground: '#F8FAFB', // White/Item
  /** Main-window canvas behind the white cards. */
  canvas: '#F7F6F2', // White/Main
  /** Darker than `border` on purpose: white text on #DBD9E0 is too faint. */
  disabled: '#A9A7AF',
  /** macOS windowBackgroundColor stand-in for onboarding. */
  background: '#ECECEC'
} as const

/// Parses `#RRGGBB` category colors; falls back to the brand purple for malformed values.
export function naviHex(hex: string): string {
  const digits = hex.startsWith('#') ? hex.slice(1) : hex
  return /^[0-9a-fA-F]{6}$/.test(digits) ? `#${digits}` : T.purple
}

/// `color` at `opacity` over white (category tag washes).
export function wash(hex: string, opacity: number): string {
  const value = parseInt(naviHex(hex).slice(1), 16)
  const mix = (channel: number) => Math.round(255 + (channel - 255) * opacity)
  return `rgb(${mix((value >> 16) & 0xff)}, ${mix((value >> 8) & 0xff)}, ${mix(value & 0xff)})`
}

type Weight = 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black'
const weights: Record<Weight, number> = {
  thin: 100,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
  black: 900
}

/// The Figma type styles on the bundled Paperlogy / Pretendard / Bagel Fat One (`NaviFont`).
export const F = {
  /** Figma H2/H3/H6: "Paperlogy 7 Bold". */
  title: (size: number): CSSProperties => ({ fontFamily: 'Paperlogy', fontWeight: 700, fontSize: size }),
  /** Figma H4: "Paperlogy 6 SemiBold" — card and section titles. */
  heading: (size: number): CSSProperties => ({ fontFamily: 'Paperlogy', fontWeight: 600, fontSize: size }),
  paperlogy: (size: number, weight: Weight = 'regular'): CSSProperties => ({
    fontFamily: 'Paperlogy',
    fontWeight: weights[weight],
    fontSize: size
  }),
  /** The "navi" wordmark accent inside titles. */
  wordmark: (size: number): CSSProperties => ({ fontFamily: 'Bagel Fat One', fontWeight: 400, fontSize: size }),
  body: (size: number, weight: Weight = 'regular'): CSSProperties => ({
    fontFamily: 'Pretendard',
    fontWeight: weights[weight],
    fontSize: size
  }),
  /** Tag / badge labels. Figma's Yde Street B isn't bundled; Paperlogy 7 Bold stands in. */
  tag: (size: number): CSSProperties => ({ fontFamily: 'Paperlogy', fontWeight: 700, fontSize: size }),
  /** Dashboard date chips. Figma's Geist Mono isn't bundled; the system monospace stands in. */
  mono: (size: number): CSSProperties => ({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontWeight: 700,
    fontSize: size
  })
}
