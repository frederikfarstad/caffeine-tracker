import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, drinkTypes } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import type { DrinkCategory } from '@/lib/caffeine'
import { scaleForVolume } from '@/lib/serving'
import { addLocalDays, instantFromLocalTime, localBuckets, localDateOf } from '@/lib/time'
import { awardBadges, grantBadge } from './badges'

type AnyDb = Db | TestDb

/** How long after *writing* a drink log it can still be taken back. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000

export type ActiveDrinkType = {
  id: number
  slug: string
  name: string
  category: DrinkCategory
  volumeMl: number | null
  caffeineMg: number
}

export async function listActiveDrinkTypes(db: AnyDb): Promise<ActiveDrinkType[]> {
  return db
    .select({
      id: drinkTypes.id,
      slug: drinkTypes.slug,
      name: drinkTypes.name,
      category: drinkTypes.category,
      volumeMl: drinkTypes.volumeMl,
      caffeineMg: drinkTypes.caffeineMg,
    })
    .from(drinkTypes)
    .where(eq(drinkTypes.isActive, true))
    .orderBy(asc(drinkTypes.sortOrder), asc(drinkTypes.id))
}

/** `HH:MM` on a 24-hour clock, which is what `input[type=time]` submits. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export type ResolvedConsumedAt =
  | { ok: true; consumedAt: Date }
  | { ok: false; reason: 'malformed-time' | 'future-time' }

/**
 * Turn the optional time from the log form into the instant to record.
 *
 * Anchored to today's Oslo date, so the picker only ever reaches back into the
 * current day — the case it exists for ("I forgot to log this morning's
 * coffee"). Backdating further would need a date as well as a time, and a
 * second field for a rarer case is not worth the surface.
 *
 * Future times are refused rather than clamped: silently moving someone's 23:00
 * to 10:00 would be a worse answer than saying no.
 */
export function resolveConsumedAt({
  time,
  now = new Date(),
}: {
  time: string | undefined
  now?: Date
}): ResolvedConsumedAt {
  if (!time) return { ok: true, consumedAt: now }
  if (!TIME_PATTERN.test(time)) return { ok: false, reason: 'malformed-time' }

  const consumedAt = instantFromLocalTime(localDateOf(now), time)
  // Compared to the minute, since the picker has no seconds: choosing the
  // current minute must not be a future time just because 40 seconds have run.
  if (consumedAt.getTime() - now.getTime() > 60_000) {
    return { ok: false, reason: 'future-time' }
  }

  return { ok: true, consumedAt }
}


/* -------------------------------------------------------------------------- */
/* Rollup maintenance                                                        */
/*                                                                           */
/* Four operations now move milligrams in and out of `daily_totals`, and the  */
/* arithmetic has to agree across all of them or the leaderboards drift from  */
/* the logs. It lives here once.                                             */
/* -------------------------------------------------------------------------- */

type RollupTx = Parameters<Parameters<AnyDb['transaction']>[0]>[0]

type RollupEntry = { userId: string; localDate: string; category: DrinkCategory; mg: number }

/** Credit a day with a drink. Creates the row if this is the day's first. */
async function addToRollup(tx: RollupTx, { userId, localDate, category, mg }: RollupEntry) {
  const delta = categoryDelta(category)

  await tx
    .insert(dailyTotals)
    .values({
      userId,
      localDate,
      totalMg: mg,
      coffeeMg: delta.coffee * mg,
      energyMg: delta.energy * mg,
      otherMg: delta.other * mg,
      coffeeCount: delta.coffee,
      energyCount: delta.energy,
      otherCount: delta.other,
    })
    .onConflictDoUpdate({
      target: [dailyTotals.userId, dailyTotals.localDate],
      set: {
        totalMg: sql`${dailyTotals.totalMg} + ${mg}`,
        coffeeMg: sql`${dailyTotals.coffeeMg} + ${delta.coffee * mg}`,
        energyMg: sql`${dailyTotals.energyMg} + ${delta.energy * mg}`,
        otherMg: sql`${dailyTotals.otherMg} + ${delta.other * mg}`,
        coffeeCount: sql`${dailyTotals.coffeeCount} + ${delta.coffee}`,
        energyCount: sql`${dailyTotals.energyCount} + ${delta.energy}`,
        otherCount: sql`${dailyTotals.otherCount} + ${delta.other}`,
      },
    })
}

