import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/db/test-db'
import { dailyTotals, drinkLogs, drinkTypes, users } from '@/db/schema'
import { findRollupDrift } from '@/db/rollup'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import {
  UNDO_WINDOW_MS,
  deleteDrinkLog,
  getUndoableDrink,
  getUserRecentDrinks,
  updateDrinkLog,
  listActiveDrinkTypes,
  logDrink,
  resolveConsumedAt,
  undoLastDrink,
} from './drinks'

let db: TestDb

/** 10:00 Oslo time on a Wednesday. */
const now = new Date('2026-08-26T08:00:00Z')

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(users).values([
    { id: 'ada', name: 'Ada', email: 'ada@example.com' },
    { id: 'linn', name: 'Linn', email: 'linn@example.com' },
  ])
  await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)
})

async function totalsFor(userId: string, localDate: string) {
  const [row] = await db
    .select()
    .from(dailyTotals)
    .where(and(eq(dailyTotals.userId, userId), eq(dailyTotals.localDate, localDate)))
  return row
}

describe('listActiveDrinkTypes', () => {
  it('returns the seeded types in display order', async () => {
    const types = await listActiveDrinkTypes(db)
    expect(types.map((t) => t.slug)).toEqual([
      'coffee',
      'espresso',
      'energy_033',
      'energy_050',
    ])
  })

  it('omits deactivated types', async () => {
    await db.update(drinkTypes).set({ isActive: false }).where(eq(drinkTypes.slug, 'espresso'))
    const types = await listActiveDrinkTypes(db)
    expect(types.map((t) => t.slug)).not.toContain('espresso')
  })
})

describe('logDrink', () => {
  it('records the drink with its local date and hour', async () => {
    const result = await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    expect(result.ok).toBe(true)

    const [log] = await db.select().from(drinkLogs)
    expect(log).toMatchObject({
      userId: 'ada',
      caffeineMg: 95,
      category: 'coffee',
      localDate: '2026-08-26',
      localHour: 10,
    })
  })

  it('rejects an unknown drink type', async () => {
    const result = await logDrink(db, { userId: 'ada', slug: 'moon-juice', now })
    expect(result).toMatchObject({ ok: false, reason: 'unknown-drink' })
    expect(await db.select().from(drinkLogs)).toEqual([])
  })

  it('rejects a deactivated drink type', async () => {
    await db.update(drinkTypes).set({ isActive: false }).where(eq(drinkTypes.slug, 'espresso'))
    const result = await logDrink(db, { userId: 'ada', slug: 'espresso', now })
    expect(result).toMatchObject({ ok: false, reason: 'unknown-drink' })
  })

  it('creates the rollup row on the first drink of a day', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    expect(await totalsFor('ada', '2026-08-26')).toMatchObject({
      totalMg: 95,
      coffeeCount: 1,
      energyCount: 0,
      otherCount: 0,
    })
  })

  it('accumulates into the rollup across drinks', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, { userId: 'ada', slug: 'espresso', now })
    await logDrink(db, { userId: 'ada', slug: 'energy_050', now })

    expect(await totalsFor('ada', '2026-08-26')).toMatchObject({
      totalMg: 95 + 63 + 160,
      coffeeCount: 2,
      energyCount: 1,
    })
  })

  it('keeps each user and each day separate', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, { userId: 'linn', slug: 'coffee', now })
    await logDrink(db, {
      userId: 'ada',
      slug: 'coffee',
      now: new Date('2026-08-27T08:00:00Z'),
    })

    expect((await totalsFor('ada', '2026-08-26')).totalMg).toBe(95)
    expect((await totalsFor('linn', '2026-08-26')).totalMg).toBe(95)
    expect((await totalsFor('ada', '2026-08-27')).totalMg).toBe(95)
  })

  // The whole point of storing local_date rather than deriving it.
  it('files a late-evening drink under the local date, not the UTC date', async () => {
    // 22:30 UTC on the 26th is 00:30 on the 27th in Oslo.
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: new Date('2026-08-26T22:30:00Z') })

    const [log] = await db.select().from(drinkLogs)
    expect(log.localDate).toBe('2026-08-27')
    expect(log.localHour).toBe(0)
    expect(await totalsFor('ada', '2026-08-27')).toBeDefined()
  })

  // The single most important schema decision: editing a drink type must not
  // rewrite history.
  it('snapshots the caffeine value so later edits do not change past logs', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await db.update(drinkTypes).set({ caffeineMg: 200 }).where(eq(drinkTypes.slug, 'coffee'))

    const [log] = await db.select().from(drinkLogs)
    expect(log.caffeineMg).toBe(95)
    expect((await totalsFor('ada', '2026-08-26')).totalMg).toBe(95)
  })

  it('applies an edited caffeine value to subsequent logs only', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await db.update(drinkTypes).set({ caffeineMg: 200 }).where(eq(drinkTypes.slug, 'coffee'))
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })

    expect((await totalsFor('ada', '2026-08-26')).totalMg).toBe(95 + 200)
  })

  it('leaves the rollup consistent with the logs', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, { userId: 'ada', slug: 'energy_033', now })
    await logDrink(db, { userId: 'linn', slug: 'espresso', now })

    expect(await findRollupDrift(db)).toEqual([])
  })

  /*
   * `affectedUserIds` is what tells a caller which cached per-user data
   * (see `getCaffeineHistory`) to invalidate. If this silently returned the
   * wrong set, a badge earned by someone other than the drinker (`pioneer`)
   * could go on showing stale cached data with nothing to catch it.
   */
  it('reports only the drinker as affected for an ordinary log', async () => {
    const result = await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    expect(result).toMatchObject({ ok: true, affectedUserIds: ['ada'] })
  })

  it('reports both drinker and author when logging someone else’s custom drink', async () => {
    await db.insert(drinkTypes).values({
      slug: 'linn_special',
      name: "Linn's special",
      category: 'other',
      caffeineMg: 80,
      createdBy: 'linn',
    })

    const result = await logDrink(db, { userId: 'ada', slug: 'linn_special', now })
    expect(result.ok && result.affectedUserIds.sort()).toEqual(['ada', 'linn'])
  })
})

