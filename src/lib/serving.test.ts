import { describe, expect, it } from 'vitest'
import { scaleForVolume, sliderRange } from './serving'

const can = { caffeineMg: 160, volumeMl: 500 }
const espresso = { caffeineMg: 63, volumeMl: 30 }
const coffee = { caffeineMg: 95, volumeMl: null }

describe('scaleForVolume', () => {
  it('leaves the standard serving alone', () => {
    expect(scaleForVolume(can, null)).toBe(160)
    expect(scaleForVolume(coffee, null)).toBe(95)
  })

  it('scales linearly with volume', () => {
    expect(scaleForVolume(can, 250)).toBe(80)
    expect(scaleForVolume(can, 1000)).toBe(320)
    expect(scaleForVolume(espresso, 60)).toBe(126)
  })

  it('rounds to whole milligrams', () => {
    expect(Number.isInteger(scaleForVolume(can, 333))).toBe(true)
  })

  // Coffee has no serving size on the list, so there is nothing to scale from.
  it('is null for a drink with no standard serving', () => {
    expect(scaleForVolume(coffee, 400)).toBeNull()
  })

  it('is null rather than dividing by zero', () => {
    expect(scaleForVolume({ caffeineMg: 95, volumeMl: 0 }, 400)).toBeNull()
  })
})

describe('sliderRange', () => {
  /*
   * The bug this exists to prevent: a range of 125-1500 in steps of 10 goes
   * 125, 135, … 505, so a standard 500ml can reads as 505ml and 162mg and the
   * slider cannot return to the serving it started on.
   */
  it('always lands exactly on the standard serving', () => {
    for (const base of [30, 100, 120, 200, 250, 330, 500, 750, 1000]) {
      const { min, step } = sliderRange(base)
      expect((base - min) % step, `base ${base} unreachable`).toBe(0)
    }
  })

  it('snaps both bounds to the step', () => {
    for (const base of [30, 125, 250, 330, 500]) {
      const { min, max, step } = sliderRange(base)
      expect(min % step).toBe(0)
      expect(max % step).toBe(0)
    }
  })

  it('spans a quarter of the serving up to triple it', () => {
    expect(sliderRange(500)).toMatchObject({ min: 130, max: 1500, step: 10 })
  })

  it('uses a finer step for small servings', () => {
    expect(sliderRange(30).step).toBe(5)
    expect(sliderRange(500).step).toBe(10)
  })

  it('never offers a non-positive volume', () => {
    for (const base of [1, 5, 10, 30]) {
      expect(sliderRange(base).min).toBeGreaterThan(0)
    }
  })
})
