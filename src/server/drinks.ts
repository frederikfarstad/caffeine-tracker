import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, drinkTypes } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import type { DrinkCategory } from '@/lib/caffeine'
import { instantFromLocalTime, localBuckets, localDateOf } from '@/lib/time'

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

export type LogDrinkResult =
  | { ok: true; logId: number; caffeineMg: number; localDate: string }
  | { ok: false; reason: 'unknown-drink' }

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
 */
export async function logDrink(
  db: AnyDb,
  {
    userId,
    slug,
    now = new Date(),
    consumedAt = now,
  }: { userId: string; slug: string; now?: Date; consumedAt?: Date },
): Promise<LogDrinkResult> {
  const [type] = await db
    .select()
    .from(drinkTypes)
    .where(and(eq(drinkTypes.slug, slug), eq(drinkTypes.isActive, true)))

  if (!type) return { ok: false, reason: 'unknown-drink' }

  const { localDate, localHour } = localBuckets(consumedAt)
  const delta = categoryDelta(type.category)

  const logId = await db.transaction(async (tx) => {
    const [log] = await tx
      .insert(drinkLogs)
      .values({
        userId,
        drinkTypeId: type.id,
        // Snapshot, not a join: editing the drink type later must not rewrite
        // what this day already cost.
        caffeineMg: type.caffeineMg,
        category: type.category,
        consumedAt,
        createdAt: now,
        localDate,
        localHour,
      })
      .returning({ id: drinkLogs.id })

    await tx
      .insert(dailyTotals)
      .values({
        userId,
        localDate,
        totalMg: type.caffeineMg,
        coffeeMg: delta.coffee * type.caffeineMg,
        energyMg: delta.energy * type.caffeineMg,
        otherMg: delta.other * type.caffeineMg,
        coffeeCount: delta.coffee,
        energyCount: delta.energy,
        otherCount: delta.other,
      })
      .onConflictDoUpdate({
        target: [dailyTotals.userId, dailyTotals.localDate],
        set: {
          totalMg: sql`${dailyTotals.totalMg} + ${type.caffeineMg}`,
          coffeeMg: sql`${dailyTotals.coffeeMg} + ${delta.coffee * type.caffeineMg}`,
          energyMg: sql`${dailyTotals.energyMg} + ${delta.energy * type.caffeineMg}`,
          otherMg: sql`${dailyTotals.otherMg} + ${delta.other * type.caffeineMg}`,
          coffeeCount: sql`${dailyTotals.coffeeCount} + ${delta.coffee}`,
          energyCount: sql`${dailyTotals.energyCount} + ${delta.energy}`,
          otherCount: sql`${dailyTotals.otherCount} + ${delta.other}`,
        },
      })

    return log.id
  })

  return { ok: true, logId, caffeineMg: type.caffeineMg, localDate }
}

export type UndoResult =
  | { ok: true; caffeineMg: number }
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

  const delta = categoryDelta(last.category)

  await db.transaction(async (tx) => {
    await tx.delete(drinkLogs).where(eq(drinkLogs.id, last.id))

    await tx
      .update(dailyTotals)
      .set({
        totalMg: sql`${dailyTotals.totalMg} - ${last.caffeineMg}`,
        coffeeMg: sql`${dailyTotals.coffeeMg} - ${delta.coffee * last.caffeineMg}`,
        energyMg: sql`${dailyTotals.energyMg} - ${delta.energy * last.caffeineMg}`,
        otherMg: sql`${dailyTotals.otherMg} - ${delta.other * last.caffeineMg}`,
        coffeeCount: sql`${dailyTotals.coffeeCount} - ${delta.coffee}`,
        energyCount: sql`${dailyTotals.energyCount} - ${delta.energy}`,
        otherCount: sql`${dailyTotals.otherCount} - ${delta.other}`,
      })
      .where(
        and(eq(dailyTotals.userId, userId), eq(dailyTotals.localDate, last.localDate)),
      )

    // An all-zero row would read as drift against a fresh rebuild, so the day
    // disappears when its last drink does.
    await tx
      .delete(dailyTotals)
      .where(
        and(
          eq(dailyTotals.userId, userId),
          eq(dailyTotals.localDate, last.localDate),
          eq(dailyTotals.coffeeCount, 0),
          eq(dailyTotals.energyCount, 0),
          eq(dailyTotals.otherCount, 0),
        ),
      )
  })

  return { ok: true, caffeineMg: last.caffeineMg }
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
