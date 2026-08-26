import { and, asc, count, eq, gte, lte, min, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, members, users } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import type { DrinkCategory } from '@/lib/caffeine'
import {
  addLocalDays,
  bucketFor,
  enumerateLocalDates,
  localDateOf,
  periodToDateRange,
  type DateRange,
  type LocalDate,
  type Period,
} from '@/lib/time'

type AnyDb = Db | TestDb

/**
 * The statistics interface.
 *
 * Everything the dashboards know about aggregation lives behind these
 * functions. In particular, callers never need to know which table answers a
 * question: anything grouped by day or coarser reads the `daily_totals` rollup,
 * and only hour-resolution questions touch `drink_logs`. That routing is a cost
 * decision (Turso bills rows scanned) and it should be free to change without
 * touching a single page.
 *
 * Aggregation happens in SQL rather than by pulling rows into JS. Gap filling
 * happens in JS, because SQLite has no `generate_series` and a chart with
 * missing days lies about the shape of the data.
 */

export type SeriesPoint = {
  /** `YYYY-MM-DD` for day buckets, `HH` for hour buckets. */
  bucket: string
  mg: number
}

export type UserSummary = {
  totalMg: number
  drinkCount: number
  coffeeCount: number
  energyCount: number
  /** 1-based position among all members for this period. Ties share a rank. */
  rank: number
  memberCount: number
}

export type LeaderboardRow = {
  userId: string
  displayName: string
  image: string | null
  totalMg: number
  coffeeCount: number
  energyCount: number
  rank: number
}

export type CategorySplit = {
  category: DrinkCategory
  mg: number
  count: number
}

export type HourBar = {
  hour: number
  mg: number
}

