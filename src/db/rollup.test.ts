import { beforeEach, describe, expect, it } from 'vitest'
import { dailyTotals, drinkLogs, drinkTypes, users } from './schema'
import { findRollupDrift, rebuildRollup } from './rollup'
import { createTestDb, type TestDb } from './test-db'

let db: TestDb

async function seedLog(overrides: Partial<typeof drinkLogs.$inferInsert> = {}) {
  await db.insert(drinkLogs).values({
    userId: 'u1',
    drinkTypeId: 1,
    caffeineMg: 95,
    category: 'coffee',
    consumedAt: new Date('2026-08-26T08:00:00Z'),
    createdAt: new Date('2026-08-26T08:00:00Z'),
    localDate: '2026-08-26',
    localHour: 10,
    ...overrides,
  })
}

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(users).values([
    { id: 'u1', name: 'Ada', email: 'ada@example.com' },
    { id: 'u2', name: 'Linn', email: 'linn@example.com' },
  ])
  await db.insert(drinkTypes).values([
    { id: 1, slug: 'coffee', name: 'Coffee', category: 'coffee', caffeineMg: 95, sortOrder: 10 },
    {
      id: 2,
      slug: 'energy_050',
      name: 'Energy drink 0.5L',
      category: 'energy',
      volumeMl: 500,
      caffeineMg: 160,
      sortOrder: 40,
    },
  ])
})

describe('rebuildRollup', () => {
  it('produces nothing from an empty log table', async () => {
    expect(await rebuildRollup(db)).toBe(0)
  })

  it('aggregates milligrams and counts per user per day', async () => {
    await seedLog()
    await seedLog()
    await seedLog({ drinkTypeId: 2, caffeineMg: 160, category: 'energy' })
    await seedLog({ userId: 'u2', localDate: '2026-08-26' })
    await seedLog({ localDate: '2026-08-25' })

    const rows = await rebuildRollup(db)
    expect(rows).toBe(3) // u1 on two dates, u2 on one

    const stored = await db
      .select()
      .from(dailyTotals)
      .orderBy(dailyTotals.userId, dailyTotals.localDate)

    expect(stored).toEqual([
      {
        userId: 'u1',
        localDate: '2026-08-25',
        totalMg: 95,
        coffeeMg: 95,
        energyMg: 0,
        otherMg: 0,
        coffeeCount: 1,
        energyCount: 0,
        otherCount: 0,
      },
      {
        userId: 'u1',
        localDate: '2026-08-26',
        totalMg: 350,
        coffeeMg: 190,
        energyMg: 160,
        otherMg: 0,
        coffeeCount: 2,
        energyCount: 1,
        otherCount: 0,
      },
      {
        userId: 'u2',
        localDate: '2026-08-26',
        totalMg: 95,
        coffeeMg: 95,
        energyMg: 0,
        otherMg: 0,
        coffeeCount: 1,
        energyCount: 0,
        otherCount: 0,
      },
    ])
  })

  it('is idempotent', async () => {
    await seedLog()
    await rebuildRollup(db)
    await rebuildRollup(db)
    expect(await findRollupDrift(db)).toEqual([])
  })
})

describe('findRollupDrift', () => {
  it('reports nothing when the rollup is correct', async () => {
    await seedLog()
    await rebuildRollup(db)
    expect(await findRollupDrift(db)).toEqual([])
  })

  it('reports a row the rollup is missing entirely', async () => {
    await seedLog()
    // No rebuild: the log exists but daily_totals is empty.
    const drift = await findRollupDrift(db)
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({
      userId: 'u1',
      localDate: '2026-08-26',
      storedMg: null,
      computedMg: 95,
    })
  })

  it('reports a stale total', async () => {
    await seedLog()
    await rebuildRollup(db)
    await seedLog() // second coffee, rollup not updated
    const drift = await findRollupDrift(db)
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({ storedMg: 95, computedMg: 190 })
  })

  it('reports a rollup row with no logs behind it', async () => {
    await seedLog()
    await rebuildRollup(db)
    await db.delete(drinkLogs)
    const drift = await findRollupDrift(db)
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({ storedMg: 95, computedMg: null })
  })
})
