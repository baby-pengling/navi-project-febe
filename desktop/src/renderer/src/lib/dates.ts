// Foundation `Calendar` / `DateFormatter` helpers the Swift models use, in device time.

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE)
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

export function isTomorrow(date: Date): boolean {
  return isSameDay(date, addDays(new Date(), 1))
}

/// The start of the hour after `date`.
export function nextHour(date: Date = new Date()): Date {
  const d = new Date(date)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

/// Monday-first week start (`Calendar.current` with firstWeekday = 2, as in Korea).
export function startOfWeek(date: Date, firstWeekday: 0 | 1 = 0): Date {
  const d = startOfDay(date)
  const offset = (d.getDay() - firstWeekday + 7) % 7
  return addDays(d, -offset)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토']

/// A small ko_KR `DateFormatter.dateFormat` subset: yyyy MM M dd d HH H hh h mm a E EEEE, plus
/// EEE as the English abbreviation (the dashboard date chip), and literal text in quotes.
export function format(date: Date, pattern: string): string {
  const tokens: Record<string, () => string> = {
    yyyy: () => String(date.getFullYear()),
    MM: () => pad(date.getMonth() + 1),
    M: () => String(date.getMonth() + 1),
    dd: () => pad(date.getDate()),
    d: () => String(date.getDate()),
    HH: () => pad(date.getHours()),
    H: () => String(date.getHours()),
    hh: () => pad(((date.getHours() + 11) % 12) + 1),
    h: () => String(((date.getHours() + 11) % 12) + 1),
    mm: () => pad(date.getMinutes()),
    a: () => (date.getHours() < 12 ? '오전' : '오후'),
    EEEE: () => WEEKDAYS_KO[date.getDay()] + '요일',
    EEE: () => WEEKDAYS_EN[date.getDay()],
    E: () => WEEKDAYS_KO[date.getDay()]
  }
  let out = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === "'") {
      const end = pattern.indexOf("'", i + 1)
      out += pattern.slice(i + 1, end === -1 ? undefined : end)
      i = end === -1 ? pattern.length : end + 1
      continue
    }
    const token = ['yyyy', 'EEEE', 'EEE', 'MM', 'dd', 'HH', 'hh', 'mm', 'M', 'd', 'H', 'h', 'a', 'E'].find((t) => pattern.startsWith(t, i))
    if (token) {
      out += tokens[token]()
      i += token.length
    } else {
      out += pattern[i]
      i++
    }
  }
  return out
}

/// `todos.date` value ("yyyy-MM-dd" in the device time zone).
export function dayString(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/// Parses "yyyy-MM-dd" as local midnight.
export function parseDay(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/// RFC3339 with fractional seconds, without, or a bare day (`EdgeClient.parseDate`).
export function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const day = parseDay(value)
  if (day) return day
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/// RFC3339 in the device time zone, without fractional seconds (`EdgeClient.formatDate`).
export function formatDate(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}
