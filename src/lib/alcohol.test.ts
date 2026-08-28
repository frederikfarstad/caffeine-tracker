import { describe, expect, it } from 'vitest'
import {
  DRIVING_LIMIT_PERMILLE,
  bacHeadline,
  bacStatus,
  formatPermille,
  formatUnits,
  gramsOfAlcohol,
  unitsFrom,
} from './alcohol'

describe('gramsOfAlcohol', () => {
  it('multiplies volume by strength by ethanol density', () => {
    // A half-litre at 4.7%: 500 * 0.047 * 0.789.
    expect(gramsOfAlcohol({ volumeMl: 500, abvPercent: 4.7 })).toBeCloseTo(18.54, 2)
  })

  it('gives a glass of wine and a spirit measure roughly one unit each', () => {
    expect(gramsOfAlcohol({ volumeMl: 150, abvPercent: 12 })).toBeCloseTo(14.2, 1)
    expect(gramsOfAlcohol({ volumeMl: 40, abvPercent: 40 })).toBeCloseTo(12.62, 2)
  })

  it('is zero for an alcohol-free drink', () => {
    expect(gramsOfAlcohol({ volumeMl: 330, abvPercent: 0 })).toBe(0)
  })
})

describe('unitsFrom', () => {
  it('counts a Norwegian standard unit as 12.8 grams', () => {
    expect(unitsFrom(12.8)).toBeCloseTo(1, 5)
    expect(unitsFrom(25.6)).toBeCloseTo(2, 5)
  })
})

describe('formatUnits', () => {
  it('shows one decimal, because half units are the whole point', () => {
    expect(formatUnits(18.54)).toBe('1.4 units')
  })

  it('says one unit in the singular', () => {
    expect(formatUnits(12.8)).toBe('1 unit')
  })

  it('says none rather than 0.0 units', () => {
    expect(formatUnits(0)).toBe('Nothing yet')
  })
})

describe('formatPermille', () => {
  it('shows two decimals, the resolution the limit is written at', () => {
    expect(formatPermille(0.42)).toBe('0.42 ‰')
    expect(formatPermille(0)).toBe('0.00 ‰')
  })
})

describe('bacStatus', () => {
  it('is clear below the driving limit', () => {
    expect(bacStatus(0.19)).toBe('clear')
  })

  it('is over the limit at exactly the limit, not just past it', () => {
    expect(bacStatus(DRIVING_LIMIT_PERMILLE)).toBe('over-limit')
  })

  it('is heavy from one permille', () => {
    expect(bacStatus(1)).toBe('heavy')
  })
})

describe('bacHeadline', () => {
  it('never tells anyone they are fine to drive', () => {
    for (const bac of [0, 0.05, 0.19, 0.2, 0.9, 1.4]) {
      expect(bacHeadline(bac).toLowerCase()).not.toMatch(/fine to drive|safe to drive|ok to drive/)
    }
  })

  it('names the legal limit once past it', () => {
    expect(bacHeadline(0.6)).toContain('0.2')
  })
})
