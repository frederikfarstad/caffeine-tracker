import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '@/db/test-db'
import { members, users } from '@/db/schema'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import { drinkTypes } from '@/db/schema'
import { logDrink } from './drinks'
import {
  getLeaderboard,
  getTeamHourHistogram,
  getTeamSplit,
  getTeamTimeSeries,
  getUserStreak,
  getTeamIntakeEvents,
  getUserFavouriteDrinkTypes,
  getUserIntakeEvents,
  getUserSummary,
  getUserTimeSeries,
} from './stats'

let db: TestDb

/**
 * A Date landing on a given local hour in Oslo during summer (UTC+2).
 * Hours below 2 would cross the date line, so fixtures stay in office hours.
 */
function oslo(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour - 2).padStart(2, '0')}:00:00Z`)
}

/** Wednesday 2026-08-26, 15:00 Oslo. Week runs Mon 24 - Wed 26. */
const NOW = oslo('2026-08-26', 15)

beforeEach(async () => {
  db = await createTestDb()

  await db.insert(users).values([
    { id: 'ada', name: 'Ada', email: 'ada@example.com', image: 'https://img/ada' },
    { id: 'linn', name: 'Linn', email: 'linn@example.com', image: null },
    { id: 'bo', name: 'Bo', email: 'bo@example.com', image: null },
  ])
  await db.insert(members).values([
    { userId: 'ada', displayName: 'Ada', joinedAt: NOW },
    { userId: 'linn', displayName: 'Linn', joinedAt: NOW },
    { userId: 'bo', displayName: 'Bo', joinedAt: NOW },
  ])
  await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)

  // Ada: steady drinker this week.
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) }) // 95
  await logDrink(db, { userId: 'ada', slug: 'energy_050', now: oslo('2026-08-26', 14) }) // 160
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-25', 9) }) // 95
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-20', 9) }) // 95

  // Linn: quiet this week, but had one enormous day earlier in the month.
  await logDrink(db, { userId: 'linn', slug: 'espresso', now: oslo('2026-08-26', 9) }) // 63
  await logDrink(db, { userId: 'linn', slug: 'coffee', now: oslo('2026-08-24', 9) }) // 95
  for (let i = 0; i < 3; i++) {
    await logDrink(db, { userId: 'linn', slug: 'energy_050', now: oslo('2026-08-05', 8 + i) }) // 480
  }

  // Bo has joined but never logged anything.
})

describe('getUserSummary', () => {
  it('totals today', async () => {
    const summary = await getUserSummary(db, 'ada', 'today', NOW)
    expect(summary).toMatchObject({
      totalMg: 255,
      drinkCount: 2,
      coffeeCount: 1,
      energyCount: 1,
    })
  })

  it('totals the week from Monday', async () => {
    // 24th (nothing for Ada) + 25th (95) + 26th (255)
    expect((await getUserSummary(db, 'ada', 'week', NOW)).totalMg).toBe(350)
  })

  it('totals the month, including days outside this week', async () => {
    expect((await getUserSummary(db, 'ada', 'month', NOW)).totalMg).toBe(445)
  })

  it('totals all time', async () => {
    expect((await getUserSummary(db, 'linn', 'all', NOW)).totalMg).toBe(638)
  })

  it('reports the rank for the period', async () => {
    expect((await getUserSummary(db, 'ada', 'today', NOW)).rank).toBe(1)
    expect((await getUserSummary(db, 'linn', 'today', NOW)).rank).toBe(2)
  })

  // Ada leads today; Linn leads the month on the back of one big day.
  it('re-ranks when the period changes', async () => {
    expect((await getUserSummary(db, 'linn', 'month', NOW)).rank).toBe(1)
    expect((await getUserSummary(db, 'ada', 'month', NOW)).rank).toBe(2)
  })

  it('counts every member, including those who never log', async () => {
    expect((await getUserSummary(db, 'ada', 'today', NOW)).memberCount).toBe(3)
  })

  it('returns zeroes for a member with nothing in the period', async () => {
    const summary = await getUserSummary(db, 'bo', 'today', NOW)
    expect(summary).toMatchObject({ totalMg: 0, drinkCount: 0, coffeeCount: 0, energyCount: 0 })
  })

  it('places a member with nothing logged after everyone who did', async () => {
    expect((await getUserSummary(db, 'bo', 'today', NOW)).rank).toBe(3)
  })
})

describe('getUserTimeSeries', () => {
  it('returns all 24 hours for today', async () => {
    const series = await getUserTimeSeries(db, 'ada', 'today', NOW)
    expect(series).toHaveLength(24)
    expect(series[0]).toEqual({ bucket: '00', mg: 0 })
  })

  it('places today’s drinks in their local hour', async () => {
    const series = await getUserTimeSeries(db, 'ada', 'today', NOW)
    expect(series.find((p) => p.bucket === '10')).toEqual({ bucket: '10', mg: 95 })
    expect(series.find((p) => p.bucket === '14')).toEqual({ bucket: '14', mg: 160 })
  })

  it('returns one bucket per day of the week so far', async () => {
    const series = await getUserTimeSeries(db, 'ada', 'week', NOW)
    expect(series.map((p) => p.bucket)).toEqual(['2026-08-24', '2026-08-25', '2026-08-26'])
  })

  // A chart that silently skips empty days misrepresents the shape of the data.
  it('fills days with no drinks as explicit zeroes', async () => {
    const series = await getUserTimeSeries(db, 'ada', 'week', NOW)
    expect(series).toEqual([
      { bucket: '2026-08-24', mg: 0 },
      { bucket: '2026-08-25', mg: 95 },
      { bucket: '2026-08-26', mg: 255 },
    ])
  })

  it('covers the whole month to date', async () => {
    const series = await getUserTimeSeries(db, 'ada', 'month', NOW)
    expect(series).toHaveLength(26)
    expect(series[0].bucket).toBe('2026-08-01')
    expect(series.at(-1)).toEqual({ bucket: '2026-08-26', mg: 255 })
  })

  it('starts an all-time series at that person’s first drink', async () => {
    const series = await getUserTimeSeries(db, 'ada', 'all', NOW)
    expect(series[0].bucket).toBe('2026-08-20')
    expect(series.at(-1)?.bucket).toBe('2026-08-26')
  })

  it('returns a single zero bucket for someone with no history', async () => {
    const series = await getUserTimeSeries(db, 'bo', 'all', NOW)
    expect(series).toEqual([{ bucket: '2026-08-26', mg: 0 }])
  })
})

describe('getUserStreak', () => {
  it('counts consecutive days ending today', async () => {
    // Ada drank on the 25th and 26th; nothing on the 24th.
    expect(await getUserStreak(db, 'ada', NOW)).toBe(2)
  })

  it('counts a single day', async () => {
    expect(await getUserStreak(db, 'linn', NOW)).toBe(1)
  })

  it('is zero for someone who has never logged', async () => {
    expect(await getUserStreak(db, 'bo', NOW)).toBe(0)
  })

  // The day isn't over yet, so not having had one today shouldn't punish you.
  it('keeps a streak alive on a day with nothing logged yet', async () => {
    expect(await getUserStreak(db, 'ada', oslo('2026-08-27', 9))).toBe(2)
  })

  it('breaks after a full day missed', async () => {
    expect(await getUserStreak(db, 'ada', oslo('2026-08-28', 9))).toBe(0)
  })
})

describe('getLeaderboard', () => {
  it('ranks by caffeine for today', async () => {
    const board = await getLeaderboard(db, 'today', NOW)
    expect(board.map((row) => [row.displayName, row.totalMg, row.rank])).toEqual([
      ['Ada', 255, 1],
      ['Linn', 63, 2],
      ['Bo', 0, 3],
    ])
  })

  it('reorders for a different period', async () => {
    const board = await getLeaderboard(db, 'month', NOW)
    expect(board.map((row) => row.displayName)).toEqual(['Linn', 'Ada', 'Bo'])
  })

  it('includes members who have logged nothing', async () => {
    const board = await getLeaderboard(db, 'today', NOW)
    expect(board.find((row) => row.displayName === 'Bo')).toMatchObject({ totalMg: 0 })
  })

  it('carries counts and avatars for display', async () => {
    const [top] = await getLeaderboard(db, 'today', NOW)
    expect(top).toMatchObject({
      userId: 'ada',
      image: 'https://img/ada',
      coffeeCount: 1,
      energyCount: 1,
    })
  })

  it('gives tied totals the same rank and skips the next', async () => {
    // Give Bo exactly what Linn has today.
    await logDrink(db, { userId: 'bo', slug: 'espresso', now: oslo('2026-08-26', 11) })

    const board = await getLeaderboard(db, 'today', NOW)
    expect(board.map((row) => [row.displayName, row.rank])).toEqual([
      ['Ada', 1],
      ['Bo', 2],
      ['Linn', 2],
    ])
  })
})

describe('getTeamTimeSeries', () => {
  it('sums the whole team per day', async () => {
    const series = await getTeamTimeSeries(db, 'week', NOW)
    expect(series).toEqual([
      { bucket: '2026-08-24', mg: 95 },
      { bucket: '2026-08-25', mg: 95 },
      { bucket: '2026-08-26', mg: 318 },
    ])
  })

  it('buckets today by hour', async () => {
    const series = await getTeamTimeSeries(db, 'today', NOW)
    expect(series).toHaveLength(24)
    expect(series.find((p) => p.bucket === '09')).toEqual({ bucket: '09', mg: 63 })
  })

  it('starts an all-time series at the team’s first drink', async () => {
    const series = await getTeamTimeSeries(db, 'all', NOW)
    expect(series[0].bucket).toBe('2026-08-05')
  })
})

describe('getTeamHourHistogram', () => {
  it('returns one bar per hour of the day', async () => {
    const bars = await getTeamHourHistogram(db, 'today', NOW)
    expect(bars).toHaveLength(24)
    expect(bars.map((bar) => bar.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i))
  })

  it('shows when the office actually drinks', async () => {
    const bars = await getTeamHourHistogram(db, 'today', NOW)
    const byHour = Object.fromEntries(bars.map((bar) => [bar.hour, bar.mg]))
    expect(byHour[9]).toBe(63)
    expect(byHour[10]).toBe(95)
    expect(byHour[14]).toBe(160)
    expect(byHour[3]).toBe(0)
  })

  it('aggregates hours across a longer period', async () => {
    const bars = await getTeamHourHistogram(db, 'month', NOW)
    const byHour = Object.fromEntries(bars.map((bar) => [bar.hour, bar.mg]))
    // 09:00 across the month: Ada's coffees on the 25th and 20th, Linn's
    // espresso on the 26th, her coffee on the 24th, and one of her three
    // energy drinks on the 5th.
    expect(byHour[9]).toBe(95 + 95 + 63 + 95 + 160)
  })
})

describe('getTeamSplit', () => {
  it('splits today by category, in milligrams and drinks', async () => {
    const split = await getTeamSplit(db, 'today', NOW)
    expect(split).toEqual([
      { category: 'coffee', mg: 158, count: 2 },
      { category: 'energy', mg: 160, count: 1 },
      { category: 'other', mg: 0, count: 0 },
    ])
  })

  it('splits the whole month', async () => {
    const split = await getTeamSplit(db, 'month', NOW)
    const coffee = split.find((s) => s.category === 'coffee')!
    const energy = split.find((s) => s.category === 'energy')!
    // Ada's three coffees, Linn's coffee, and Linn's espresso.
    expect(coffee.mg).toBe(95 + 95 + 95 + 95 + 63)
    expect(energy.mg).toBe(160 + 480)
  })

  it('returns zeroes rather than nothing when there is no data', async () => {
    const emptyDb = await createTestDb()
    expect(await getTeamSplit(emptyDb, 'today', NOW)).toEqual([
      { category: 'coffee', mg: 0, count: 0 },
      { category: 'energy', mg: 0, count: 0 },
      { category: 'other', mg: 0, count: 0 },
    ])
  })
})

describe('getUserIntakeEvents', () => {
  // 12 hours back from 15:00 Oslo is 03:00 the same morning.
  const twelveHoursBack = new Date(NOW.getTime() - 12 * 60 * 60 * 1000)

  it('returns the caller’s drinks inside the window, oldest first', async () => {
    const events = await getUserIntakeEvents(db, 'ada', { from: twelveHoursBack })

    expect(events).toEqual([
      { consumedAt: oslo('2026-08-26', 10), caffeineMg: 95 },
      { consumedAt: oslo('2026-08-26', 14), caffeineMg: 160 },
    ])
  })

  it('excludes drinks older than the window', async () => {
    const events = await getUserIntakeEvents(db, 'ada', { from: twelveHoursBack })
    expect(events.map((event) => event.consumedAt)).not.toContain(oslo('2026-08-25', 9))
  })

  it('never returns another member’s drinks', async () => {
    const events = await getUserIntakeEvents(db, 'linn', { from: twelveHoursBack })
    expect(events).toEqual([{ consumedAt: oslo('2026-08-26', 9), caffeineMg: 63 }])
  })

  it('is empty for a member who has never logged anything', async () => {
    expect(await getUserIntakeEvents(db, 'bo', { from: twelveHoursBack })).toEqual([])
  })

  // The window is a rolling 12 hours, so before noon it reaches back into
  // yesterday — across the local_date the query is indexed by.
  it('reaches back across the local date boundary', async () => {
    // 08:00 Oslo on the 26th; the window opens at 20:00 on the 25th.
    const morning = oslo('2026-08-26', 8)
    await logDrink(db, { userId: 'ada', slug: 'espresso', now: oslo('2026-08-25', 22) })

    const events = await getUserIntakeEvents(db, 'ada', {
      from: new Date(morning.getTime() - 12 * 60 * 60 * 1000),
    })

    expect(events).toEqual([
      { consumedAt: oslo('2026-08-25', 22), caffeineMg: 63 },
      { consumedAt: oslo('2026-08-26', 10), caffeineMg: 95 },
      { consumedAt: oslo('2026-08-26', 14), caffeineMg: 160 },
    ])
  })

  // Backdating writes a row whose consumed_at is older than its created_at;
  // the curve has to place it where it was drunk.
  it('orders by when the drink was drunk, not when it was logged', async () => {
    await logDrink(db, {
      userId: 'bo',
      slug: 'coffee',
      now: oslo('2026-08-26', 14),
      consumedAt: oslo('2026-08-26', 7),
    })
    await logDrink(db, { userId: 'bo', slug: 'espresso', now: oslo('2026-08-26', 13) })

    const events = await getUserIntakeEvents(db, 'bo', { from: twelveHoursBack })
    expect(events.map((event) => event.consumedAt)).toEqual([
      oslo('2026-08-26', 7),
      oslo('2026-08-26', 13),
    ])
  })
})

describe('getUserFavouriteDrinkTypes', () => {
  // Ada's month, from the fixtures: 3 coffees, 1 energy_050.
  it('ranks a member’s own drinks by how often they log them', async () => {
    const favourites = await getUserFavouriteDrinkTypes(db, 'ada', { limit: 2, now: NOW })
    expect(favourites.map((type) => type.slug)).toEqual(['coffee', 'energy_050'])
  })

  it('pads with the catalogue so the row is never short', async () => {
    const favourites = await getUserFavouriteDrinkTypes(db, 'ada', { limit: 4, now: NOW })

    expect(favourites).toHaveLength(4)
    expect(new Set(favourites.map((type) => type.slug)).size).toBe(4)
  })

  // A new colleague has no history at all and still needs a full row of
  // buttons, in the catalogue's own display order.
  it('falls back to display order for someone who has logged nothing', async () => {
    const favourites = await getUserFavouriteDrinkTypes(db, 'bo', { limit: 4, now: NOW })
    expect(favourites.map((type) => type.slug)).toEqual([
      'coffee',
      'espresso',
      'energy_033',
      'energy_050',
    ])
  })

  it('respects the limit', async () => {
    const favourites = await getUserFavouriteDrinkTypes(db, 'ada', { limit: 1, now: NOW })
    expect(favourites).toHaveLength(1)
    expect(favourites[0].slug).toBe('coffee')
  })

  it('never counts another member’s drinks', async () => {
    // Over a month Linn's three energy drinks outrank everything; Ada's coffees
    // are hers alone. The two members must not see the same row.
    const [linn] = await getUserFavouriteDrinkTypes(db, 'linn', { limit: 1, now: NOW })
    const [ada] = await getUserFavouriteDrinkTypes(db, 'ada', { limit: 1, now: NOW })

    expect(linn.slug).toBe('energy_050')
    expect(ada.slug).toBe('coffee')
  })

  it('leaves out deactivated drinks', async () => {
    await db.update(drinkTypes).set({ isActive: false }).where(eq(drinkTypes.slug, 'coffee'))

    const favourites = await getUserFavouriteDrinkTypes(db, 'ada', { limit: 4, now: NOW })
    expect(favourites.map((type) => type.slug)).not.toContain('coffee')
  })

  it('carries everything the log buttons need', async () => {
    const [first] = await getUserFavouriteDrinkTypes(db, 'ada', { limit: 1, now: NOW })
    expect(first).toMatchObject({
      slug: 'coffee',
      name: 'Coffee',
      category: 'coffee',
      caffeineMg: 95,
    })
    expect(first).toHaveProperty('volumeMl')
    expect(first).toHaveProperty('id')
  })

  // Bounded to a month so the scan stays small; a drink from long ago should
  // not outrank this week's habit.
  it('ignores drinks older than the recent window', async () => {
    // Linn's three energy drinks are on 2026-08-05, three weeks before NOW, so
    // a seven-day window must not let them top the row.
    const month = await getUserFavouriteDrinkTypes(db, 'linn', { limit: 1, now: NOW })
    const week = await getUserFavouriteDrinkTypes(db, 'linn', { limit: 1, now: NOW, days: 7 })

    expect(month[0].slug).toBe('energy_050')
    expect(week[0].slug).not.toBe('energy_050')
  })
})

describe('getTeamIntakeEvents', () => {
  const twelveHoursBack = new Date(NOW.getTime() - 12 * 60 * 60 * 1000)

  it('returns everyone’s drinks in the window, grouped by member', async () => {
    const groups = await getTeamIntakeEvents(db, { from: twelveHoursBack, now: NOW })
    const byUser = Object.fromEntries(groups.map((g) => [g.userId, g.doses.length]))

    // Ada: coffee 10:00 + energy 14:00. Linn: espresso 09:00. Bo: nothing.
    expect(byUser).toEqual({ ada: 2, linn: 1 })
  })

  it('carries each member’s own clearance profile', async () => {
    await db
      .update(members)
      .set({ eliminationHalfLifeMinutes: 150, sleepThresholdMg: 25 })
      .where(eq(members.userId, 'ada'))

    const groups = await getTeamIntakeEvents(db, { from: twelveHoursBack, now: NOW })
    const ada = groups.find((group) => group.userId === 'ada')!
    const linn = groups.find((group) => group.userId === 'linn')!

    expect(ada.profile.eliminationHalfLifeMs).toBe(150 * 60_000)
    // Untouched members stay on the population default.
    expect(linn.profile.eliminationHalfLifeMs).toBe(300 * 60_000)
  })

  it('leaves out members with nothing in the window', async () => {
    const groups = await getTeamIntakeEvents(db, { from: twelveHoursBack, now: NOW })
    expect(groups.map((group) => group.userId)).not.toContain('bo')
  })

  it('excludes drinks older than the window', async () => {
    const groups = await getTeamIntakeEvents(db, { from: twelveHoursBack, now: NOW })
    const all = groups.flatMap((group) => group.doses.map((dose) => dose.consumedAt))

    expect(all.every((at) => at.getTime() >= twelveHoursBack.getTime())).toBe(true)
  })

  it('is empty when nobody has had anything', async () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000)
    expect(await getTeamIntakeEvents(db, { from: future, now: future })).toEqual([])
  })

  it('reaches across the local date boundary like the personal one', async () => {
    const morning = oslo('2026-08-26', 8)
    await logDrink(db, { userId: 'bo', slug: 'coffee', now: oslo('2026-08-25', 23) })

    const groups = await getTeamIntakeEvents(db, {
      from: new Date(morning.getTime() - 12 * 60 * 60 * 1000),
      now: morning,
    })

    expect(groups.map((group) => group.userId)).toContain('bo')
  })
})
