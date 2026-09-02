import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/db/test-db'
import {
  alcoholDrinkTypes,
  alcoholLogs,
  dailyTotals,
  drinkLogs,
  drinkTypes,
  members,
  users,
} from '@/db/schema'
import { ALCOHOL_TYPE_SEEDS } from '@/db/alcohol-seed-data'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import { logDrink } from './drinks'
import {
  ALCOHOL_UNDO_WINDOW_MS,
  deleteAlcoholLog,
  getAlcoholLeaderboard,
  getUndoableAlcoholDrink,
  getUserAlcoholEvents,
  getUserAlcoholToday,
  getUserRecentAlcohol,
  listActiveAlcoholTypes,
  logAlcoholDrink,
  undoLastAlcoholDrink,
  updateAlcoholLog,
} from './alcohol'

let db: TestDb

/** 22:00 Oslo on a Friday in summer (UTC+2). */
const now = new Date('2026-08-28T20:00:00Z')

const HOUR = 3_600_000

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(users).values([
    { id: 'ada', name: 'Ada', email: 'ada@example.com', image: null },
    { id: 'linn', name: 'Linn', email: 'linn@example.com', image: null },
    { id: 'per', name: 'Per', email: 'per@example.com', image: null },
  ])
  await db.insert(members).values([
    { userId: 'ada', displayName: 'Ada', joinedAt: now },
    { userId: 'linn', displayName: 'Linn', joinedAt: now },
    { userId: 'per', displayName: 'Per', joinedAt: now },
  ])
  await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)
  await db.insert(alcoholDrinkTypes).values(ALCOHOL_TYPE_SEEDS)
})

describe('listActiveAlcoholTypes', () => {
  it('returns the seeded types in display order with their grams worked out', async () => {
    const types = await listActiveAlcoholTypes(db)
    expect(types.map((t) => t.slug)).toEqual([
      'beer_pint',
      'beer_040',
      'beer_small',
      'beer_strong',
      'wine_glass',
      'spirit_4cl',
      'cider_033',
      'hiroshima',
    ])
    expect(types[0].alcoholGrams).toBeCloseTo(18.54, 2)
  })

  it('omits deactivated types', async () => {
    await db
      .update(alcoholDrinkTypes)
      .set({ isActive: false })
      .where(eq(alcoholDrinkTypes.slug, 'spirit_4cl'))
    const types = await listActiveAlcoholTypes(db)
    expect(types.map((t) => t.slug)).not.toContain('spirit_4cl')
  })
})

describe('logAlcoholDrink', () => {
  it('records the drink with its Oslo date and hour', async () => {
    const result = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    expect(result.ok).toBe(true)

    const [log] = await db.select().from(alcoholLogs)
    expect(log).toMatchObject({
      userId: 'ada',
      category: 'beer',
      volumeMl: 500,
      localDate: '2026-08-28',
      localHour: 22,
    })
    expect(log.alcoholGrams).toBeCloseTo(18.54, 2)
  })

  it('refuses an unknown drink', async () => {
    const result = await logAlcoholDrink(db, { userId: 'ada', slug: 'absinthe', now })
    expect(result).toEqual({ ok: false, reason: 'unknown-drink' })
  })

  it('refuses a deactivated drink', async () => {
    await db
      .update(alcoholDrinkTypes)
      .set({ isActive: false })
      .where(eq(alcoholDrinkTypes.slug, 'beer_pint'))

    const result = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    expect(result).toEqual({ ok: false, reason: 'unknown-drink' })
  })

  it('snapshots the grams, so a later ABV edit does not rewrite history', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await db
      .update(alcoholDrinkTypes)
      .set({ abvPercent: 9 })
      .where(eq(alcoholDrinkTypes.slug, 'beer_pint'))

    const [log] = await db.select().from(alcoholLogs)
    expect(log.alcoholGrams).toBeCloseTo(18.54, 2)
  })

  it('buckets a drink after midnight onto the next local date', async () => {
    // 00:30 Oslo is 22:30 UTC the day before.
    const afterMidnight = new Date('2026-08-28T22:30:00Z')
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: afterMidnight })

    const [log] = await db.select().from(alcoholLogs)
    expect(log.localDate).toBe('2026-08-29')
    expect(log.localHour).toBe(0)
  })

  it('keeps consumedAt and createdAt apart when backdating', async () => {
    const earlier = new Date('2026-08-28T17:00:00Z')
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now, consumedAt: earlier })

    const [log] = await db.select().from(alcoholLogs)
    expect(log.consumedAt).toEqual(earlier)
    expect(log.createdAt).toEqual(now)
    expect(log.localHour).toBe(19)
  })
})

