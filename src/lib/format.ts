import { APP_TIMEZONE } from './time'
import type { Period } from './time'

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * An instant as an Oslo wall clock, `HH:MM`.
 *
 * Takes epoch milliseconds as well as a Date because the caffeine chart's axis
 * is numeric — a time axis needs real numbers to space its ticks evenly, which
 * the string buckets elsewhere in the app cannot do.
 */
export function formatOsloClock(instant: Date | number): string {
  return clockFormatter.format(instant)
}

/**
 * The current Oslo wall clock as `HH:MM`, for prefilling a time input.
 *
 * Formatted in the app's timezone rather than the browser's, so someone opening
 * the app from a conference abroad still sees — and logs against — the clock
 * the rest of the numbers are bucketed by.
 *
 * Here rather than in a panel because both logging panels need it, and two
 * copies of a timezone-formatting helper is how they start disagreeing.
 */
export function osloClockNow(): string {
  return clockFormatter.format(new Date())
}

/** Compact axis label for a `YYYY-MM-DD` bucket: `26.08`, Norwegian order. */
export function formatDayTick(bucket: string): string {
  const [, month, day] = bucket.split('-')
  return `${day}.${month}`
}

/** Full label for a bucket, used in tooltips and the table view. */
export function formatBucketLabel(bucket: string, period: Period): string {
  return period === 'today' ? `${bucket}:00` : formatDayTick(bucket)
}

export const PERIOD_TITLES: Record<Period, string> = {
  today: 'today',
  week: 'this week',
  month: 'this month',
  all: 'all time',
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/**
 * How long ago an instant was, in the shortest form that is still true.
 *
 * Takes `now` as an argument rather than reading the clock, so a server render
 * can label a whole list against the single instant the rest of the page was
 * built from. A helper that called `Date.now()` itself would give two rows in
 * the same list two different presents.
 *
 * Clamps the future to "just now": a clock a few seconds out should not produce
 * a negative count.
 */
export function formatAgo(instant: Date | number, now: Date | number): string {
  const elapsed = Number(now) - Number(instant)
  if (elapsed < MINUTE_MS) return 'just now'

  const minutes = Math.floor(elapsed / MINUTE_MS)
  if (minutes < 60) return `${minutes} min ago`

  return `${Math.floor(elapsed / HOUR_MS)} h ago`
}
