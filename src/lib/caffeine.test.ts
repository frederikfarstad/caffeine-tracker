import { describe, expect, it } from 'vitest'
import {
  APPROACHING_FRACTION,
  CATEGORY_LABELS,
  DAILY_MAX_MG,
  SINGLE_DOSE_MAX_MG,
  formatMg,
  fractionOfDailyMax,
  limitHeadline,
  limitStatus,
} from './caffeine'

describe('reference values', () => {
  // EFSA's 2015 scientific opinion on caffeine: 400mg/day and 200mg in a
  // single dose are the thresholds with no identified safety concern for
  // healthy adults.
  it('uses the EFSA daily reference of 400mg', () => {
    expect(DAILY_MAX_MG).toBe(400)
  })

  it('uses the EFSA single-dose reference of 200mg', () => {
    expect(SINGLE_DOSE_MAX_MG).toBe(200)
  })

  it('warns at three quarters of the daily reference', () => {
    expect(APPROACHING_FRACTION).toBe(0.75)
  })
})

describe('limitStatus', () => {
  it('is ok for an empty day', () => {
    expect(limitStatus(0)).toBe('ok')
  })

  it('is ok just below the warning threshold', () => {
    expect(limitStatus(299)).toBe('ok')
  })

  it('starts warning exactly at 300mg', () => {
    expect(limitStatus(300)).toBe('approaching')
  })

  it('is still only approaching at 399mg', () => {
    expect(limitStatus(399)).toBe('approaching')
  })

  it('is over exactly at the 400mg reference', () => {
    expect(limitStatus(400)).toBe('over')
  })

  it('stays over well above the reference', () => {
    expect(limitStatus(1200)).toBe('over')
  })

  it('treats negative input as ok rather than throwing', () => {
    expect(limitStatus(-10)).toBe('ok')
  })
})

describe('fractionOfDailyMax', () => {
  it('is 0 for an empty day', () => {
    expect(fractionOfDailyMax(0)).toBe(0)
  })

  it('is 0.5 at half the reference', () => {
    expect(fractionOfDailyMax(200)).toBe(0.5)
  })

  it('is 1 at the reference', () => {
    expect(fractionOfDailyMax(400)).toBe(1)
  })

  // The meter is a bar; letting the fraction exceed 1 would overflow it.
  it('clamps above the reference so the meter cannot overflow', () => {
    expect(fractionOfDailyMax(800)).toBe(1)
  })

  it('clamps below zero', () => {
    expect(fractionOfDailyMax(-50)).toBe(0)
  })
})

describe('formatMg', () => {
  it('appends the unit', () => {
    expect(formatMg(340)).toBe('340 mg')
  })

  it('rounds to whole milligrams', () => {
    expect(formatMg(340.4)).toBe('340 mg')
    expect(formatMg(340.6)).toBe('341 mg')
  })

  it('formats zero', () => {
    expect(formatMg(0)).toBe('0 mg')
  })
})

describe('limitHeadline', () => {
  // Copy is deliberately factual. A tracker that nags gets closed and
  // forgotten, and the app has no business telling anyone how to feel.
  it('states the remaining amount while under the reference', () => {
    expect(limitHeadline(150)).toContain('250 mg')
  })

  it('names the reference once over it, without moralising', () => {
    const headline = limitHeadline(450)
    expect(headline).toContain('400 mg')
    expect(headline).not.toMatch(/slow down|too much|careful|should/i)
  })

  it('gives every status a non-empty headline', () => {
    for (const mg of [0, 299, 300, 399, 400, 900]) {
      expect(limitHeadline(mg).length).toBeGreaterThan(0)
    }
  })
})

describe('CATEGORY_LABELS', () => {
  it('labels every drink category', () => {
    expect(CATEGORY_LABELS.coffee).toBeTruthy()
    expect(CATEGORY_LABELS.energy).toBeTruthy()
    expect(CATEGORY_LABELS.other).toBeTruthy()
  })
})