/** One drink, as the caffeine curve needs it: how much, and when. */
export type IntakeEvent = {
  consumedAt: Date
  caffeineMg: number
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                            */
/* -------------------------------------------------------------------------- */

function withinRange(column: SQLiteColumn, range: DateRange): SQL | undefined {
  return range.from ? and(gte(column, range.from), lte(column, range.to)) : lte(column, range.to)
}

/** Per-user totals over a date range, read from the rollup. */
async function aggregateByUser(db: AnyDb, range: DateRange) {
  return db
    .select({
      userId: dailyTotals.userId,
      totalMg: sql<number>`coalesce(sum(${dailyTotals.totalMg}), 0)`,
      coffeeCount: sql<number>`coalesce(sum(${dailyTotals.coffeeCount}), 0)`,
      energyCount: sql<number>`coalesce(sum(${dailyTotals.energyCount}), 0)`,
    })
    .from(dailyTotals)
    .where(withinRange(dailyTotals.localDate, range))
    .groupBy(dailyTotals.userId)
}

/**
 * Assign 1-based ranks to a list already sorted by descending total.
 *
 * Equal totals share a rank, and the next distinct total skips ahead — so two
 * people tied for first are both 1st and the next is 3rd.
 */
function assignRanks<T extends { totalMg: number }>(sorted: T[]): (T & { rank: number })[] {
  let lastTotal: number | null = null
  let lastRank = 0

  return sorted.map((row, index) => {
    if (row.totalMg !== lastTotal) {
      lastRank = index + 1
      lastTotal = row.totalMg
    }
    return { ...row, rank: lastRank }
  })
}

/**
 * The first date with any data, used as the start of an open-ended range.
 *
 * An "all time" chart has to begin somewhere; beginning at the first drink is
 * the only choice that doesn't invent empty history.
 */
async function earliestLocalDate(db: AnyDb, userId?: string): Promise<LocalDate | null> {
  const [row] = await db
    .select({ earliest: min(dailyTotals.localDate) })
    .from(dailyTotals)
    .where(userId ? eq(dailyTotals.userId, userId) : undefined)

  return row?.earliest ?? null
}

/** Resolve an open-ended range to concrete endpoints for charting. */
async function chartRange(db: AnyDb, range: DateRange, userId?: string): Promise<DateRange> {
  if (range.from) return range
  const earliest = await earliestLocalDate(db, userId)
  return { from: earliest ?? range.to, to: range.to }
}

function fillDays(rows: { bucket: string; mg: number }[], from: LocalDate, to: LocalDate) {
  const byDate = new Map(rows.map((row) => [row.bucket, row.mg]))
  return enumerateLocalDates(from, to).map((date) => ({
    bucket: date,
    mg: byDate.get(date) ?? 0,
  }))
}

function fillHours(rows: { hour: number; mg: number }[]): HourBar[] {
  const byHour = new Map(rows.map((row) => [row.hour, row.mg]))
  return Array.from({ length: 24 }, (_, hour) => ({ hour, mg: byHour.get(hour) ?? 0 }))
}

/* -------------------------------------------------------------------------- */
/* Personal statistics                                                       */
/* -------------------------------------------------------------------------- */

export async function getUserSummary(
  db: AnyDb,
  userId: string,
  period: Period,
  now = new Date(),
): Promise<UserSummary> {
  const range = periodToDateRange(period, now)

  const [totals, [memberTally]] = await Promise.all([
    aggregateByUser(db, range),
    db.select({ total: count() }).from(members),
  ])

  const ranked = assignRanks([...totals].sort((a, b) => b.totalMg - a.totalMg))
  const mine = ranked.find((row) => row.userId === userId)
  const memberCount = memberTally?.total ?? 0

  if (!mine) {
    // No drinks in this period: last place, or first if nobody drank anything.
    return {
      totalMg: 0,
      drinkCount: 0,
      coffeeCount: 0,
      energyCount: 0,
      rank: ranked.length + 1,
      memberCount,
    }
  }

  return {
    totalMg: mine.totalMg,
    drinkCount: mine.coffeeCount + mine.energyCount,
    coffeeCount: mine.coffeeCount,
    energyCount: mine.energyCount,
    rank: mine.rank,
    memberCount,
  }
}

export async function getUserTimeSeries(
  db: AnyDb,
  userId: string,
  period: Period,
  now = new Date(),
): Promise<SeriesPoint[]> {
  const range = periodToDateRange(period, now)

  if (bucketFor(period) === 'hour') {
    const hours = await hourRows(db, range, userId)
    return fillHours(hours).map(({ hour, mg }) => ({
      bucket: String(hour).padStart(2, '0'),
      mg,
    }))
  }

  const rows = await db
    .select({
      bucket: dailyTotals.localDate,
      mg: sql<number>`coalesce(sum(${dailyTotals.totalMg}), 0)`,
    })
    .from(dailyTotals)
    .where(and(eq(dailyTotals.userId, userId), withinRange(dailyTotals.localDate, range)))
    .groupBy(dailyTotals.localDate)
    .orderBy(asc(dailyTotals.localDate))

  const { from, to } = await chartRange(db, range, userId)
  return fillDays(rows, from!, to)
}

/**
 * Consecutive days ending today with at least one drink.
 *
 * Today not having a drink yet does not break a streak — the day isn't over —
 * so a streak may end on yesterday. Two days without a drink ends it.
 */
/**
 * One member's individual drinks since an instant, for the caffeine curve.
 *
 * The one place a chart reads `drink_logs` rather than the rollup, because a
 * decay curve needs the drinks themselves: a daily total cannot say whether
 * 300mg arrived at 08:00 or at 20:00, which is the only thing the curve is
 * about.
 *
 * Cheap despite that. The `local_date` predicate is what the
 * `(user_id, local_date)` index answers, so the scan covers two days of one
 * person's drinks rather than the table; `consumed_at` then trims the window to
 * the exact hour. Filtering on `consumed_at` alone would read every drink the
 * member has ever logged.
 */
export async function getUserIntakeEvents(
  db: AnyDb,
  userId: string,
  { from, now = new Date() }: { from: Date; now?: Date },
): Promise<IntakeEvent[]> {
  return db
    .select({
      consumedAt: drinkLogs.consumedAt,
      caffeineMg: drinkLogs.caffeineMg,
    })
    .from(drinkLogs)
    .where(
      and(
        eq(drinkLogs.userId, userId),
        gte(drinkLogs.localDate, localDateOf(from)),
        lte(drinkLogs.localDate, localDateOf(now)),
        gte(drinkLogs.consumedAt, from),
      ),
    )
    .orderBy(asc(drinkLogs.consumedAt))
}

export async function getUserStreak(db: AnyDb, userId: string, now = new Date()): Promise<number> {
  const rows = await db
    .select({ localDate: dailyTotals.localDate })
    .from(dailyTotals)
    .where(eq(dailyTotals.userId, userId))
    .orderBy(asc(dailyTotals.localDate))

  const active = new Set(rows.map((row) => row.localDate))
  const today = localDateOf(now)

  let cursor = active.has(today) ? today : addLocalDays(today, -1)
  let streak = 0

  while (active.has(cursor)) {
    streak++
    cursor = addLocalDays(cursor, -1)
  }

  return streak
}

/* -------------------------------------------------------------------------- */
/* Team statistics                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every member ranked by caffeine for the period.
 *
 * Members with nothing logged are included at zero rather than omitted, so a
 * new colleague can see themselves on the board straight away.
 */
export async function getLeaderboard(
  db: AnyDb,
  period: Period,
  now = new Date(),
): Promise<LeaderboardRow[]> {
  const range = periodToDateRange(period, now)

  const [roster, totals] = await Promise.all([
    db
      .select({
        userId: members.userId,
        displayName: members.displayName,
        image: users.image,
      })
      .from(members)
      .leftJoin(users, eq(users.id, members.userId)),
    aggregateByUser(db, range),
  ])

  const byUser = new Map(totals.map((row) => [row.userId, row]))

  const rows = roster.map((person) => {
    const totalsForPerson = byUser.get(person.userId)
    return {
      userId: person.userId,
      displayName: person.displayName,
      image: person.image ?? null,
      totalMg: totalsForPerson?.totalMg ?? 0,
      coffeeCount: totalsForPerson?.coffeeCount ?? 0,
      energyCount: totalsForPerson?.energyCount ?? 0,
    }
  })

  rows.sort((a, b) => b.totalMg - a.totalMg || a.displayName.localeCompare(b.displayName))
  return assignRanks(rows)
}

export async function getTeamTimeSeries(
  db: AnyDb,
  period: Period,
  now = new Date(),
): Promise<SeriesPoint[]> {
  const range = periodToDateRange(period, now)

  if (bucketFor(period) === 'hour') {
    const hours = await hourRows(db, range)
    return fillHours(hours).map(({ hour, mg }) => ({
      bucket: String(hour).padStart(2, '0'),
      mg,
    }))
  }

  const rows = await db
    .select({
      bucket: dailyTotals.localDate,
      mg: sql<number>`coalesce(sum(${dailyTotals.totalMg}), 0)`,
    })
    .from(dailyTotals)
    .where(withinRange(dailyTotals.localDate, range))
    .groupBy(dailyTotals.localDate)
    .orderBy(asc(dailyTotals.localDate))

  const { from, to } = await chartRange(db, range)
  return fillDays(rows, from!, to)
}

/**
 * When the office drinks, by hour of the local day.
 *
 * The one question that genuinely needs `drink_logs`: the rollup deliberately
 * has no hour resolution.
 */
export async function getTeamHourHistogram(
  db: AnyDb,
  period: Period,
  now = new Date(),
): Promise<HourBar[]> {
  const range = periodToDateRange(period, now)
  return fillHours(await hourRows(db, range))
}

export async function getTeamSplit(
  db: AnyDb,
  period: Period,
  now = new Date(),
): Promise<CategorySplit[]> {
  const range = periodToDateRange(period, now)

  const [row] = await db
    .select({
      coffeeMg: sql<number>`coalesce(sum(${dailyTotals.coffeeMg}), 0)`,
      energyMg: sql<number>`coalesce(sum(${dailyTotals.energyMg}), 0)`,
      otherMg: sql<number>`coalesce(sum(${dailyTotals.otherMg}), 0)`,
      coffeeCount: sql<number>`coalesce(sum(${dailyTotals.coffeeCount}), 0)`,
      energyCount: sql<number>`coalesce(sum(${dailyTotals.energyCount}), 0)`,
      otherCount: sql<number>`coalesce(sum(${dailyTotals.otherCount}), 0)`,
    })
    .from(dailyTotals)
    .where(withinRange(dailyTotals.localDate, range))

  return [
    { category: 'coffee', mg: row?.coffeeMg ?? 0, count: row?.coffeeCount ?? 0 },
    { category: 'energy', mg: row?.energyMg ?? 0, count: row?.energyCount ?? 0 },
    { category: 'other', mg: row?.otherMg ?? 0, count: row?.otherCount ?? 0 },
  ]
}

/** Hour-resolution rows, optionally for one person. */
async function hourRows(db: AnyDb, range: DateRange, userId?: string) {
  const dateFilter = withinRange(drinkLogs.localDate, range)

  return db
    .select({
      hour: drinkLogs.localHour,
      mg: sql<number>`coalesce(sum(${drinkLogs.caffeineMg}), 0)`,
    })
    .from(drinkLogs)
    .where(userId ? and(eq(drinkLogs.userId, userId), dateFilter) : dateFilter)
    .groupBy(drinkLogs.localHour)
    .orderBy(asc(drinkLogs.localHour))
}
