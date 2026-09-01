import { and, asc, count, desc, eq, gte, lte, min, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, drinkTypes, members, users } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import type { DrinkCategory } from '@/lib/caffeine'
import type { Profile } from '@/lib/blood-caffeine'
import { listActiveDrinkTypes, type ActiveDrinkType } from './drinks'
import {
  addLocalDays,
  bucketFor,
  enumerateLocalDates,
  localDateOf,
  periodToDateRange,
  previousPeriodRange,
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

/**
 * This period's total against the same span one period back — "vs last
 * week" rather than a lopsided full week against a partial one.
 *
 * `all` is excluded at the type level: there is no earlier "all" to compare
 * against, so callers decide what to show instead of this returning a number
 * that would only mislead.
 */
export async function getUserPreviousPeriodMg(
  db: AnyDb,
  userId: string,
  period: Exclude<Period, 'all'>,
  now = new Date(),
): Promise<number> {
  const range = previousPeriodRange(period, now)
  const totals = await aggregateByUser(db, range)
  return totals.find((row) => row.userId === userId)?.totalMg ?? 0
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

/**
 * A member's most-logged drinks, for the picker's one-tap row.
 *
 * The catalogue is open to everyone now, so it will grow past the point where a
 * flat grid of every drink is usable. This is what keeps logging at one tap:
 * the four or six you actually order, in front, with the rest behind a search.
 *
 * Padded from the catalogue's display order rather than returned short — a new
 * colleague with no history still needs a full row of buttons, and a row that
 * changes length as you use the app looks broken.
 *
 * Bounded to the last `days` local dates, which is what the
 * `(user_id, local_date)` index answers. Also stops a phase you went through in
 * March from outranking what you drink now.
 */
export async function getUserFavouriteDrinkTypes(
  db: AnyDb,
  userId: string,
  { limit, now = new Date(), days = 30 }: { limit: number; now?: Date; days?: number },
): Promise<ActiveDrinkType[]> {
  const since = addLocalDays(localDateOf(now), -days)

  const [ranked, catalogue] = await Promise.all([
    db
      .select({
        id: drinkTypes.id,
        slug: drinkTypes.slug,
        name: drinkTypes.name,
        category: drinkTypes.category,
        volumeMl: drinkTypes.volumeMl,
        caffeineMg: drinkTypes.caffeineMg,
      })
      .from(drinkLogs)
      .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
      .where(
        and(
          eq(drinkLogs.userId, userId),
          gte(drinkLogs.localDate, since),
          eq(drinkTypes.isActive, true),
        ),
      )
      .groupBy(drinkTypes.id)
      // Ties break on display order, so the row is stable rather than arbitrary.
      .orderBy(sql`count(*) desc`, asc(drinkTypes.sortOrder), asc(drinkTypes.id))
      .limit(limit),
    listActiveDrinkTypes(db),
  ])

  const favourites: ActiveDrinkType[] = [...ranked]
  const chosen = new Set(favourites.map((type) => type.id))

  for (const type of catalogue) {
    if (favourites.length >= limit) break
    if (!chosen.has(type.id)) favourites.push(type)
  }

  return favourites
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

/** One member's drinks in the window, with the physiology to model them by. */
export type MemberIntake = {
  userId: string
  profile: Profile
  doses: { consumedAt: Date; mg: number }[]
}

/**
 * Everyone's recent drinks, grouped by member, for the team caffeine curve.
 *
 * Grouped rather than pooled because clearance is per person: summing the
 * milligrams first and applying one half-life to the total would model a
 * thirty-person office as a single very large human. Each member's curve is
 * computed with their own profile and the curves are added.
 *
 * The same cost shape as `getUserIntakeEvents`, minus the user predicate: the
 * `local_date` bound keeps it to two days of drinks across the team — a couple
 * of hundred rows — rather than the table.
 */
export async function getTeamIntakeEvents(
  db: AnyDb,
  { from, now = new Date() }: { from: Date; now?: Date },
): Promise<MemberIntake[]> {
  const rows = await db
    .select({
      userId: drinkLogs.userId,
      consumedAt: drinkLogs.consumedAt,
      caffeineMg: drinkLogs.caffeineMg,
      halfLifeMinutes: members.eliminationHalfLifeMinutes,
      sleepThresholdMg: members.sleepThresholdMg,
    })
    .from(drinkLogs)
    .innerJoin(members, eq(members.userId, drinkLogs.userId))
    .where(
      and(
        gte(drinkLogs.localDate, localDateOf(from)),
        lte(drinkLogs.localDate, localDateOf(now)),
        gte(drinkLogs.consumedAt, from),
      ),
    )
    .orderBy(asc(drinkLogs.consumedAt))

  const byMember = new Map<string, MemberIntake>()

  for (const row of rows) {
    const existing = byMember.get(row.userId)
    const dose = { consumedAt: row.consumedAt, mg: row.caffeineMg }

    if (existing) {
      existing.doses.push(dose)
      continue
    }

    byMember.set(row.userId, {
      userId: row.userId,
      profile: {
        eliminationHalfLifeMs: row.halfLifeMinutes * 60_000,
        sleepThresholdMg: row.sleepThresholdMg,
      },
      doses: [dose],
    })
  }

  return [...byMember.values()]
}

/** One drink, as the ticker shows it: who, what, and when. */
export type TeamActivityEvent = {
  id: number
  userId: string
  displayName: string
  drinkName: string
  caffeineMg: number
  volumeMl: number | null
  consumedAt: Date
}

/** How far back the feed looks. Long enough to cover a working day. */
const ACTIVITY_WINDOW_MS = 12 * 60 * 60 * 1000

/**
 * The team's most recent drinks.
 *
 * Deliberately reads `drink_logs` and never `alcohol_logs`. Party mode is
 * opt-in and per member, and the viewer having it switched on is not the same
 * as the person in the feed having agreed to appear in one. Caffeine is already
 * team-visible on the leaderboard, so this discloses nothing new; alcohol would
 * disclose something a member entered only for themselves.
 *
 * Bounded by `local_date` across two days rather than by `consumed_at` alone,
 * so `drink_logs_date_idx` serves it and the scan stays flat as history grows.
 * Two dates because midnight should not empty the feed: a drink at eleven last
 * night is still recent at half past midnight, and it carries yesterday's date.
 *
 * The upper bound on `consumed_at` matters as much as the lower one. A drink
 * can be logged for an earlier time, and without it a fixture — or a clock
 * skew — could put something in the feed that has not happened yet.
 */
export async function getTeamActivity(
  db: AnyDb,
  { now = new Date(), limit = 15 }: { now?: Date; limit?: number } = {},
): Promise<TeamActivityEvent[]> {
  const today = localDateOf(now)
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_MS)

  return db
    .select({
      id: drinkLogs.id,
      userId: drinkLogs.userId,
      displayName: members.displayName,
      drinkName: drinkTypes.name,
      caffeineMg: drinkLogs.caffeineMg,
      volumeMl: drinkLogs.volumeMl,
      consumedAt: drinkLogs.consumedAt,
    })
    .from(drinkLogs)
    .innerJoin(members, eq(members.userId, drinkLogs.userId))
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .where(
      and(
        gte(drinkLogs.localDate, addLocalDays(today, -1)),
        lte(drinkLogs.localDate, today),
        gte(drinkLogs.consumedAt, since),
        lte(drinkLogs.consumedAt, now),
      ),
    )
    .orderBy(desc(drinkLogs.consumedAt))
    .limit(limit)
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
