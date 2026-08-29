import { describe, expect, it } from 'vitest'
import {
  BADGES,
  badgeById,
  earnedBadgeIds,
  hasCleanMonth,
  longestStreakEndingToday,
  totalDrinks,
  type BadgeContext,
  type DayCount,
} from './badges'

const TODAY = '2026-08-26'

function context(over: Partial<BadgeContext> = {}): BadgeContext {
  return { localHour: 10, days: [], distinctTypeCount: null, today: TODAY, ...over }
}

/** `count` drinks a day on each of the `n` days ending on `to`. */
function run(n: number, to: string, count = 1): DayCount[] {
  const days: DayCount[] = []
  const end = new Date(`${to}T12:00:00Z`)
  for (let i = 0; i < n; i++) {
    const day = new Date(end.getTime() - i * 86_400_000)
    days.push({ localDate: day.toISOString().slice(0, 10), count })
  }
  return days
}

describe('totalDrinks', () => {
  it('sums the day counts', () => {
    expect(
      totalDrinks([
        { localDate: '2026-08-26', count: 3 },
        { localDate: '2026-08-25', count: 2 },
      ]),
    ).toBe(5)
  })

  it('is zero for a member who has logged nothing', () => {
    expect(totalDrinks([])).toBe(0)
  })
})

describe('longestStreakEndingToday', () => {
  it('counts consecutive days back from today', () => {
    expect(longestStreakEndingToday(run(3, TODAY), TODAY)).toBe(3)
  })

  it('counts back from yesterday when today is empty, so a streak is not lost mid-morning', () => {
    expect(longestStreakEndingToday(run(3, '2026-08-25'), TODAY)).toBe(3)
  })

  it('is zero when the most recent day is two days ago', () => {
    expect(longestStreakEndingToday(run(3, '2026-08-24'), TODAY)).toBe(0)
  })

  it('stops at a gap', () => {
    const days = [...run(2, TODAY), { localDate: '2026-08-22', count: 1 }]
    expect(longestStreakEndingToday(days, TODAY)).toBe(2)
  })
})

describe('hasCleanMonth', () => {
  it('is true when every day of a month was logged', () => {
    expect(hasCleanMonth(run(30, '2026-06-30'))).toBe(true)
  })

  it('is false when one day of the month is missing', () => {
    expect(hasCleanMonth(run(29, '2026-06-30'))).toBe(false)
  })

  it('is false for a month still in progress', () => {
    // August has 31 days; 26 of them is not a clean sweep yet.
    expect(hasCleanMonth(run(26, '2026-08-26'))).toBe(false)
  })
})

describe('badge predicates', () => {
  it('awards first-drop on the very first drink', () => {
    expect(earnedBadgeIds(context({ days: run(1, TODAY) }))).toContain('first-drop')
  })

  it('awards century at exactly 100 drinks and not at 99', () => {
    expect(badgeById('century').earned(context({ days: run(1, TODAY, 100) }))).toBe(true)
    expect(badgeById('century').earned(context({ days: run(1, TODAY, 99) }))).toBe(false)
  })

  it('awards dawn-patrol before seven and not at seven', () => {
    expect(badgeById('dawn-patrol').earned(context({ localHour: 6 }))).toBe(true)
    expect(badgeById('dawn-patrol').earned(context({ localHour: 7 }))).toBe(false)
  })

  it('awards night-shift at twenty-two and not at twenty-one', () => {
    expect(badgeById('night-shift').earned(context({ localHour: 22 }))).toBe(true)
    expect(badgeById('night-shift').earned(context({ localHour: 21 }))).toBe(false)
  })

  it('does not award an hour badge when there is no drink in hand', () => {
    expect(badgeById('dawn-patrol').earned(context({ localHour: null }))).toBe(false)
  })

  it('awards four-shots on a four-drink day', () => {
    expect(badgeById('four-shots').earned(context({ days: run(1, TODAY, 4) }))).toBe(true)
    expect(badgeById('four-shots').earned(context({ days: run(1, TODAY, 3) }))).toBe(false)
  })

  it('awards connoisseur at ten distinct types, and never without the count loaded', () => {
    expect(badgeById('connoisseur').earned(context({ distinctTypeCount: 10 }))).toBe(true)
    expect(badgeById('connoisseur').earned(context({ distinctTypeCount: 9 }))).toBe(false)
    expect(badgeById('connoisseur').earned(context({ distinctTypeCount: null }))).toBe(false)
  })

  it('never awards pioneer from a member context — the server grants it', () => {
    expect(badgeById('pioneer').earned(context({ days: run(500, TODAY, 10) }))).toBe(false)
  })

  it('is the only badge that needs the distinct-type count', () => {
    expect(BADGES.filter((badge) => badge.needsDistinctTypes).map((b) => b.id)).toEqual([
      'connoisseur',
    ])
  })

  it('reports progress towards counting badges', () => {
    expect(badgeById('century').progress(context({ days: run(1, TODAY, 40) }))).toEqual({
      have: 40,
      need: 100,
    })
  })

  it('reports no progress for a badge that is not a count', () => {
    expect(badgeById('dawn-patrol').progress(context())).toBeNull()
  })

  it('has no badge celebrating a large dose', () => {
    const wording = BADGES.map((b) => `${b.name} ${b.description}`.toLowerCase()).join(' ')
    expect(wording).not.toContain('400')
    expect(wording).not.toContain('limit')
  })
})