/** Take a drink back out of a day. The row is assumed to exist. */
async function subtractFromRollup(
  tx: RollupTx,
  { userId, localDate, category, mg }: RollupEntry,
) {
  const delta = categoryDelta(category)

  await tx
    .update(dailyTotals)
    .set({
      totalMg: sql`${dailyTotals.totalMg} - ${mg}`,
      coffeeMg: sql`${dailyTotals.coffeeMg} - ${delta.coffee * mg}`,
      energyMg: sql`${dailyTotals.energyMg} - ${delta.energy * mg}`,
      otherMg: sql`${dailyTotals.otherMg} - ${delta.other * mg}`,
      coffeeCount: sql`${dailyTotals.coffeeCount} - ${delta.coffee}`,
      energyCount: sql`${dailyTotals.energyCount} - ${delta.energy}`,
      otherCount: sql`${dailyTotals.otherCount} - ${delta.other}`,
    })
    .where(and(eq(dailyTotals.userId, userId), eq(dailyTotals.localDate, localDate)))
}

/**
 * Drop a day that has no drinks left.
 *
 * An all-zero row would read as drift against a fresh rebuild, so the day
 * disappears when its last drink does. Run after the additions rather than
 * between them, so an edit that moves a drink within one day cannot delete the
 * row it is about to write to.
 */
async function pruneEmptyRollup(tx: RollupTx, userId: string, localDates: string[]) {
  for (const localDate of new Set(localDates)) {
    await tx
      .delete(dailyTotals)
      .where(
        and(
          eq(dailyTotals.userId, userId),
          eq(dailyTotals.localDate, localDate),
          eq(dailyTotals.coffeeCount, 0),
          eq(dailyTotals.energyCount, 0),
          eq(dailyTotals.otherCount, 0),
        ),
      )
  }
}

export type LogDrinkResult =
  | { ok: true; logId: number; caffeineMg: number; localDate: string }
  | { ok: false; reason: 'unknown-drink' | 'no-base-volume' }

/**
 * Record one drink.
 *
 * Two things happen in a single transaction: the log row is written, and the
 * per-day rollup is incremented. They must not drift apart, so they must not
 * be able to half-succeed.
 *
 * `consumedAt` is when the drink was drunk and `now` is when it was logged.
 * They are the same instant for a tap on a drink button, and differ when
 * someone catches up on a coffee they had at breakfast. Every calendar
 * consequence — the local date and hour, the rollup day — follows the drink;
 * only the undo window follows the write.
 *
 * `volumeMl` records a serving that wasn't the standard one, scaling the dose
 * with it. Only meaningful for a type that has a serving size to scale from.
 */
export async function logDrink(
  db: AnyDb,
  {
    userId,
    slug,
    now = new Date(),
    consumedAt = now,
    volumeMl = null,
  }: {
    userId: string
    slug: string
    now?: Date
    consumedAt?: Date
    volumeMl?: number | null
  },
): Promise<LogDrinkResult> {
  const [type] = await db
    .select()
    .from(drinkTypes)
    .where(and(eq(drinkTypes.slug, slug), eq(drinkTypes.isActive, true)))

  if (!type) return { ok: false, reason: 'unknown-drink' }

  const caffeineMg = scaleForVolume(type, volumeMl)
  if (caffeineMg === null) return { ok: false, reason: 'no-base-volume' }

  const { localDate, localHour } = localBuckets(consumedAt)

  const logId = await db.transaction(async (tx) => {
    const [log] = await tx
      .insert(drinkLogs)
      .values({
        userId,
        drinkTypeId: type.id,
        // Snapshot, not a join: editing the drink type later must not rewrite
        // what this day already cost.
        caffeineMg,
        category: type.category,
        consumedAt,
        createdAt: now,
        volumeMl,
        localDate,
        localHour,
      })
      .returning({ id: drinkLogs.id })

    await addToRollup(tx, { userId, localDate, category: type.category, mg: caffeineMg })

    /*
     * Badges commit with the drink that earned them, or not at all. Only
     * unearned badges are evaluated, so an established member pays for one
     * indexed lookup against `earned_badges` — not a scan of everything they
     * have ever drunk.
     */
    await awardBadges(tx, { userId, localHour, today: localDate, now })

    /*
     * The one badge that goes to somebody else: whoever added this drink, when
     * a different member logs it. `created_by` is already on the row read above
     * to snapshot the caffeine figure, so this costs no extra query.
     */
    if (type.createdBy && type.createdBy !== userId) {
      await grantBadge(tx, { userId: type.createdBy, badgeId: 'pioneer', now })
    }

    return log.id
  })

  return { ok: true, logId, caffeineMg, localDate }
}

/**
 * Whose badges a deleted log could affect.
 *
 * The member who drank it, and — because `pioneer` is earned by somebody else
 * logging your drink — the author of the drink type, when that is a different
 * person.
 */
