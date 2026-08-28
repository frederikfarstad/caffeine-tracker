import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '@/db/test-db'
import { dailyTotals, drinkTypes, earnedBadges, members, users } from '@/db/schema'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import { deleteDrinkLog, logDrink, undoLastDrink } from './drinks'
import {
  findBadgeDrift,
  getBadgesFor,
  getBadgesForMany,
  getEarnedBadgeIds,
  rebuildBadges,
} from './badges'

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
    { userId: 'ada', displayName: 'Ada', joinedAt: oslo('2026-08-01', 9) },
    { userId: 'bo', displayName: 'Bo', joinedAt: oslo('2026-08-01', 9) },
  ])
  await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)
})

describe('awarding on log', () => {
  it('grants first-drop on the very first drink', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('first-drop')
  })

  it('grants dawn-patrol only for an early drink', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('dawn-patrol')

    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-27', 6) })
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('dawn-patrol')
  })

  it('is idempotent — logging again does not duplicate a badge', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 11) })

    const badges = await getBadgesFor(db, 'ada')
    expect(badges.filter((badge) => badge.badgeId === 'first-drop')).toHaveLength(1)
  })

  it('keeps the original earned_at when the badge is already held', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    const first = (await getBadgesFor(db, 'ada')).find((b) => b.badgeId === 'first-drop')

    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-27', 10) })
    const after = (await getBadgesFor(db, 'ada')).find((b) => b.badgeId === 'first-drop')

    expect(after?.earnedAt.getTime()).toBe(first?.earnedAt.getTime())
  })

  it('grants four-shots on the fourth drink of a day, not the third', async () => {
    for (const hour of [9, 10, 11]) {
      await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', hour) })
    }
    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('four-shots')

    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 12) })
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('four-shots')
  })

  it('grants week-straight on the seventh consecutive day', async () => {
    for (let day = 20; day <= 25; day++) {
      await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo(`2026-08-${day}`, 9) })
    }
    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('week-straight')

    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 9) })
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('week-straight')
  })

  it('does not disturb the caffeine rollup', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    const [summary] = await db
      .select()
      .from(dailyTotals)
      .where(eq(dailyTotals.userId, 'ada'))

    expect(summary?.totalMg).toBe(95)
  })
})

describe('pioneer', () => {
  it('goes to the author when somebody else logs their drink', async () => {
    await db.insert(drinkTypes).values({
      slug: 'ada_special',
      name: "Ada's special",
      category: 'other',
      caffeineMg: 80,
      createdBy: 'ada',
    })

    await logDrink(db, { userId: 'bo', slug: 'ada_special', now: oslo('2026-08-26', 10) })

    expect(await getEarnedBadgeIds(db, 'ada')).toContain('pioneer')
    expect(await getEarnedBadgeIds(db, 'bo')).not.toContain('pioneer')
  })

  it('does not go to the author for logging their own drink', async () => {
    await db.insert(drinkTypes).values({
      slug: 'ada_other',
      name: "Ada's other",
      category: 'other',
      caffeineMg: 80,
      createdBy: 'ada',
    })

    await logDrink(db, { userId: 'ada', slug: 'ada_other', now: oslo('2026-08-26', 10) })

    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('pioneer')
  })
})

describe('getBadgesForMany', () => {
  it('groups by member and leaves nobody out', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })

    const byMember = await getBadgesForMany(db, ['ada', 'bo'])

    expect(byMember.get('ada')?.map((b) => b.badgeId)).toContain('first-drop')
    expect(byMember.get('bo')).toEqual([])
  })

  it('asks nothing of the database for an empty list', async () => {
    expect(await getBadgesForMany(db, [])).toEqual(new Map())
  })
})

/*
 * Kept here rather than in a file of its own: the rebuild exists to prove the
 * invariant that awarding above relies on, and the two are only meaningful read
 * together.
 */
describe('rebuilding', () => {
  it('reproduces exactly what awarding produced', async () => {
    for (let day = 20; day <= 26; day++) {
      await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo(`2026-08-${day}`, 6) })
    }
    await logDrink(db, { userId: 'bo', slug: 'espresso', now: oslo('2026-08-26', 23) })

    const before = (await getEarnedBadgeIds(db, 'ada')).sort()
    expect(before.length).toBeGreaterThan(0)

    await rebuildBadges(db)

    expect((await getEarnedBadgeIds(db, 'ada')).sort()).toEqual(before)
    expect(await getEarnedBadgeIds(db, 'bo')).toContain('night-shift')
  })

  it('reports no drift on a healthy database', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    expect(await findBadgeDrift(db)).toEqual([])
  })

  it('reports a badge that was never earned', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    await db.insert(earnedBadges).values({
      userId: 'ada',
      badgeId: 'half-k',
      earnedAt: oslo('2026-08-26', 10),
    })

    expect(await findBadgeDrift(db)).toEqual([{ userId: 'ada', badgeId: 'half-k', stored: true }])
  })

  it('reports a badge that should have been earned but is missing', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    await db.delete(earnedBadges).where(eq(earnedBadges.userId, 'ada'))

    expect(await findBadgeDrift(db)).toContainEqual({
      userId: 'ada',
      badgeId: 'first-drop',
      stored: false,
    })
  })
})

describe('revoking', () => {
  it('takes the badge back when the drink that earned it is undone', async () => {
    const logged = await logDrink(db, {
      userId: 'ada',
      slug: 'coffee',
      now: oslo('2026-08-26', 6),
    })
    expect(logged.ok).toBe(true)
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('dawn-patrol')

    await undoLastDrink(db, { userId: 'ada', now: oslo('2026-08-26', 6) })

    expect(await getEarnedBadgeIds(db, 'ada')).toEqual([])
    expect(await findBadgeDrift(db)).toEqual([])
  })

  it('keeps a badge that the remaining drinks still justify', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 6) })
    await logDrink(db, { userId: 'ada', slug: 'espresso', now: oslo('2026-08-26', 7) })

    await undoLastDrink(db, { userId: 'ada', now: oslo('2026-08-26', 7) })

    expect(await getEarnedBadgeIds(db, 'ada')).toContain('dawn-patrol')
    expect(await findBadgeDrift(db)).toEqual([])
  })

  it('takes pioneer back from the author when the only log of their drink goes', async () => {
    await db.insert(drinkTypes).values({
      slug: 'ada_special',
      name: "Ada's special",
      category: 'other',
      caffeineMg: 80,
      createdBy: 'ada',
    })
    const logged = await logDrink(db, {
      userId: 'bo',
      slug: 'ada_special',
      now: oslo('2026-08-26', 10),
    })
    expect(logged.ok && logged.logId).toBeTruthy()
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('pioneer')

    if (logged.ok) await deleteDrinkLog(db, { userId: 'bo', logId: logged.logId })

    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('pioneer')
    expect(await findBadgeDrift(db)).toEqual([])
  })
})
