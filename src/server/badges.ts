import { asc, countDistinct, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, drinkTypes, earnedBadges } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import { BADGES, earnedBadgeIds, type BadgeContext, type BadgeId } from '@/lib/badges'
import type { LocalDate } from '@/lib/time'

type AnyDb = Db | TestDb

/**
 * A database handle or an open transaction.
 *
 * A Drizzle transaction is not assignable to `AnyDb` — it has no `batch` — and
 * these functions are called both ways: `logDrink` awards inside its own
 * transaction, while the dashboard reads outside one. Derived the same way
 * `drinks.ts` derives `RollupTx`, so the two cannot drift apart.
 */
type BadgeDb = AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0]

export type EarnedBadge = { badgeId: BadgeId; earnedAt: Date }

/** The badges this member already holds. */
export async function getEarnedBadgeIds(db: BadgeDb, userId: string): Promise<BadgeId[]> {
  const rows = await db
    .select({ badgeId: earnedBadges.badgeId })
    .from(earnedBadges)
    .where(eq(earnedBadges.userId, userId))

  return rows.map((row) => row.badgeId)
}

/**
 * Assemble what the predicates read.
 *
 * `days` comes from `daily_totals` — one row per day rather than one per drink
 * — so this costs the same for someone on their thousandth coffee as on their
 * first. The distinct-type count is the one figure that has to touch
 * `drink_logs`, and it is loaded only when a badge that reads it is still
 * unearned.
 */
export async function buildContext(
  db: BadgeDb,
  userId: string,
  {
    today,
    localHour,
    needDistinctTypes,
  }: { today: LocalDate; localHour: number | null; needDistinctTypes: boolean },
): Promise<BadgeContext> {
  const days = await db
    .select({
      localDate: dailyTotals.localDate,
      coffee: dailyTotals.coffeeCount,
      energy: dailyTotals.energyCount,
      other: dailyTotals.otherCount,
    })
    .from(dailyTotals)
    .where(eq(dailyTotals.userId, userId))

  let distinctTypeCount: number | null = null
  if (needDistinctTypes) {
    const [row] = await db
      .select({ types: countDistinct(drinkLogs.drinkTypeId) })
      .from(drinkLogs)
      .where(eq(drinkLogs.userId, userId))
    distinctTypeCount = row?.types ?? 0
  }

  return {
    localHour,
    today,
    distinctTypeCount,
    days: days.map((day) => ({
      localDate: day.localDate,
      count: day.coffee + day.energy + day.other,
    })),
  }
}

/**
 * Give a member a badge they do not already have.
 *
 * Returns whether it was new. `onConflictDoNothing` rather than an upsert: a
 * badge is earned once, and re-awarding it must not move `earned_at` to today.
 */
export async function grantBadge(
  db: BadgeDb,
  { userId, badgeId, now }: { userId: string; badgeId: BadgeId; now: Date },
): Promise<boolean> {
  const inserted = await db
    .insert(earnedBadges)
    .values({ userId, badgeId, earnedAt: now })
    .onConflictDoNothing()
    .returning({ badgeId: earnedBadges.badgeId })

  return inserted.length > 0
}

/**
 * Evaluate and award, for the member who just logged a drink.
 *
 * Only unearned badges are evaluated, which is what lets the distinct-type
 * query be skipped for anyone who already has `connoisseur` — and once every
 * badge is theirs, the whole thing stops after a single indexed lookup.
 *
 * Called inside `logDrink`'s transaction, so a badge and the drink that earned
 * it commit together or not at all.
 */
export async function awardBadges(
  db: BadgeDb,
  {
    userId,
    localHour,
    today,
    now,
  }: { userId: string; localHour: number | null; today: LocalDate; now: Date },
): Promise<BadgeId[]> {
  const held = new Set(await getEarnedBadgeIds(db, userId))
  const candidates = BADGES.filter((badge) => !held.has(badge.id))
  if (candidates.length === 0) return []

  const context = await buildContext(db, userId, {
    today,
    localHour,
    needDistinctTypes: candidates.some((badge) => badge.needsDistinctTypes),
  })

  const newlyEarned = earnedBadgeIds(context).filter((id) => !held.has(id))
  for (const badgeId of newlyEarned) {
    await grantBadge(db, { userId, badgeId, now })
  }

  return newlyEarned
}

export async function getBadgesFor(db: BadgeDb, userId: string): Promise<EarnedBadge[]> {
  return db
    .select({ badgeId: earnedBadges.badgeId, earnedAt: earnedBadges.earnedAt })
    .from(earnedBadges)
    .where(eq(earnedBadges.userId, userId))
}

/**
 * Badges for a set of members, for the leaderboard.
 *
 * Every requested member gets an entry, empty if they have none — a caller
 * rendering a row should not have to tell "no badges" from "not asked about".
 */
export async function getBadgesForMany(
  db: BadgeDb,
  userIds: string[],
): Promise<Map<string, EarnedBadge[]>> {
  const byMember = new Map<string, EarnedBadge[]>(userIds.map((id) => [id, []]))
  if (userIds.length === 0) return byMember

  const rows = await db
    .select({
      userId: earnedBadges.userId,
      badgeId: earnedBadges.badgeId,
      earnedAt: earnedBadges.earnedAt,
    })
    .from(earnedBadges)
    .where(inArray(earnedBadges.userId, userIds))

  for (const row of rows) {
    byMember.get(row.userId)?.push({ badgeId: row.badgeId, earnedAt: row.earnedAt })
  }

  return byMember
}

