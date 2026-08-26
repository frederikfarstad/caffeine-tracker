import type { Period } from './time'

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