describe('alcohol never touches the caffeine path', () => {
  it('leaves drink_logs and daily_totals completely alone', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    const before = {
      logs: await db.select().from(drinkLogs),
      totals: await db.select().from(dailyTotals),
    }

    const first = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    await undoLastAlcoholDrink(db, { userId: 'ada', now })
    if (first.ok) {
      await updateAlcoholLog(db, { userId: 'ada', logId: first.logId, time: '19:00', now })
      await deleteAlcoholLog(db, { userId: 'ada', logId: first.logId })
    }

    expect(await db.select().from(drinkLogs)).toEqual(before.logs)
    expect(await db.select().from(dailyTotals)).toEqual(before.totals)
  })
})

describe('undoLastAlcoholDrink', () => {
  it('removes the most recently written drink', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })

    const result = await undoLastAlcoholDrink(db, { userId: 'ada', now })
    expect(result.ok).toBe(true)

    const rows = await db.select().from(alcoholLogs)
    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBe('beer')
  })

  it('orders by write time, so a backdated drink is still the last thing you did', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, {
      userId: 'ada',
      slug: 'wine_glass',
      now: new Date(now.getTime() + 1000),
      consumedAt: new Date(now.getTime() - 3 * HOUR),
    })

    await undoLastAlcoholDrink(db, { userId: 'ada', now: new Date(now.getTime() + 2000) })
    const rows = await db.select().from(alcoholLogs)
    expect(rows.map((r) => r.category)).toEqual(['beer'])
  })

  it('refuses once the window has passed', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    const late = new Date(now.getTime() + ALCOHOL_UNDO_WINDOW_MS + 1000)

    expect(await undoLastAlcoholDrink(db, { userId: 'ada', now: late })).toEqual({
      ok: false,
      reason: 'too-old',
    })
  })

  it('says there is nothing to undo when there is nothing', async () => {
    expect(await undoLastAlcoholDrink(db, { userId: 'ada', now })).toEqual({
      ok: false,
      reason: 'nothing-to-undo',
    })
  })

  it('cannot reach another member drink', async () => {
    await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })

    expect(await undoLastAlcoholDrink(db, { userId: 'ada', now })).toEqual({
      ok: false,
      reason: 'nothing-to-undo',
    })
    expect(await db.select().from(alcoholLogs)).toHaveLength(1)
  })
})

describe('getUndoableAlcoholDrink', () => {
  it('names the drink while the window is open', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    const undoable = await getUndoableAlcoholDrink(db, { userId: 'ada', now })
    expect(undoable?.name).toBe('Wine glass')
  })

  it('is null once the window has closed', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    const late = new Date(now.getTime() + ALCOHOL_UNDO_WINDOW_MS + 1)
    expect(await getUndoableAlcoholDrink(db, { userId: 'ada', now: late })).toBeNull()
  })
})