describe('logDrink with an adjusted volume', () => {
  it('scales the dose to the volume actually drunk', async () => {
    // A 0.5L can is 160mg; drink 250ml of it and you have had 80.
    const result = await logDrink(db, { userId: 'ada', slug: 'energy_050', now, volumeMl: 250 })
    expect(result).toMatchObject({ ok: true, caffeineMg: 80 })

    const [log] = await db.select().from(drinkLogs)
    expect(log).toMatchObject({ caffeineMg: 80, volumeMl: 250 })
    expect((await totalsFor('ada', '2026-08-26')).totalMg).toBe(80)
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('scales upward for a bigger serving', async () => {
    const result = await logDrink(db, { userId: 'ada', slug: 'espresso', now, volumeMl: 60 })
    // 30ml espresso at 63mg, doubled.
    expect(result).toMatchObject({ ok: true, caffeineMg: 126 })
  })

  it('records no volume when the standard serving was drunk', async () => {
    await logDrink(db, { userId: 'ada', slug: 'energy_050', now })

    const [log] = await db.select().from(drinkLogs)
    expect(log).toMatchObject({ caffeineMg: 160, volumeMl: null })
  })

  // Coffee has no serving size in the catalogue, so there is nothing to scale
  // from and the server must refuse rather than invent a base.
  it('refuses a volume for a drink with no standard serving', async () => {
    const result = await logDrink(db, { userId: 'ada', slug: 'coffee', now, volumeMl: 400 })

    expect(result).toMatchObject({ ok: false, reason: 'no-base-volume' })
    expect(await db.select().from(drinkLogs)).toEqual([])
  })
})

describe('logDrink, backdated', () => {
  it('files the drink under the hour it was drunk, not the hour it was logged', async () => {
    await logDrink(db, {
      userId: 'ada',
      slug: 'coffee',
      now,
      consumedAt: new Date('2026-08-26T05:00:00Z'), // 07:00 Oslo
    })

    const [log] = await db.select().from(drinkLogs)
    expect(log.localHour).toBe(7)
    expect(log.consumedAt).toEqual(new Date('2026-08-26T05:00:00Z'))
  })

  it('records when the row was written separately from when the drink happened', async () => {
    await logDrink(db, {
      userId: 'ada',
      slug: 'coffee',
      now,
      consumedAt: new Date('2026-08-26T05:00:00Z'),
    })

    const [log] = await db.select().from(drinkLogs)
    expect(log.createdAt).toEqual(now)
  })

  it('defaults the drink time to now', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })

    const [log] = await db.select().from(drinkLogs)
    expect(log.consumedAt).toEqual(now)
    expect(log.createdAt).toEqual(now)
  })

  // The rollup has to follow the drink, not the write, or a drink backdated
  // across midnight lands its milligrams on the wrong day.
  it('credits the rollup to the local date the drink happened on', async () => {
    await logDrink(db, {
      userId: 'ada',
      slug: 'coffee',
      now,
      consumedAt: new Date('2026-08-25T20:00:00Z'), // 22:00 Oslo, the day before
    })

    expect(await totalsFor('ada', '2026-08-25')).toMatchObject({ totalMg: 95 })
    expect(await totalsFor('ada', '2026-08-26')).toBeUndefined()
  })

  it('leaves the rollup consistent after a backdated log', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, {
      userId: 'ada',
      slug: 'espresso',
      now,
      consumedAt: new Date('2026-08-25T20:00:00Z'),
    })

    expect(await findRollupDrift(db)).toEqual([])
  })

  it('reports the local date the drink was credited to', async () => {
    const result = await logDrink(db, {
      userId: 'ada',
      slug: 'coffee',
      now,
      consumedAt: new Date('2026-08-25T20:00:00Z'),
    })

    expect(result).toMatchObject({ ok: true, localDate: '2026-08-25' })
  })
})

