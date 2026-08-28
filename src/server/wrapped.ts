import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, drinkTypes, members } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import type { BadgeId } from '@/lib/badges'
import { addLocalDays, type LocalDate } from '@/lib/time'
import { monthRange, type MonthKey } from '@/lib/wrapped'
import { getBadgesFor } from './badges'

type AnyDb = Db | TestDb

export type WrappedFavourite = { name: string; count: number }

/** One person's month. */
export type Wrapped = {
  month: MonthKey
  totalMg: number
  drinkCount: number
  coffeeCount: number
  energyCount: number
  activeDays: number
  longestStreak: number
  rank: number
  memberCount: number
  biggestDay: { localDate: LocalDate; mg: number } | null
  favourite: WrappedFavourite | null
  peakHour: number | null
  badgeIds: BadgeId[]
  teamMg: number
}

/**
 * The longest run of consecutive dates in a set.
 *
 * Bounded by whatever dates it is given, which is how a streak is kept inside
 * the month: a run continuing into the next month is not this month's story.
 */
function longestRun(dates: LocalDate[]): number {
  const present = new Set(dates)
  let longest = 0

  for (const date of present) {
    // Only count from the start of a run, so each is walked once rather than
    // once per day it contains.
    if (present.has(addLocalDays(date, -1))) continue

    let length = 0
    let cursor = date
    while (present.has(cursor)) {
      length += 1
      cursor = addLocalDays(cursor, 1)
    }
    longest = Math.max(longest, length)
  }

  return longest
}

/**
 * One person's month, or null if they did not have one.
 *
 * Null rather than a zeroed summary, because the dialog's firing rule is "is
 * there a wrapped for last month" — and somebody who joined a week ago should
 * not be shown an empty celebration of a month they were not here for.
 *
 * Totals come from `daily_totals`: a month is thirty-odd rows there, against
 * however many drinks it took to fill them. Only the favourite drink and the
 * peak hour need `drink_logs`, and both are bounded to the month by
 * `local_date`, which `drink_logs_user_date_idx` serves.
 */
export async function getWrapped(
  db: AnyDb,
  userId: string,
  month: MonthKey,
): Promise<Wrapped | null> {
  const { from, to } = monthRange(month)
  const withinMonth = and(gte(dailyTotals.localDate, from), lte(dailyTotals.localDate, to))
  const myLogsThisMonth = and(
    eq(drinkLogs.userId, userId),
    gte(drinkLogs.localDate, from),
    lte(drinkLogs.localDate, to),
  )

  const days = await db
    .select({
      localDate: dailyTotals.localDate,
      totalMg: dailyTotals.totalMg,
      coffeeCount: dailyTotals.coffeeCount,
      energyCount: dailyTotals.energyCount,
      otherCount: dailyTotals.otherCount,
    })
    .from(dailyTotals)
    .where(and(eq(dailyTotals.userId, userId), withinMonth))

  if (days.length === 0) return null

  const totalMg = days.reduce((sum, day) => sum + day.totalMg, 0)
  const coffeeCount = days.reduce((sum, day) => sum + day.coffeeCount, 0)
  const energyCount = days.reduce((sum, day) => sum + day.energyCount, 0)
  const otherCount = days.reduce((sum, day) => sum + day.otherCount, 0)

  const biggest = days.reduce((best, day) => (day.totalMg > best.totalMg ? day : best), days[0])
  const active = days.filter((day) => day.totalMg > 0)

  /*
   * Everyone's month, for the rank and the team line. One row per member per
   * day, so this stays a month-sized read however long the team has existed.
   */
  const perMember = await db
    .select({
      userId: dailyTotals.userId,
      totalMg: sql<number>`coalesce(sum(${dailyTotals.totalMg}), 0)`,
    })
    .from(dailyTotals)
    .where(withinMonth)
    .groupBy(dailyTotals.userId)

  const sorted = [...perMember].sort((a, b) => b.totalMg - a.totalMg)
  // Ties share a rank, as they do on the leaderboard: the position of the first
  // member whose total this one matches or beats.
  const rank = sorted.findIndex((row) => row.totalMg <= totalMg) + 1

  const [favouriteRow] = await db
    .select({ name: drinkTypes.name, drinks: count(drinkLogs.id) })
    .from(drinkLogs)
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .where(myLogsThisMonth)
    .groupBy(drinkTypes.id)
    // Name breaks a tie, so the answer is stable rather than whatever SQLite
    // happened to return first.
    .orderBy(desc(count(drinkLogs.id)), asc(drinkTypes.name))
    .limit(1)

  const [hourRow] = await db
    .select({ hour: drinkLogs.localHour, drinks: count(drinkLogs.id) })
    .from(drinkLogs)
    .where(myLogsThisMonth)
    .groupBy(drinkLogs.localHour)
    .orderBy(desc(count(drinkLogs.id)), asc(drinkLogs.localHour))
    .limit(1)

  const badges = await getBadgesFor(db, userId)
  const monthStart = new Date(`${from}T00:00:00.000Z`)
  const monthEnd = new Date(`${to}T23:59:59.999Z`)

  return {
    month,
    totalMg,
    drinkCount: coffeeCount + energyCount + otherCount,
    coffeeCount,
    energyCount,
    activeDays: active.length,
    longestStreak: longestRun(active.map((day) => day.localDate)),
    rank,
    memberCount: sorted.length,
    biggestDay: { localDate: biggest.localDate, mg: biggest.totalMg },
    favourite: favouriteRow ? { name: favouriteRow.name, count: favouriteRow.drinks } : null,
    peakHour: hourRow?.hour ?? null,
    badgeIds: badges
      .filter((badge) => badge.earnedAt >= monthStart && badge.earnedAt <= monthEnd)
      .map((badge) => badge.badgeId),
    teamMg: perMember.reduce((sum, row) => sum + row.totalMg, 0),
  }
}

/**
 * Record that this member has seen a month's wrapped.
 *
 * Never moves backwards. The page can be used to read an older month, and doing
 * so must not re-arm the dialog for one already dismissed.
 */
export async function markWrappedSeen(
  db: AnyDb,
  userId: string,
  month: MonthKey,
): Promise<void> {
  await db
    .update(members)
    .set({ lastSeenWrapped: month })
    .where(
      and(
        eq(members.userId, userId),
        sql`(${members.lastSeenWrapped} IS NULL OR ${members.lastSeenWrapped} < ${month})`,
      ),
    )
}
