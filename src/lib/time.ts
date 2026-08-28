/**
 * All date bucketing for the app happens in one fixed timezone.
 *
 * SQLite has no timezone database, so there is no `AT TIME ZONE` to lean on in
 * queries. Instead every drink log stores the local calendar date and hour it
 * happened, resolved once here at write time. That turns every "group by day"
 * query into a plain indexed `GROUP BY local_date`, and confines all daylight
 * saving reasoning to this file, where it is unit tested.
 */
export const APP_TIMEZONE = 'Europe/Oslo'

/** The periods the UI can slice statistics by. */
export type Period = 'today' | 'week' | 'month' | 'all'

export const PERIODS: readonly Period[] = ['today', 'week', 'month', 'all'] as const

/** A calendar date in `YYYY-MM-DD` form, as observed in {@link APP_TIMEZONE}. */
export type LocalDate = string

export type LocalBuckets = {
  localDate: LocalDate
  /** Hour of the local day, 0-23. */
  localHour: number
}

/**
 * `hourCycle: 'h23'` matters: with `hour12: false` some engines render local
 * midnight as hour 24 rather than 0.
 */
const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})

/**
 * Resolve an instant to the calendar date and hour it falls on in Oslo.
 *
 * Uses the platform's IANA timezone database, so both daylight saving
 * transitions are handled without a lookup table: the local 02:00 hour simply
 * does not occur in spring, and occurs twice in autumn.
 */
export function localBuckets(instant: Date): LocalBuckets {
  const parts = partsFormatter.formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    localHour: Number(get('hour')),
  }
}

/**
 * The same parts as {@link partsFormatter}, to the minute.
 *
 * Only {@link osloOffsetMs} needs this resolution, and reusing one formatter
 * for both would make every `localBuckets` call format two fields it discards.
 */
const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Oslo's offset from UTC at a given instant, in milliseconds. */
function osloOffsetMs(instant: Date): number {
  const parts = offsetFormatter.formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)

  // Reading the local parts back as though they were UTC turns the difference
  // from the real instant into the offset.
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
  )

  return asIfUtc - Math.floor(instant.getTime() / 60_000) * 60_000
}

/**
 * The inverse of {@link localBuckets}: the instant at which Oslo's wall clock
 * reads a given date and `HH:MM`.
 *
 * Needed because a drink can be logged for a time earlier in the day, and
 * `new Date('2026-08-26T09:15')` would resolve against the *server's* timezone
 * — UTC in production, whatever the laptop says locally.
 *
 * Two correction passes rather than one: the first guess can land on the wrong
 * side of a daylight saving transition, in which case it was corrected by the
 * wrong offset. Re-deriving the offset from the corrected instant fixes it.
 *
 * Total by construction, so a picker cannot produce an invalid Date. The two
 * awkward cases resolve deliberately: a local time inside the spring gap comes
 * back an hour later, and an ambiguous autumn time comes back as the later of
 * its two passes.
 */
export function instantFromLocalTime(date: LocalDate, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute)

  let instant = asIfUtc - osloOffsetMs(new Date(asIfUtc))
  instant = asIfUtc - osloOffsetMs(new Date(instant))

  return new Date(instant)
}

/**
 * The next moment Oslo's wall clock will read a given `HH:MM`.
 *
 * Today's occurrence if it is still to come, tomorrow's otherwise. Needed
 * because a bedtime is a time of day rather than an instant, and "how late can
 * I have a coffee" has to be asked about the night that is coming — including
 * for the people whose bedtime is 01:30, which is always tomorrow.
 */
export function nextLocalTimeAfter(time: string, now: Date): Date {
  const today = instantFromLocalTime(localDateOf(now), time)
  if (today.getTime() > now.getTime()) return today

  return instantFromLocalTime(addLocalDays(localDateOf(now), 1), time)
}

/** The calendar date an instant falls on in Oslo. */
export function localDateOf(instant: Date): LocalDate {
  return localBuckets(instant).localDate
}

/**
 * Calendar arithmetic runs on UTC midnight of the given date.
 *
 * This is deliberate: treating a local date as a pure calendar value means a
 * clock change can never shift it by a day, which is exactly the bug that
 * naive local-time arithmetic produces twice a year.
 */
function toUtcMidnight(date: LocalDate): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function fromUtcMidnight(date: Date): LocalDate {
  return date.toISOString().slice(0, 10)
}

const MS_PER_DAY = 86_400_000

/** Shift a calendar date by whole days. Negative values move backwards. */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMidnight(new Date(toUtcMidnight(date).getTime() + days * MS_PER_DAY))
}

/** ISO weekday: Monday is 1, Sunday is 7. */
export function weekdayOf(date: LocalDate): number {
  return toUtcMidnight(date).getUTCDay() || 7
}

/** Every calendar date from `from` to `to`, inclusive. Empty if inverted. */
export function enumerateLocalDates(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = []
  for (let cursor = from; cursor <= to; cursor = addLocalDays(cursor, 1)) {
    dates.push(cursor)
  }
  return dates
}

export type DateRange = {
  /** Inclusive start, or `null` for "since the beginning". */
  from: LocalDate | null
  /** Inclusive end. */
  to: LocalDate
}

/**
 * The inclusive range of local dates a period covers, relative to `now`.
 *
 * Weeks start on Monday, following Norwegian convention.
 */
export function periodToDateRange(period: Period, now: Date): DateRange {
  const today = localDateOf(now)

  switch (period) {
    case 'today':
      return { from: today, to: today }
    case 'week':
      return { from: addLocalDays(today, -(weekdayOf(today) - 1)), to: today }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'all':
      return { from: null, to: today }
  }
}

/**
 * How fine the time series for a period should be.
 *
 * A single day is only interesting hour by hour; anything longer would be
 * unreadable at that resolution.
 */
export function bucketFor(period: Period): 'hour' | 'day' {
  return period === 'today' ? 'hour' : 'day'
}