describe('undoLastDrink', () => {
  it('removes the most recent drink', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, {
      userId: 'ada',
      slug: 'energy_050',
      now: new Date(now.getTime() + 60_000),
    })

    const result = await undoLastDrink(db, { userId: 'ada', now: new Date(now.getTime() + 120_000) })
    expect(result.ok).toBe(true)

    const logs = await db.select().from(drinkLogs)
    expect(logs).toHaveLength(1)
    expect(logs[0].category).toBe('coffee')
  })

  it('decrements the rollup', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await undoLastDrink(db, { userId: 'ada', now })

    expect(await totalsFor('ada', '2026-08-26')).toMatchObject({ totalMg: 95, coffeeCount: 1 })
  })

  // A leftover all-zero row would show up as drift against a fresh rebuild.
  it('removes the rollup row entirely when the last drink of a day is undone', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await undoLastDrink(db, { userId: 'ada', now })

    expect(await totalsFor('ada', '2026-08-26')).toBeUndefined()
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('reports nothing to undo on an empty history', async () => {
    const result = await undoLastDrink(db, { userId: 'ada', now })
    expect(result).toMatchObject({ ok: false, reason: 'nothing-to-undo' })
  })

  it('refuses once the undo window has passed', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })

    const result = await undoLastDrink(db, {
      userId: 'ada',
      now: new Date(now.getTime() + UNDO_WINDOW_MS + 1),
    })
    expect(result).toMatchObject({ ok: false, reason: 'too-old' })
    expect(await db.select().from(drinkLogs)).toHaveLength(1)
  })

  it('allows an undo at the very edge of the window', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    const result = await undoLastDrink(db, {
      userId: 'ada',
      now: new Date(now.getTime() + UNDO_WINDOW_MS),
    })
    expect(result.ok).toBe(true)
  })

  // Authorization: the query is scoped by user, so one person's undo can never
  // reach another person's log.
  it('never touches another user’s drink', async () => {
    await logDrink(db, { userId: 'linn', slug: 'coffee', now })

    const result = await undoLastDrink(db, { userId: 'ada', now })
    expect(result).toMatchObject({ ok: false, reason: 'nothing-to-undo' })
    expect(await db.select().from(drinkLogs)).toHaveLength(1)
  })

  it('undoes only the caller’s most recent drink when both users have logs', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, { userId: 'linn', slug: 'energy_050', now: new Date(now.getTime() + 1000) })

    await undoLastDrink(db, { userId: 'ada', now: new Date(now.getTime() + 2000) })

    const logs = await db.select().from(drinkLogs)
    expect(logs).toHaveLength(1)
    expect(logs[0].userId).toBe('linn')
  })

  it('leaves the rollup consistent after a mix of logs and undos', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, { userId: 'ada', slug: 'energy_033', now })
    await undoLastDrink(db, { userId: 'ada', now })
    await logDrink(db, { userId: 'ada', slug: 'espresso', now })
    await logDrink(db, { userId: 'linn', slug: 'coffee', now })
    await undoLastDrink(db, { userId: 'linn', now })

    expect(await findRollupDrift(db)).toEqual([])
  })

  // The undo window measures from the write, not from the drink: a coffee
  // logged for 07:00 at 10:00 has to stay undoable for the usual ten minutes.
  it('still allows undoing a drink backdated beyond the window', async () => {
    await logDrink(db, {
      userId: 'ada',
      slug: 'coffee',
      now,
      consumedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    })

    const result = await undoLastDrink(db, { userId: 'ada', now })
    expect(result.ok).toBe(true)
    expect(await db.select().from(drinkLogs)).toEqual([])
  })

  it('takes back the most recently written drink, not the latest-dated one', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, {
      userId: 'ada',
      slug: 'espresso',
      now: new Date(now.getTime() + 60_000),
      consumedAt: new Date(now.getTime() - 60 * 60 * 1000),
    })

    await undoLastDrink(db, { userId: 'ada', now: new Date(now.getTime() + 120_000) })

    const logs = await db.select().from(drinkLogs)
    expect(logs).toHaveLength(1)
    expect(logs[0].caffeineMg).toBe(95)
  })
})

