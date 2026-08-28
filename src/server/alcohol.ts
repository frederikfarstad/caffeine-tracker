import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@/db'
import { alcoholDrinkTypes, alcoholLogs, members, users } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import { gramsOfAlcohol, type AlcoholCategory } from '@/lib/alcohol'
import {
  addLocalDays,
  instantFromLocalTime,
  localBuckets,
  localDateOf,
  periodToDateRange,
  type PartyPeriod,
} from '@/lib/time'

type AnyDb = Db | TestDb

/**
 * How long after writing an alcohol log it can still be taken back.
 *
 * The same ten minutes as caffeine. Its own constant rather than an import,
 * because the two are equal by coincidence rather than by rule: the argument
 * for the length is about mistaps, and nothing says a Friday and a Tuesday have
 * to agree forever.
 */
export const ALCOHOL_UNDO_WINDOW_MS = 10 * 60 * 1000

export type ActiveAlcoholType = {
  id: number
  slug: string
  name: string
  category: AlcoholCategory
  volumeMl: number
  abvPercent: number
  /** What one of these works out to, so the button can show it. */
  alcoholGrams: number
}

/**
 * The catalogue, with grams already computed.
 *
 * Derived here rather than in the component so the number on the button and the
 * number written to the log come from one call to `gramsOfAlcohol`. Two copies
 * of that arithmetic is how they start disagreeing.
 */
export async function listActiveAlcoholTypes(db: AnyDb): Promise<ActiveAlcoholType[]> {
  const rows = await db
    .select({
      id: alcoholDrinkTypes.id,
      slug: alcoholDrinkTypes.slug,
      name: alcoholDrinkTypes.name,
      category: alcoholDrinkTypes.category,
      volumeMl: alcoholDrinkTypes.volumeMl,
      abvPercent: alcoholDrinkTypes.abvPercent,
    })
    .from(alcoholDrinkTypes)
    .where(eq(alcoholDrinkTypes.isActive, true))
    .orderBy(asc(alcoholDrinkTypes.sortOrder), asc(alcoholDrinkTypes.id))

  return rows.map((row) => ({ ...row, alcoholGrams: gramsOfAlcohol(row) }))
}

export type LogAlcoholResult =
  | { ok: true; logId: number; alcoholGrams: number; localDate: string }
  | { ok: false; reason: 'unknown-drink' }

/**
 * Record one alcoholic drink.
 *
 * No transaction, unlike `logDrink`: there is no rollup to keep in step, so
 * this is a single insert and there is nothing to half-succeed.
 *
 * `consumedAt` is when it was drunk and `now` is when it was logged. Every
 * calendar consequence follows the drink; only the undo window follows the
 * write.
 */
export async function logAlcoholDrink(
  db: AnyDb,
  {
    userId,
    slug,
    now = new Date(),
    consumedAt = now,
  }: { userId: string; slug: string; now?: Date; consumedAt?: Date },
): Promise<LogAlcoholResult> {
  const [type] = await db
    .select()
    .from(alcoholDrinkTypes)
    .where(and(eq(alcoholDrinkTypes.slug, slug), eq(alcoholDrinkTypes.isActive, true)))

  if (!type) return { ok: false, reason: 'unknown-drink' }

  const alcoholGrams = gramsOfAlcohol(type)
  const { localDate, localHour } = localBuckets(consumedAt)

  const [log] = await db
    .insert(alcoholLogs)
    .values({
      userId,
      drinkTypeId: type.id,
      // Snapshot, not a join: retuning an ABV later must not rewrite what last
      // Friday cost.
      alcoholGrams,
      category: type.category,
      volumeMl: type.volumeMl,
      consumedAt,
      createdAt: now,
      localDate,
      localHour,
    })
    .returning({ id: alcoholLogs.id })

  return { ok: true, logId: log.id, alcoholGrams, localDate }
}