async function badgeHoldersAffectedBy(
  db: AnyDb,
  log: { userId: string; drinkTypeId: number },
): Promise<string[]> {
  const [type] = await db
    .select({ createdBy: drinkTypes.createdBy })
    .from(drinkTypes)
    .where(eq(drinkTypes.id, log.drinkTypeId))

  return type?.createdBy && type.createdBy !== log.userId
    ? [log.userId, type.createdBy]
    : [log.userId]
}

export type UndoResult =
  | { ok: true; caffeineMg: number; affectedUserIds: string[] }
  | { ok: false; reason: 'nothing-to-undo' | 'too-old' }

/**
 * Take back the drink you most recently logged, within {@link UNDO_WINDOW_MS}.
 *
 * Ordered and timed by `createdAt`, not `consumedAt`: "undo" means "take back
 * what I just did", and a drink logged for earlier in the day is still the last
 * thing you did.
 *
 * A hard delete rather than a soft one: a `deleted_at` column would add a
 * filter to every aggregate query in `stats.ts` in order to support one rare
 * action. Scoped to the caller's own rows, so there is no way to reach someone
 * else's log.
 */
export async function undoLastDrink(
  db: AnyDb,
  { userId, now = new Date() }: { userId: string; now?: Date },
): Promise<UndoResult> {
  const [last] = await db
    .select()
    .from(drinkLogs)
    .where(eq(drinkLogs.userId, userId))
    .orderBy(desc(drinkLogs.createdAt), desc(drinkLogs.id))
    .limit(1)

  if (!last) return { ok: false, reason: 'nothing-to-undo' }
  if (now.getTime() - last.createdAt.getTime() > UNDO_WINDOW_MS) {
    return { ok: false, reason: 'too-old' }
  }

  const affected = await badgeHoldersAffectedBy(db, last)

  await db.transaction(async (tx) => {
    await tx.delete(drinkLogs).where(eq(drinkLogs.id, last.id))
    await subtractFromRollup(tx, {
      userId,
      localDate: last.localDate,
      category: last.category,
      mg: last.caffeineMg,
    })
    await pruneEmptyRollup(tx, userId, [last.localDate])
  })

  // A badge the undone drink earned must go with it, or the drift check would
  // report it for ever — but the recompute is a full-team replay (`pioneer`
  // depends on other members' logs), so the caller runs it after responding
  // rather than paying for it inside this transaction.
  return { ok: true, caffeineMg: last.caffeineMg, affectedUserIds: affected }
}

function categoryDelta(category: DrinkCategory) {
  return {
    coffee: category === 'coffee' ? 1 : 0,
    energy: category === 'energy' ? 1 : 0,
    other: category === 'other' ? 1 : 0,
  }
}

export type UndoableDrink = {
  caffeineMg: number
  name: string
  /** When the undo affordance stops being offered. */
  expiresAt: Date
}

/**
 * The drink the member could still take back, if any.
 *
 * Returned to the client so the undo button can appear only when it would
 * actually work, and so the optimistic update knows how much to subtract.
 */
export async function getUndoableDrink(
  db: AnyDb,
  { userId, now = new Date() }: { userId: string; now?: Date },
): Promise<UndoableDrink | null> {
  const [last] = await db
    .select({
      caffeineMg: drinkLogs.caffeineMg,
      createdAt: drinkLogs.createdAt,
      name: drinkTypes.name,
    })
    .from(drinkLogs)
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .where(eq(drinkLogs.userId, userId))
    .orderBy(desc(drinkLogs.createdAt), desc(drinkLogs.id))
    .limit(1)

  if (!last) return null

  const expiresAt = new Date(last.createdAt.getTime() + UNDO_WINDOW_MS)
  if (expiresAt.getTime() <= now.getTime()) return null

  return { caffeineMg: last.caffeineMg, name: last.name, expiresAt }
}

export type UpdateDrinkLogResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'unknown-drink' | 'no-base-volume' }

/**
 * Change one of your own drinks: when it was, what it was, how big it was.
 *
 * The undo window covers the ten seconds after a mistap; this covers the rest.
 * Scoped by `userId` as well as `logId`, because the id comes from the client
 * and scope is the only thing stopping it naming somebody else's row.
 *
 * The interesting part is the rollup. Moving a drink's time can move it to
 * another day, so the milligrams have to leave one `daily_totals` row and land
 * on another, in one transaction — a half-applied edit would leave every
 * leaderboard wrong with nothing to point at.
 */
