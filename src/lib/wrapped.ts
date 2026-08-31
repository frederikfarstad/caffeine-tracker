import type { LocalDate } from './time'

/**
 * A calendar month, `YYYY-MM`.
 *
 * A string rather than a pair of numbers, for the reason `lib/patch-notes.ts`
 * uses one for its ids: ordering and comparison become the same operation, so
 * "is this month later than the one they last saw" needs no parsing.
 */
export type MonthKey = string

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** Whether a string is a month this app will accept from a URL. */
export function isValidMonth(value: string): boolean {
  return MONTH_PATTERN.test(value)
}

export function monthOf(date: LocalDate): MonthKey {
  return date.slice(0, 7)
}

export function previousMonth(month: MonthKey): MonthKey {
  const [year, monthNumber] = month.split('-').map(Number)

  return monthNumber === 1
    ? `${year - 1}-12`
    : `${year}-${String(monthNumber - 1).padStart(2, '0')}`
}

/**
 * The first and last local dates of a month.
 *
 * `Date.UTC(year, month, 0)` is the day before the first of `month + 1`, which
 * for a one-based month number is the last day of the month asked for. Leap
 * years come free, which is why this is arithmetic rather than a lookup table.
 */
export function monthRange(month: MonthKey): { from: LocalDate; to: LocalDate } {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function formatMonth(month: MonthKey): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${MONTH_NAMES[monthNumber - 1]} ${year}`
}