export type UndoAlcoholResult =
  | { ok: true; alcoholGrams: number }
  | { ok: false; reason: 'nothing-to-undo' | 'too-old' }

/**
 * Take back the drink you most recently logged.
 *
 * Ordered and timed by `createdAt`, so a drink backdated to earlier in the
 * evening is still the last thing you did. Scoped to the caller's own rows.
 */
export async function undoLastAlcoholDrink(
  db: AnyDb,
  { userId, now = new Date() }: { userId: string; now?: Date },
): Promise<UndoAlcoholResult> {
  const [last] = await db
    .select()
    .from(alcoholLogs)
    .where(eq(alcoholLogs.userId, userId))
    .orderBy(desc(alcoholLogs.createdAt), desc(alcoholLogs.id))
    .limit(1)

  if (!last) return { ok: false, reason: 'nothing-to-undo' }
  if (now.getTime() - last.createdAt.getTime() > ALCOHOL_UNDO_WINDOW_MS) {
    return { ok: false, reason: 'too-old' }
  }

  await db.delete(alcoholLogs).where(eq(alcoholLogs.id, last.id))

  return { ok: true, alcoholGrams: last.alcoholGrams }
}

export type UndoableAlcoholDrink = {
  alcoholGrams: number
  name: string
  /** When the undo affordance stops being offered. */
  expiresAt: Date
}

export async function getUndoableAlcoholDrink(
  db: AnyDb,
  { userId, now = new Date() }: { userId: string; now?: Date },
): Promise<UndoableAlcoholDrink | null> {
  const [last] = await db
    .select({
      alcoholGrams: alcoholLogs.alcoholGrams,
      createdAt: alcoholLogs.createdAt,
      name: alcoholDrinkTypes.name,
    })
    .from(alcoholLogs)
    .innerJoin(alcoholDrinkTypes, eq(alcoholDrinkTypes.id, alcoholLogs.drinkTypeId))
    .where(eq(alcoholLogs.userId, userId))
    .orderBy(desc(alcoholLogs.createdAt), desc(alcoholLogs.id))
    .limit(1)

  if (!last) return null

  const expiresAt = new Date(last.createdAt.getTime() + ALCOHOL_UNDO_WINDOW_MS)
  if (expiresAt.getTime() <= now.getTime()) return null

  return { alcoholGrams: last.alcoholGrams, name: last.name, expiresAt }
}

export type UpdateAlcoholLogResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'malformed-time' | 'future-time' }

/** `HH:MM` on a 24-hour clock, which is what `input[type=time]` submits. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Move one of your own drinks to a different time.
 *
 * Takes `HH:MM` rather than an instant, and resolves it **against the drink's
 * own local date** rather than today's. That is the whole reason this does not
 * reuse `resolveConsumedAt` from `drinks.ts`, which anchors to today because
 * the caffeine list it serves only ever shows today.
 *
 * The alcohol list deliberately spans two dates, because an evening does. At
 * 00:30 it still shows last night's drinks, and anchoring their edits to today
 * would refuse "22:30" as a time that has not happened yet — for a drink that
 * demonstrably has. Anchoring to the row keeps a drink on the evening it
 * belongs to, which is also the least surprising answer.
 *
 * Only the time is editable. There is no volume picker for alcohol, so there is
 * no volume to correct, and changing which drink it was is a delete and a
 * re-log — the same argument `RecentDrinks` makes for caffeine.
 *
 * Scoped by `userId` as well as `logId`, because the id comes from the client
 * and scope is the only thing stopping it naming somebody else's row.
 */