describe('getUndoableDrink', () => {
  it('is null with no history', async () => {
    expect(await getUndoableDrink(db, { userId: 'ada', now })).toBeNull()
  })

  it('describes the most recent drink', async () => {
    await logDrink(db, { userId: 'ada', slug: 'energy_050', now })
    expect(await getUndoableDrink(db, { userId: 'ada', now })).toMatchObject({
      caffeineMg: 160,
      name: 'Energy 0.5L',
    })
  })

  it('stops offering once the window has passed', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    const later = new Date(now.getTime() + UNDO_WINDOW_MS + 1)
    expect(await getUndoableDrink(db, { userId: 'ada', now: later })).toBeNull()
  })

  it('offers a backdated drink for the usual window after writing it', async () => {
    await logDrink(db, {
      userId: 'ada',
      slug: 'coffee',
      now,
      consumedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    })

    expect(await getUndoableDrink(db, { userId: 'ada', now })).toMatchObject({
      caffeineMg: 95,
      name: 'Coffee',
    })
  })

  it('never reports another user’s drink', async () => {
    await logDrink(db, { userId: 'linn', slug: 'coffee', now })
    expect(await getUndoableDrink(db, { userId: 'ada', now })).toBeNull()
  })
})

describe('resolveConsumedAt', () => {
  it('falls back to now when no time is given', () => {
    expect(resolveConsumedAt({ time: undefined, now })).toEqual({ ok: true, consumedAt: now })
  })

  it('treats an empty string as no time given', () => {
    expect(resolveConsumedAt({ time: '', now })).toEqual({ ok: true, consumedAt: now })
  })

  it('resolves a wall-clock time earlier today in Oslo', () => {
    // 07:15 Oslo on a summer morning is 05:15 UTC.
    expect(resolveConsumedAt({ time: '07:15', now })).toEqual({
      ok: true,
      consumedAt: new Date('2026-08-26T05:15:00Z'),
    })
  })

  it('accepts the current minute', () => {
    // `now` is 10:00 Oslo.
    expect(resolveConsumedAt({ time: '10:00', now })).toMatchObject({ ok: true })
  })

  // The form submits whole minutes and the two clocks are never exactly in
  // step, so "the minute we are in" has to count as now rather than as future.
  it('accepts the minute in progress when the server clock has run ahead', () => {
    const fortySecondsPast = new Date('2026-08-26T08:00:40Z')
    expect(resolveConsumedAt({ time: '10:01', now: fortySecondsPast })).toMatchObject({
      ok: true,
    })
  })

  it('rejects a time more than a minute ahead of the server clock', () => {
    const fortySecondsPast = new Date('2026-08-26T08:00:40Z')
    expect(resolveConsumedAt({ time: '10:02', now: fortySecondsPast })).toEqual({
      ok: false,
      reason: 'future-time',
    })
  })

  // Someone could otherwise pre-log tonight's espresso and skew the day.
  it('rejects a time later today', () => {
    expect(resolveConsumedAt({ time: '23:00', now })).toEqual({
      ok: false,
      reason: 'future-time',
    })
  })

  it('rejects a malformed time', () => {
    for (const time of ['nope', '7:15', '25:00', '10:60', '10', '10:1']) {
      expect(resolveConsumedAt({ time, now })).toEqual({ ok: false, reason: 'malformed-time' })
    }
  })

  it('anchors to the local date, so a drink just after midnight stays today', () => {
    // 00:30 Oslo on the 27th, i.e. 22:30 UTC on the 26th.
    const justAfterMidnight = new Date('2026-08-26T22:30:00Z')
    expect(resolveConsumedAt({ time: '00:10', now: justAfterMidnight })).toEqual({
      ok: true,
      consumedAt: new Date('2026-08-26T22:10:00Z'),
    })
  })
})