describe('updateAlcoholLog', () => {
  it('moves the drink and recomputes its local hour', async () => {
    const logged = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    if (!logged.ok) throw new Error('setup failed')

    expect(
      await updateAlcoholLog(db, { userId: 'ada', logId: logged.logId, time: '19:00', now }),
    ).toEqual({ ok: true })

    const [log] = await db.select().from(alcoholLogs)
    // 19:00 Oslo on the drink's own date, which is 17:00 UTC in summer.
    expect(log.consumedAt).toEqual(new Date('2026-08-28T17:00:00Z'))
    expect(log.localHour).toBe(19)
    expect(log.localDate).toBe('2026-08-28')
  })

  /*
   * The case the whole `time`-not-`Date` signature exists for. At 00:30 the
   * list still shows last night's drinks; anchoring their edits to today would
   * refuse 22:30 as a time that has not happened yet.
   */
  it('resolves the time against the drink own date, not today', async () => {
    // 23:00 Oslo on the 28th.
    const lastNight = new Date('2026-08-28T21:00:00Z')
    const logged = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: lastNight })
    if (!logged.ok) throw new Error('setup failed')

    // It is now 00:30 Oslo on the 29th, and the drink is being corrected.
    const afterMidnight = new Date('2026-08-28T22:30:00Z')
    expect(
      await updateAlcoholLog(db, {
        userId: 'ada',
        logId: logged.logId,
        time: '22:30',
        now: afterMidnight,
      }),
    ).toEqual({ ok: true })

    const [log] = await db.select().from(alcoholLogs)
    expect(log.localDate).toBe('2026-08-28')
    expect(log.localHour).toBe(22)
    expect(log.consumedAt).toEqual(new Date('2026-08-28T20:30:00Z'))
  })

  it('refuses a time later today', async () => {
    const logged = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    if (!logged.ok) throw new Error('setup failed')

    expect(
      await updateAlcoholLog(db, { userId: 'ada', logId: logged.logId, time: '23:59', now }),
    ).toEqual({ ok: false, reason: 'future-time' })
  })

  it('refuses a malformed time', async () => {
    const logged = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    if (!logged.ok) throw new Error('setup failed')

    expect(
      await updateAlcoholLog(db, { userId: 'ada', logId: logged.logId, time: '25:00', now }),
    ).toEqual({ ok: false, reason: 'malformed-time' })
  })

  it('leaves the grams alone — an edit moves a drink, it does not repour it', async () => {
    const logged = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    if (!logged.ok) throw new Error('setup failed')

    await updateAlcoholLog(db, { userId: 'ada', logId: logged.logId, time: '20:00', now })

    const [log] = await db.select().from(alcoholLogs)
    expect(log.alcoholGrams).toBeCloseTo(18.54, 2)
  })

  it('cannot reach another member log', async () => {
    const logged = await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })
    if (!logged.ok) throw new Error('setup failed')

    expect(
      await updateAlcoholLog(db, { userId: 'ada', logId: logged.logId, time: '19:00', now }),
    ).toEqual({ ok: false, reason: 'not-found' })

    const [log] = await db.select().from(alcoholLogs)
    expect(log.consumedAt).toEqual(now)
  })

  it('reports a missing log rather than silently doing nothing', async () => {
    expect(await updateAlcoholLog(db, { userId: 'ada', logId: 9999, time: '19:00', now })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })
})

describe('deleteAlcoholLog', () => {
  it('deletes a drink however old it is', async () => {
    const logged = await logAlcoholDrink(db, {
      userId: 'ada',
      slug: 'beer_pint',
      now: new Date(now.getTime() - 40 * HOUR),
    })
    if (!logged.ok) throw new Error('setup failed')

    expect(await deleteAlcoholLog(db, { userId: 'ada', logId: logged.logId })).toEqual({ ok: true })
    expect(await db.select().from(alcoholLogs)).toHaveLength(0)
  })

  it('cannot reach another member log', async () => {
    const logged = await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })
    if (!logged.ok) throw new Error('setup failed')

    expect(await deleteAlcoholLog(db, { userId: 'ada', logId: logged.logId })).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(await db.select().from(alcoholLogs)).toHaveLength(1)
  })
})

describe('getUserAlcoholToday', () => {
  it('adds up the local day and counts the drinks', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })

    const today = await getUserAlcoholToday(db, 'ada', { now })
    expect(today.drinkCount).toBe(2)
    expect(today.totalGrams).toBeCloseTo(18.54 + 14.2, 1)
  })

  it('is zero for a member who has logged nothing', async () => {
    expect(await getUserAlcoholToday(db, 'ada', { now })).toEqual({
      totalGrams: 0,
      drinkCount: 0,
    })
  })
})

