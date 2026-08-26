import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, drinkTypes } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import type { DrinkCategory } from '@/lib/caffeine'
import { localBuckets } from '@/lib/time'

type AnyDb = Db | TestDb

/** How long after logging a drink it can still be taken back. */
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

export type LogDrinkResult =
  | { ok: true; logId: number; caffeineMg: number; localDate: string }
  | { ok: false; reason: 'unknown-drink' }

/**
 * Record one drink.
 *
 * Two things happen in a single transaction: the log row is written, and the
 * per-day rollup is incremented. They must not drift apart, so they must not
 * be able to half-succeed.
 */
export async function logDrink(
  db: AnyDb,
  { userId, slug, now = new Date() }: { userId: string; slug: string; now?: Date },
): Promise<LogDrinkResult> {
  const [type] = await db
    .select()
    .from(drinkTypes)
    .where(and(eq(drinkTypes.slug, slug), eq(drinkTypes.isActive, true)))

  if (!type) return { ok: false, reason: 'unknown-drink' }

  const { localDate, localHour } = localBuckets(now)
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
        consumedAt: now,
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
 * Take back your most recent drink, within {@link UNDO_WINDOW_MS}.
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
    .orderBy(desc(drinkLogs.consumedAt), desc(drinkLogs.id))
    .limit(1)

  if (!last) return { ok: false, reason: 'nothing-to-undo' }
  if (now.getTime() - last.consumedAt.getTime() > UNDO_WINDOW_MS) {
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
      consumedAt: drinkLogs.consumedAt,
      name: drinkTypes.name,
    })
    .from(drinkLogs)
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .where(eq(drinkLogs.userId, userId))
    .orderBy(desc(drinkLogs.consumedAt), desc(drinkLogs.id))
    .limit(1)

  if (!last) return null

  const expiresAt = new Date(last.consumedAt.getTime() + UNDO_WINDOW_MS)
  if (expiresAt.getTime() <= now.getTime()) return null

  return { caffeineMg: last.caffeineMg, name: last.name, expiresAt }
}