export async function updateDrinkLog(
  db: AnyDb,
  {
    userId,
    logId,
    slug,
    consumedAt,
    volumeMl,
  }: {
    userId: string
    logId: number
    slug?: string
    consumedAt?: Date
    /** A volume to rescale the dose to, or `undefined` to leave it be. */
    volumeMl?: number | null
  },
): Promise<UpdateDrinkLogResult> {
  const [log] = await db
    .select()
    .from(drinkLogs)
    .where(and(eq(drinkLogs.id, logId), eq(drinkLogs.userId, userId)))

  if (!log) return { ok: false, reason: 'not-found' }

  const [type] = slug
    ? await db
        .select()
        .from(drinkTypes)
        .where(and(eq(drinkTypes.slug, slug), eq(drinkTypes.isActive, true)))
    : await db.select().from(drinkTypes).where(eq(drinkTypes.id, log.drinkTypeId))

  if (!type) return { ok: false, reason: 'unknown-drink' }

  const nextVolumeMl = volumeMl === undefined ? log.volumeMl : volumeMl
  const caffeineMg = scaleForVolume(type, nextVolumeMl)
  if (caffeineMg === null) return { ok: false, reason: 'no-base-volume' }

  const nextConsumedAt = consumedAt ?? log.consumedAt
  const { localDate, localHour } = localBuckets(nextConsumedAt)

  await db.transaction(async (tx) => {
    await subtractFromRollup(tx, {
      userId,
      localDate: log.localDate,
      category: log.category,
      mg: log.caffeineMg,
    })

    await tx
      .update(drinkLogs)
      .set({
        drinkTypeId: type.id,
        caffeineMg,
        category: type.category,
        consumedAt: nextConsumedAt,
        volumeMl: nextVolumeMl,
        localDate,
        localHour,
      })
      .where(eq(drinkLogs.id, log.id))

    await addToRollup(tx, { userId, localDate, category: type.category, mg: caffeineMg })

    // Both days, and after the addition rather than between the two, so an edit
    // within a single day cannot delete the row it is about to write to.
    await pruneEmptyRollup(tx, userId, [log.localDate, localDate])
  })

  return { ok: true }
}

export type DeleteDrinkLogResult =
  | { ok: true; affectedUserIds: string[] }
  | { ok: false; reason: 'not-found' }

/**
 * Delete one of your own drinks, however old.
 *
 * A hard delete, consistent with undo: a `deleted_at` column would add a filter
 * to every aggregate in `stats.ts` to support a rare action.
 */
export async function deleteDrinkLog(
  db: AnyDb,
  { userId, logId }: { userId: string; logId: number; now?: Date },
): Promise<DeleteDrinkLogResult> {
  const [log] = await db
    .select()
    .from(drinkLogs)
    .where(and(eq(drinkLogs.id, logId), eq(drinkLogs.userId, userId)))

  if (!log) return { ok: false, reason: 'not-found' }

  const affected = await badgeHoldersAffectedBy(db, log)

  await db.transaction(async (tx) => {
    await tx.delete(drinkLogs).where(eq(drinkLogs.id, log.id))
    await subtractFromRollup(tx, {
      userId,
      localDate: log.localDate,
      category: log.category,
      mg: log.caffeineMg,
    })
    await pruneEmptyRollup(tx, userId, [log.localDate])
  })

  // A badge the deleted drink earned must go with it, or the drift check
  // would report it for ever — but the recompute is a full-team replay
  // (`pioneer` depends on other members' logs), so the caller runs it after
  // responding rather than paying for it inside this transaction.
  return { ok: true, affectedUserIds: affected }
}

export type RecentDrink = {
  id: number
  slug: string
  name: string
  category: DrinkCategory
  caffeineMg: number
  /** The volume actually drunk, or null for the standard serving. */
  volumeMl: number | null
  consumedAt: Date
}

/**
 * A member's own recent drinks, newest first, for the editable list.
 *
 * `days` counts back in local dates, so 0 means today. Bounded by `local_date`
 * on the `(user_id, local_date)` index rather than by `consumed_at`, which
 * would scan every drink the member has ever logged.
 */
export async function getUserRecentDrinks(
  db: AnyDb,
  userId: string,
  { now = new Date(), days = 0 }: { now?: Date; days?: number } = {},
): Promise<RecentDrink[]> {
  const since = addLocalDays(localDateOf(now), -days)

  return db
    .select({
      id: drinkLogs.id,
      slug: drinkTypes.slug,
      name: drinkTypes.name,
      category: drinkLogs.category,
      caffeineMg: drinkLogs.caffeineMg,
      volumeMl: drinkLogs.volumeMl,
      consumedAt: drinkLogs.consumedAt,
    })
    .from(drinkLogs)
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .where(and(eq(drinkLogs.userId, userId), gte(drinkLogs.localDate, since)))
    .orderBy(desc(drinkLogs.consumedAt), desc(drinkLogs.id))
}