export async function updateAlcoholLog(
  db: AnyDb,
  {
    userId,
    logId,
    time,
    now = new Date(),
  }: { userId: string; logId: number; time: string; now?: Date },
): Promise<UpdateAlcoholLogResult> {
  if (!TIME_PATTERN.test(time)) return { ok: false, reason: 'malformed-time' }

  const [log] = await db
    .select({ localDate: alcoholLogs.localDate })
    .from(alcoholLogs)
    .where(and(eq(alcoholLogs.id, logId), eq(alcoholLogs.userId, userId)))

  if (!log) return { ok: false, reason: 'not-found' }

  const consumedAt = instantFromLocalTime(log.localDate, time)
  // Compared to the minute, since the picker has no seconds: choosing the
  // current minute must not be a future time just because 40 seconds have run.
  if (consumedAt.getTime() - now.getTime() > 60_000) {
    return { ok: false, reason: 'future-time' }
  }

  // `localDate` cannot change — the time is resolved against it — but the hour
  // can, so it is recomputed rather than assumed.
  const { localHour } = localBuckets(consumedAt)

  await db
    .update(alcoholLogs)
    .set({ consumedAt, localHour })
    .where(and(eq(alcoholLogs.id, logId), eq(alcoholLogs.userId, userId)))

  return { ok: true }
}

export type DeleteAlcoholLogResult = { ok: true } | { ok: false; reason: 'not-found' }

/**
 * Delete one of your own drinks, however old.
 *
 * A hard delete, consistent with undo and with the caffeine side: a
 * `deleted_at` column would add a filter to every query here in order to
 * support a rare action.
 */
export async function deleteAlcoholLog(
  db: AnyDb,
  { userId, logId }: { userId: string; logId: number },
): Promise<DeleteAlcoholLogResult> {
  const deleted = await db
    .delete(alcoholLogs)
    .where(and(eq(alcoholLogs.id, logId), eq(alcoholLogs.userId, userId)))
    .returning({ id: alcoholLogs.id })

  if (deleted.length === 0) return { ok: false, reason: 'not-found' }

  return { ok: true }
}

export type AlcoholEvent = { consumedAt: Date; alcoholGrams: number }

/**
 * The doses the curve is drawn from.
 *
 * Bounded by `local_date` on the `(user_id, local_date)` index rather than by
 * `consumed_at`, which would scan every drink the member has ever logged — the
 * same reason `getUserRecentDrinks` does it. The range spans two local dates
 * because an evening does, and the drinks from before midnight are exactly the
 * ones still in the bloodstream after it.
 */
export async function getUserAlcoholEvents(
  db: AnyDb,
  userId: string,
  { from, now }: { from: Date; now: Date },
): Promise<AlcoholEvent[]> {
  return db
    .select({
      consumedAt: alcoholLogs.consumedAt,
      alcoholGrams: alcoholLogs.alcoholGrams,
    })
    .from(alcoholLogs)
    .where(
      and(
        eq(alcoholLogs.userId, userId),
        gte(alcoholLogs.localDate, localDateOf(from)),
        lte(alcoholLogs.localDate, localDateOf(now)),
        gte(alcoholLogs.consumedAt, from),
      ),
    )
    .orderBy(asc(alcoholLogs.consumedAt), asc(alcoholLogs.id))
}

export type AlcoholToday = { totalGrams: number; drinkCount: number }