describe('updateDrinkLog', () => {
  async function logCoffee(overrides: Partial<{ slug: string; consumedAt: Date }> = {}) {
    const result = await logDrink(db, {
      userId: 'ada',
      slug: overrides.slug ?? 'coffee',
      now,
      consumedAt: overrides.consumedAt ?? now,
    })
    if (!result.ok) throw new Error('unreachable')
    return result.logId
  }

  it('moves a drink to another time on the same day', async () => {
    const id = await logCoffee()
    const earlier = new Date('2026-08-26T05:00:00Z') // 07:00 Oslo

    const result = await updateDrinkLog(db, { userId: 'ada', logId: id, consumedAt: earlier })
    expect(result).toMatchObject({ ok: true })

    const [log] = await db.select().from(drinkLogs)
    expect(log.consumedAt).toEqual(earlier)
    expect(log.localHour).toBe(7)
    expect(await findRollupDrift(db)).toEqual([])
  })

  // The case the rollup makes interesting: the milligrams have to leave one
  // day's row and land on another's.
  it('moves the milligrams between days when the edit crosses midnight', async () => {
    const id = await logCoffee()
    const yesterdayEvening = new Date('2026-08-25T20:00:00Z') // 22:00 Oslo, the 25th

    await updateDrinkLog(db, { userId: 'ada', logId: id, consumedAt: yesterdayEvening })

    expect(await totalsFor('ada', '2026-08-26')).toBeUndefined()
    expect(await totalsFor('ada', '2026-08-25')).toMatchObject({ totalMg: 95, coffeeCount: 1 })
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('changes the drink type, and the category counts with it', async () => {
    const id = await logCoffee()

    await updateDrinkLog(db, { userId: 'ada', logId: id, slug: 'energy_050' })

    const [log] = await db.select().from(drinkLogs)
    expect(log).toMatchObject({ caffeineMg: 160, category: 'energy' })
    expect(await totalsFor('ada', '2026-08-26')).toMatchObject({
      totalMg: 160,
      coffeeCount: 0,
      energyCount: 1,
      coffeeMg: 0,
      energyMg: 160,
    })
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('changes the time and the type at once', async () => {
    const id = await logCoffee()

    await updateDrinkLog(db, {
      userId: 'ada',
      logId: id,
      slug: 'espresso',
      consumedAt: new Date('2026-08-25T20:00:00Z'),
    })

    expect(await totalsFor('ada', '2026-08-26')).toBeUndefined()
    expect(await totalsFor('ada', '2026-08-25')).toMatchObject({ totalMg: 63, coffeeCount: 1 })
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('rescales the dose when a volume is given', async () => {
    const id = await logCoffee({ slug: 'energy_050' })

    // Half of a 0.5L can: 500ml at 160mg becomes 250ml at 80mg.
    await updateDrinkLog(db, { userId: 'ada', logId: id, volumeMl: 250 })

    const [log] = await db.select().from(drinkLogs)
    expect(log).toMatchObject({ caffeineMg: 80, volumeMl: 250 })
    expect((await totalsFor('ada', '2026-08-26')).totalMg).toBe(80)
    expect(await findRollupDrift(db)).toEqual([])
  })

  // Coffee has no serving size in the catalogue, so there is nothing to scale
  // from. The picker offers a multiplier for these instead of a millilitre
  // slider, and the server has to refuse rather than guess a base volume.
  it('refuses a volume for a drink with no standard serving', async () => {
    const id = await logCoffee()
    const result = await updateDrinkLog(db, { userId: 'ada', logId: id, volumeMl: 400 })

    expect(result).toMatchObject({ ok: false, reason: 'no-base-volume' })
    const [log] = await db.select().from(drinkLogs)
    expect(log).toMatchObject({ caffeineMg: 95, volumeMl: null })
  })

  it('clears a volume back to the standard serving', async () => {
    const id = await logCoffee({ slug: 'energy_050' })
    await updateDrinkLog(db, { userId: 'ada', logId: id, volumeMl: 250 })
    await updateDrinkLog(db, { userId: 'ada', logId: id, volumeMl: null })

    const [log] = await db.select().from(drinkLogs)
    expect(log).toMatchObject({ caffeineMg: 160, volumeMl: null })
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('leaves everything alone when nothing is asked for', async () => {
    const id = await logCoffee()
    await updateDrinkLog(db, { userId: 'ada', logId: id })

    const [log] = await db.select().from(drinkLogs)
    expect(log).toMatchObject({ caffeineMg: 95, localDate: '2026-08-26' })
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('refuses an unknown drink type and changes nothing', async () => {
    const id = await logCoffee()
    const result = await updateDrinkLog(db, { userId: 'ada', logId: id, slug: 'moon-juice' })

    expect(result).toMatchObject({ ok: false, reason: 'unknown-drink' })
    const [log] = await db.select().from(drinkLogs)
    expect(log.caffeineMg).toBe(95)
  })

  it('refuses a log that does not exist', async () => {
    const result = await updateDrinkLog(db, { userId: 'ada', logId: 9999, consumedAt: now })
    expect(result).toMatchObject({ ok: false, reason: 'not-found' })
  })

  // Authorisation: the id comes from the client, so the scope is the guard.
  it('never touches another member’s drink', async () => {
    const result = await logDrink(db, { userId: 'linn', slug: 'coffee', now })
    if (!result.ok) throw new Error('unreachable')

    const attempt = await updateDrinkLog(db, {
      userId: 'ada',
      logId: result.logId,
      slug: 'energy_050',
    })

    expect(attempt).toMatchObject({ ok: false, reason: 'not-found' })
    const [log] = await db.select().from(drinkLogs)
    expect(log.caffeineMg).toBe(95)
  })
})

describe('deleteDrinkLog', () => {
  it('removes the drink and its milligrams', async () => {
    const first = await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, { userId: 'ada', slug: 'espresso', now })
    if (!first.ok) throw new Error('unreachable')

    const result = await deleteDrinkLog(db, { userId: 'ada', logId: first.logId })
    expect(result).toMatchObject({ ok: true })

    expect(await db.select().from(drinkLogs)).toHaveLength(1)
    expect(await totalsFor('ada', '2026-08-26')).toMatchObject({ totalMg: 63, coffeeCount: 1 })
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('removes the rollup row when the day’s last drink goes', async () => {
    const result = await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    if (!result.ok) throw new Error('unreachable')

    await deleteDrinkLog(db, { userId: 'ada', logId: result.logId })

    expect(await totalsFor('ada', '2026-08-26')).toBeUndefined()
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('works long after the undo window has closed', async () => {
    const result = await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    if (!result.ok) throw new Error('unreachable')

    const muchLater = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
    expect(await deleteDrinkLog(db, { userId: 'ada', logId: result.logId, now: muchLater })).toMatchObject({
      ok: true,
    })
  })

  it('refuses a log that does not exist', async () => {
    expect(await deleteDrinkLog(db, { userId: 'ada', logId: 9999 })).toMatchObject({
      ok: false,
      reason: 'not-found',
    })
  })

  it('never deletes another member’s drink', async () => {
    const result = await logDrink(db, { userId: 'linn', slug: 'coffee', now })
    if (!result.ok) throw new Error('unreachable')

    expect(await deleteDrinkLog(db, { userId: 'ada', logId: result.logId })).toMatchObject({
      ok: false,
      reason: 'not-found',
    })
    expect(await db.select().from(drinkLogs)).toHaveLength(1)
  })
})

describe('getUserRecentDrinks', () => {
  it('is empty with nothing logged', async () => {
    expect(await getUserRecentDrinks(db, 'ada', { now })).toEqual([])
  })

  it('lists the member’s drinks newest first, with what the row needs', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now, consumedAt: new Date('2026-08-26T05:00:00Z') })
    await logDrink(db, { userId: 'ada', slug: 'energy_050', now })

    const recent = await getUserRecentDrinks(db, 'ada', { now })
    expect(recent.map((drink) => drink.name)).toEqual(['Energy 0.5L', 'Coffee'])
    expect(recent[0]).toMatchObject({ caffeineMg: 160, slug: 'energy_050' })
    expect(recent[0]).toHaveProperty('id')
    expect(recent[0]).toHaveProperty('consumedAt')
  })

  it('reaches back the requested number of days and no further', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    await logDrink(db, {
      userId: 'ada',
      slug: 'espresso',
      now,
      consumedAt: new Date('2026-08-20T08:00:00Z'),
    })

    expect(await getUserRecentDrinks(db, 'ada', { now, days: 0 })).toHaveLength(1)
    expect(await getUserRecentDrinks(db, 'ada', { now, days: 7 })).toHaveLength(2)
  })

  it('never lists another member’s drinks', async () => {
    await logDrink(db, { userId: 'linn', slug: 'coffee', now })
    expect(await getUserRecentDrinks(db, 'ada', { now })).toEqual([])
  })
})
