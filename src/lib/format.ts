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
