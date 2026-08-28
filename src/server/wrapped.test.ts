import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '@/db/test-db'
import { drinkTypes, members, users } from '@/db/schema'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import { logDrink } from './drinks'
import { getWrapped, markWrappedSeen } from './wrapped'

let db: TestDb

function oslo(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour - 2).padStart(2, '0')}:00:00Z`)
}

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(users).values([
    { id: 'ada', name: 'Ada', email: 'ada@example.com' },
    { id: 'bo', name: 'Bo', email: 'bo@example.com' },
  ])
  await db.insert(members).values([
    { userId: 'ada', displayName: 'Ada', joinedAt: oslo('2026-07-01', 9) },
    { userId: 'bo', displayName: 'Bo', joinedAt: oslo('2026-07-01', 9) },
  ])
  await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)

  // Ada, through July: three coffees on consecutive days and one energy drink.
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-07-02', 9) }) // 95
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-07-03', 9) }) // 95
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-07-04', 9) }) // 95
  await logDrink(db, { userId: 'ada', slug: 'energy_050', now: oslo('2026-07-04', 14) }) // 160

  // Bo, quieter, and one drink in August that must not leak into July.
  await logDrink(db, { userId: 'bo', slug: 'espresso', now: oslo('2026-07-02', 9) }) // 63
  await logDrink(db, { userId: 'bo', slug: 'coffee', now: oslo('2026-08-02', 9) }) // 95
})

describe('getWrapped', () => {
  it('totals the month and nothing outside it', async () => {
    const wrapped = await getWrapped(db, 'ada', '2026-07')

    expect(wrapped).toMatchObject({
      month: '2026-07',
      totalMg: 445,
      drinkCount: 4,
      coffeeCount: 3,
      energyCount: 1,
      activeDays: 3,
    })
  })

  it('excludes a drink from the following month', async () => {
    expect((await getWrapped(db, 'bo', '2026-07'))?.totalMg).toBe(63)
  })

  it('names the biggest day', async () => {
    // The 4th: a coffee and an energy drink, 255 mg.
    expect((await getWrapped(db, 'ada', '2026-07'))?.biggestDay).toEqual({
      localDate: '2026-07-04',
      mg: 255,
    })
  })

  it('names the most-logged drink', async () => {
    expect((await getWrapped(db, 'ada', '2026-07'))?.favourite).toEqual({
      name: 'Coffee',
      count: 3,
    })
  })

  it('finds the hour with the most drinks', async () => {
    expect((await getWrapped(db, 'ada', '2026-07'))?.peakHour).toBe(9)
  })

  it('ranks within the month', async () => {
    expect((await getWrapped(db, 'ada', '2026-07'))?.rank).toBe(1)
    expect((await getWrapped(db, 'bo', '2026-07'))?.rank).toBe(2)
  })

  it('counts the longest streak inside the month', async () => {
    // The 2nd, 3rd and 4th.
    expect((await getWrapped(db, 'ada', '2026-07'))?.longestStreak).toBe(3)
  })

  it('does not run a streak past the end of the month', async () => {
    await logDrink(db, { userId: 'bo', slug: 'coffee', now: oslo('2026-08-01', 9) })
    // Bo logged on 2 July, then 1 and 2 August. July's streak is one day.
    expect((await getWrapped(db, 'bo', '2026-07'))?.longestStreak).toBe(1)
  })

  it('reports the team total alongside the personal one', async () => {
    expect((await getWrapped(db, 'ada', '2026-07'))?.teamMg).toBe(508)
  })

  it('is null for a member who logged nothing that month', async () => {
    expect(await getWrapped(db, 'bo', '2026-06')).toBeNull()
  })

  it('is null for a month nobody was here for', async () => {
    expect(await getWrapped(db, 'ada', '2025-01')).toBeNull()
  })

  it('reports only the badges earned inside the month', async () => {
    const july = await getWrapped(db, 'ada', '2026-07')
    const august = await getWrapped(db, 'bo', '2026-08')

    // Ada's first-drop was earned on 2 July; Bo's on 2 July as well, so his
    // August wrapped lists none.
    expect(july?.badgeIds).toContain('first-drop')
    expect(august?.badgeIds).toEqual([])
  })
})

describe('markWrappedSeen', () => {
  it('records the month', async () => {
    await markWrappedSeen(db, 'ada', '2026-07')

    const [row] = await db.select().from(members).where(eq(members.userId, 'ada'))
    expect(row.lastSeenWrapped).toBe('2026-07')
  })

  it('never moves the marker backwards, so reading an old month cannot re-arm the dialog', async () => {
    await markWrappedSeen(db, 'ada', '2026-07')
    await markWrappedSeen(db, 'ada', '2026-06')

    const [row] = await db.select().from(members).where(eq(members.userId, 'ada'))
    expect(row.lastSeenWrapped).toBe('2026-07')
  })

  it('moves it forwards', async () => {
    await markWrappedSeen(db, 'ada', '2026-07')
    await markWrappedSeen(db, 'ada', '2026-08')

    const [row] = await db.select().from(members).where(eq(members.userId, 'ada'))
    expect(row.lastSeenWrapped).toBe('2026-08')
  })
})