describe('getUserAlcoholEvents', () => {
  it('returns only this member drinks inside the window, oldest first', async () => {
    const early = new Date(now.getTime() - 4 * HOUR)
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: early })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })

    const events = await getUserAlcoholEvents(db, 'ada', {
      from: new Date(now.getTime() - 8 * HOUR),
      now,
    })
    expect(events).toHaveLength(2)
    expect(events[0].consumedAt.getTime()).toBeLessThan(events[1].consumedAt.getTime())
  })

  it('spans midnight, because an evening does', async () => {
    // 23:30 then 00:30 Oslo: two local dates, one evening.
    const beforeMidnight = new Date('2026-08-28T21:30:00Z')
    const afterMidnight = new Date('2026-08-28T22:30:00Z')
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: beforeMidnight })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: afterMidnight })

    const events = await getUserAlcoholEvents(db, 'ada', {
      from: new Date(afterMidnight.getTime() - 8 * HOUR),
      now: afterMidnight,
    })
    expect(events).toHaveLength(2)
  })
})

describe('getUserRecentAlcohol', () => {
  it('lists this evening newest first', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, {
      userId: 'ada',
      slug: 'wine_glass',
      now: new Date(now.getTime() + 60_000),
    })

    const recent = await getUserRecentAlcohol(db, 'ada', { now: new Date(now.getTime() + 60_000) })
    expect(recent.map((r) => r.name)).toEqual(['Wine glass', 'Pint 0.5L'])
  })

  it('still shows the drinks from before midnight once it is past it', async () => {
    const beforeMidnight = new Date('2026-08-28T21:30:00Z')
    const afterMidnight = new Date('2026-08-28T22:30:00Z')
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: beforeMidnight })

    const recent = await getUserRecentAlcohol(db, 'ada', { now: afterMidnight })
    expect(recent).toHaveLength(1)
  })

  it('shows nobody else drinks', async () => {
    await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })
    expect(await getUserRecentAlcohol(db, 'ada', { now })).toEqual([])
  })
})

describe('getAlcoholLeaderboard', () => {
  it('ranks the whole roster by grams, including people who drank nothing', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'linn', slug: 'wine_glass', now })

    const rows = await getAlcoholLeaderboard(db, 'today', now)
    expect(rows.map((r) => [r.displayName, r.rank])).toEqual([
      ['Ada', 1],
      ['Linn', 2],
      ['Per', 3],
    ])
    expect(rows[0].totalGrams).toBeCloseTo(37.08, 2)
    expect(rows[0].drinkCount).toBe(2)
    expect(rows[2].totalGrams).toBe(0)
  })

  it('shares a rank on a tie', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })

    const rows = await getAlcoholLeaderboard(db, 'today', now)
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3])
  })

  it('counts only the period asked for', async () => {
    // Yesterday, and so outside "today" but inside "month".
    const yesterday = new Date(now.getTime() - 24 * HOUR)
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: yesterday })
    await logAlcoholDrink(db, { userId: 'linn', slug: 'wine_glass', now })

    const today = await getAlcoholLeaderboard(db, 'today', now)
    expect(today.find((r) => r.displayName === 'Ada')!.totalGrams).toBe(0)

    const month = await getAlcoholLeaderboard(db, 'month', now)
    expect(month.find((r) => r.displayName === 'Ada')!.totalGrams).toBeCloseTo(18.54, 2)
  })

  it('excludes a drink from before this month', async () => {
    // 2026-07-31, the day before the month range starts.
    await logAlcoholDrink(db, {
      userId: 'ada',
      slug: 'beer_pint',
      now: new Date('2026-07-31T18:00:00Z'),
    })

    const rows = await getAlcoholLeaderboard(db, 'month', now)
    expect(rows.find((r) => r.displayName === 'Ada')!.totalGrams).toBe(0)
  })
})