/* -------------------------------------------------------------------------- */
/* The rebuild                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What every member's badges *should* be, by replaying the logs in write order.
 *
 * A fold rather than a set of queries: predicates read accumulated state — how
 * many days in a row, how many drinks in a day — and replaying in `created_at`
 * order is the only thing that reproduces the order they were actually earned
 * in. `earned_at` therefore comes out identical to what awarding produced,
 * which is what makes the drift check meaningful.
 *
 * Shared by {@link rebuildBadges} and {@link findBadgeDrift} so the two can
 * never disagree about what "correct" means — the arrangement `db/rollup.ts`
 * uses for the same reason.
 */
async function computeBadges(db: BadgeDb): Promise<Map<string, Map<BadgeId, Date>>> {
  const logs = await db
    .select({
      userId: drinkLogs.userId,
      drinkTypeId: drinkLogs.drinkTypeId,
      localDate: drinkLogs.localDate,
      localHour: drinkLogs.localHour,
      createdAt: drinkLogs.createdAt,
      createdBy: drinkTypes.createdBy,
    })
    .from(drinkLogs)
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .orderBy(asc(drinkLogs.createdAt), asc(drinkLogs.id))

  const earned = new Map<string, Map<BadgeId, Date>>()
  const dayCounts = new Map<string, Map<string, number>>()
  const typeIds = new Map<string, Set<number>>()

  const badgesOf = (userId: string) => {
    const existing = earned.get(userId)
    if (existing) return existing
    const fresh = new Map<BadgeId, Date>()
    earned.set(userId, fresh)
    return fresh
  }

  for (const log of logs) {
    const days = dayCounts.get(log.userId) ?? new Map<string, number>()
    days.set(log.localDate, (days.get(log.localDate) ?? 0) + 1)
    dayCounts.set(log.userId, days)

    const types = typeIds.get(log.userId) ?? new Set<number>()
    types.add(log.drinkTypeId)
    typeIds.set(log.userId, types)

    const held = badgesOf(log.userId)
    const context: BadgeContext = {
      localHour: log.localHour,
      today: log.localDate,
      distinctTypeCount: types.size,
      days: [...days].map(([localDate, count]) => ({ localDate, count })),
    }

    for (const badgeId of earnedBadgeIds(context)) {
      if (!held.has(badgeId)) held.set(badgeId, log.createdAt)
    }

    if (log.createdBy && log.createdBy !== log.userId) {
      const authorBadges = badgesOf(log.createdBy)
      if (!authorBadges.has('pioneer')) authorBadges.set('pioneer', log.createdAt)
    }
  }

  return earned
}

/**
 * Rebuild `earned_badges` from `drink_logs`.
 *
 * The escape hatch that makes "derived data" a true claim rather than a hope.
 * Safe to run at any time.
 */
export async function rebuildBadges(db: BadgeDb): Promise<number> {
  const computed = await computeBadges(db)

  const rows = [...computed].flatMap(([userId, badges]) =>
    [...badges].map(([badgeId, earnedAt]) => ({ userId, badgeId, earnedAt })),
  )

  await db.delete(earnedBadges)
  if (rows.length > 0) await db.insert(earnedBadges).values(rows)

  return rows.length
}

/**
 * Recompute one or more members' badges from scratch.
 *
 * Called when a drink is deleted. Without it, undoing the six o'clock coffee
 * that just earned `dawn-patrol` would leave the badge behind, and the drift
 * check would report it for ever after — which would make the check useless
 * exactly where it is meant to be useful.
 *
 * The read is a full replay, because badges are order-dependent and one
 * member's `pioneer` is earned by another member's log. The write touches only
 * the members named. Deletion is rare — a mistap inside ten minutes, or fixing
 * yesterday — so paying a full read for an exact answer is the right trade.
 */
export async function recomputeBadgesFor(db: BadgeDb, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return

  const computed = await computeBadges(db)

  await db.delete(earnedBadges).where(inArray(earnedBadges.userId, userIds))

  const rows = userIds.flatMap((userId) =>
    [...(computed.get(userId) ?? new Map<BadgeId, Date>())].map(([badgeId, earnedAt]) => ({
      userId,
      badgeId,
      earnedAt,
    })),
  )

  if (rows.length > 0) await db.insert(earnedBadges).values(rows)
}

export type BadgeDrift = { userId: string; badgeId: BadgeId; stored: boolean }

/**
 * Badges the table and the logs disagree about.
 *
 * `stored: true` means the table holds one the logs do not justify; `false`
 * means the logs earned one the table is missing. An empty result is the
 * invariant the whole design rests on, so it is asserted in tests and reported
 * by the CLI rather than merely assumed.
 *
 * Compares which badges exist, not when they were earned: a timestamp adrift by
 * a millisecond is not a correctness problem, and reporting it would bury the
 * ones that are.
 */
export async function findBadgeDrift(db: BadgeDb): Promise<BadgeDrift[]> {
  const computed = await computeBadges(db)
  const stored = await db
    .select({ userId: earnedBadges.userId, badgeId: earnedBadges.badgeId })
    .from(earnedBadges)

  const drift: BadgeDrift[] = []
  const storedKeys = new Set(stored.map((row) => `${row.userId} ${row.badgeId}`))

  for (const row of stored) {
    if (!computed.get(row.userId)?.has(row.badgeId)) {
      drift.push({ userId: row.userId, badgeId: row.badgeId, stored: true })
    }
  }

  for (const [userId, badges] of computed) {
    for (const badgeId of badges.keys()) {
      if (!storedKeys.has(`${userId} ${badgeId}`)) {
        drift.push({ userId, badgeId, stored: false })
      }
    }
  }

  return drift
}