/** This member's local-day total, for the readout above the buttons. */
export async function getUserAlcoholToday(
  db: AnyDb,
  userId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<AlcoholToday> {
  const [row] = await db
    .select({
      totalGrams: sql<number>`coalesce(sum(${alcoholLogs.alcoholGrams}), 0)`,
      drinkCount: sql<number>`count(*)`,
    })
    .from(alcoholLogs)
    .where(and(eq(alcoholLogs.userId, userId), eq(alcoholLogs.localDate, localDateOf(now))))

  return { totalGrams: row?.totalGrams ?? 0, drinkCount: row?.drinkCount ?? 0 }
}

export type RecentAlcoholDrink = {
  id: number
  name: string
  category: AlcoholCategory
  alcoholGrams: number
  volumeMl: number
  consumedAt: Date
}

/**
 * This member's drinks from tonight and yesterday, newest first.
 *
 * Two dates rather than one, for the same midnight reason as
 * {@link getUserAlcoholEvents}: at 00:30 a list bounded to today would be empty
 * while the gauge still read 0.8.
 */
export async function getUserRecentAlcohol(
  db: AnyDb,
  userId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<RecentAlcoholDrink[]> {
  const since = addLocalDays(localDateOf(now), -1)

  return db
    .select({
      id: alcoholLogs.id,
      name: alcoholDrinkTypes.name,
      category: alcoholLogs.category,
      alcoholGrams: alcoholLogs.alcoholGrams,
      volumeMl: alcoholLogs.volumeMl,
      consumedAt: alcoholLogs.consumedAt,
    })
    .from(alcoholLogs)
    .innerJoin(alcoholDrinkTypes, eq(alcoholDrinkTypes.id, alcoholLogs.drinkTypeId))
    .where(and(eq(alcoholLogs.userId, userId), gte(alcoholLogs.localDate, since)))
    .orderBy(desc(alcoholLogs.consumedAt), desc(alcoholLogs.id))
}

export type AlcoholLeaderboardRow = {
  userId: string
  displayName: string
  image: string | null
  totalGrams: number
  drinkCount: number
  rank: number
}

/**
 * Ties share a rank, so two people on the same total are both second.
 *
 * A copy of the helper in `stats.ts` rather than a shared import: that one is
 * keyed on `totalMg` and this one on `totalGrams`, and generalising it over the
 * field name would cost more clarity than the six lines are worth.
 */
function assignRanks<T extends { totalGrams: number }>(sorted: T[]): (T & { rank: number })[] {
  let lastTotal: number | null = null
  let lastRank = 0

  return sorted.map((row, index) => {
    if (row.totalGrams !== lastTotal) {
      lastRank = index + 1
      lastTotal = row.totalGrams
    }
    return { ...row, rank: lastRank }
  })
}

/**
 * The team ranked by alcohol, for a period that cannot be "all time".
 *
 * {@link PartyPeriod} excludes it at the type level, and that is the point:
 * there is no `daily_totals` equivalent for alcohol, so an open-ended range
 * would scan every row ever written and get linearly worse forever. Day, week
 * and month are bounded by `local_date` — a few hundred rows across the team —
 * and use `alcohol_logs_date_idx`, which exists for this query.
 *
 * The whole roster is returned, including members who have drunk nothing, so
 * the table is the team rather than only tonight's participants.
 */
export async function getAlcoholLeaderboard(
  db: AnyDb,
  period: PartyPeriod,
  now = new Date(),
): Promise<AlcoholLeaderboardRow[]> {
  const range = periodToDateRange(period, now)
  // `from` is only null for the 'all' period, which `PartyPeriod` forbids.
  const from = range.from ?? range.to

  const [roster, totals] = await Promise.all([
    db
      .select({
        userId: members.userId,
        displayName: members.displayName,
        image: users.image,
      })
      .from(members)
      .leftJoin(users, eq(users.id, members.userId)),
    db
      .select({
        userId: alcoholLogs.userId,
        totalGrams: sql<number>`sum(${alcoholLogs.alcoholGrams})`,
        drinkCount: sql<number>`count(*)`,
      })
      .from(alcoholLogs)
      .where(and(gte(alcoholLogs.localDate, from), lte(alcoholLogs.localDate, range.to)))
      .groupBy(alcoholLogs.userId),
  ])

  const byUser = new Map(totals.map((row) => [row.userId, row]))

  const rows = roster.map((person) => {
    const mine = byUser.get(person.userId)
    return {
      userId: person.userId,
      displayName: person.displayName,
      image: person.image ?? null,
      totalGrams: mine?.totalGrams ?? 0,
      drinkCount: mine?.drinkCount ?? 0,
    }
  })

  rows.sort((a, b) => b.totalGrams - a.totalGrams || a.displayName.localeCompare(b.displayName))
  return assignRanks(rows)
}
