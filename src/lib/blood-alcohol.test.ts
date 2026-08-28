import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BODY_PROFILE,
  bacAt,
  bloodAlcoholCurve,
  bodyProfileFrom,
  curveWindow,
  drivingOutlook,
  soberAt,
  type AlcoholDose,
} from './blood-alcohol'

const HOUR = 3_600_000
const MINUTE = 60_000

/** 20:00 Oslo on a Friday. */
const evening = new Date('2026-08-28T18:00:00Z')

function at(hoursFromEvening: number): Date {
  return new Date(evening.getTime() + hoursFromEvening * HOUR)
}

/** One half-litre at 4.7%, near enough 18.5 g. */
const pint = (when: Date): AlcoholDose => ({ consumedAt: when, grams: 18.54 })

describe('bacAt', () => {
  it('is zero before the first drink', () => {
    expect(bacAt([pint(evening)], at(-1))).toBe(0)
  })

  it('is still near zero at the moment of drinking, because absorption takes time', () => {
    expect(bacAt([pint(evening)], evening)).toBeLessThan(0.01)
  })

  it('peaks between 30 and 45 minutes after a single drink', () => {
    const samples = []
    for (let m = 0; m <= 120; m += 1) {
      samples.push({ m, bac: bacAt([pint(evening)], new Date(evening.getTime() + m * MINUTE)) })
    }
    const peak = samples.reduce((best, s) => (s.bac > best.bac ? s : best))
    expect(peak.m).toBeGreaterThanOrEqual(30)
    expect(peak.m).toBeLessThanOrEqual(45)
  })

  it('reaches a plausible level for three pints on an average body', () => {
    const doses = [pint(evening), pint(at(0.5)), pint(at(1))]
    const bac = bacAt(doses, at(2))
    expect(bac).toBeGreaterThan(0.5)
    expect(bac).toBeLessThan(1.2)
  })
})

describe('elimination', () => {
  it('is linear once absorption is done — equal falls over equal hours', () => {
    // Four pints, sampled from four hours on: enough alcohol that the level is
    // still far from the floor, and late enough that the absorption tail has
    // died away. Sampled at two hours instead, the last drink still has 0.04 g
    // in the gut and the fall comes out measurably short of 0.15.
    const doses = [pint(evening), pint(at(0.25)), pint(at(0.5)), pint(at(0.75))]
    const a = bacAt(doses, at(4))
    const b = bacAt(doses, at(5))
    const c = bacAt(doses, at(6))
    expect(a - b).toBeCloseTo(b - c, 4)
    expect(a - b).toBeCloseTo(0.15, 3)
  })

  it('reaches exactly zero and stays there, rather than decaying asymptotically', () => {
    const doses = [pint(evening)]
    expect(bacAt(doses, at(12))).toBe(0)
    expect(bacAt(doses, at(24))).toBe(0)
  })
})

describe('superposition', () => {
  it('does not hold — the shared clearance rate is not per-dose', () => {
    const together = bacAt([pint(evening), pint(at(1))], at(3))
    const apart = bacAt([pint(evening)], at(3)) + bacAt([pint(at(1))], at(3))

    // The first pint on its own has hit the floor by three hours, so summing
    // lone curves throws its alcohol away entirely. Drunk together, the
    // constant clearance is applied once to the pair rather than once to each,
    // and the pair is still going.
    expect(bacAt([pint(evening)], at(3))).toBe(0)
    expect(together).toBeGreaterThan(apart * 2)
  })
})

describe('window independence', () => {
  it('reads the same at an instant however early the window starts', () => {
    const doses = [pint(evening), pint(at(1))]
    const target = at(2)

    const early = bloodAlcoholCurve(doses, {
      from: at(-4),
      to: at(3),
      now: target,
      stepMs: 10 * MINUTE,
    })
    const late = bloodAlcoholCurve(doses, {
      from: at(1.5),
      to: at(3),
      now: target,
      stepMs: 10 * MINUTE,
    })

    const pick = (points: { at: number; bac: number }[]) =>
      points.find((p) => p.at === target.getTime())!.bac

    // Starting the window after the first drink must not invent a sober body.
    expect(pick(late)).toBeCloseTo(pick(early), 3)
    expect(pick(late)).toBeGreaterThan(0.2)
  })
})

describe('bodyProfileFrom', () => {
  it('falls back to an average adult when nothing is set, and says so', () => {
    const profile = bodyProfileFrom({ bodyWeightKg: null, sex: null })
    expect(profile).toEqual(DEFAULT_BODY_PROFILE)
    expect(profile.personal).toBe(false)
  })

  it('is personal as soon as either field is given', () => {
    expect(bodyProfileFrom({ bodyWeightKg: 62, sex: null }).personal).toBe(true)
    expect(bodyProfileFrom({ bodyWeightKg: null, sex: 'female' }).personal).toBe(true)
  })

  it('uses the conventional Widmark ratios', () => {
    expect(bodyProfileFrom({ bodyWeightKg: 80, sex: 'male' }).widmarkRatio).toBe(0.68)
    expect(bodyProfileFrom({ bodyWeightKg: 60, sex: 'female' }).widmarkRatio).toBe(0.55)
  })

  it('keeps the average ratio when only weight is known', () => {
    expect(bodyProfileFrom({ bodyWeightKg: 95, sex: null }).widmarkRatio).toBe(0.615)
  })
})

describe('the profile changes the answer', () => {
  it('gives a heavier person a lower peak on the same drinks', () => {
    const doses = [pint(evening), pint(at(0.5))]
    const light = bacAt(doses, at(1), bodyProfileFrom({ bodyWeightKg: 55, sex: 'female' }))
    const heavy = bacAt(doses, at(1), bodyProfileFrom({ bodyWeightKg: 110, sex: 'male' }))
    expect(heavy).toBeLessThan(light)
  })
})

describe('soberAt', () => {
  it('does not call someone sober while a drink is still being absorbed', () => {
    // Two minutes after the pint the blood is still near zero and rising.
    const justDrunk = new Date(evening.getTime() + 2 * MINUTE)
    const when = soberAt([pint(evening)], { from: justDrunk })
    expect(when).not.toBeNull()
    expect(when!.getTime()).toBeGreaterThan(justDrunk.getTime() + HOUR)
  })

  it('returns null rather than a fabricated time beyond the horizon', () => {
    const many = Array.from({ length: 20 }, (_, i) => pint(at(i * 0.25)))
    expect(soberAt(many, { from: evening, horizonMs: 2 * HOUR })).toBeNull()
  })

  it('finds the crossing of an arbitrary threshold', () => {
    const doses = [pint(evening), pint(at(0.5))]
    const when = soberAt(doses, { from: at(1), threshold: 0.2 })
    expect(when).not.toBeNull()
    expect(bacAt(doses, when!)).toBeLessThanOrEqual(0.2 + 0.01)
  })
})

describe('curveWindow', () => {
  it('starts just before the first drink rather than a fixed span back', () => {
    const { from } = curveWindow([pint(at(-1))], evening)
    expect(from.getTime()).toBeGreaterThan(at(-2).getTime())
    expect(from.getTime()).toBeLessThan(at(-1).getTime())
  })

  it('still gives an axis when nothing has been drunk', () => {
    const { from, to } = curveWindow([], evening)
    expect(to.getTime()).toBeGreaterThan(from.getTime())
  })
})

describe('drivingOutlook', () => {
  it('is clear when nothing has been drunk', () => {
    expect(drivingOutlook([], evening).kind).toBe('clear')
  })

  it('names a time when the evening will clear inside the window', () => {
    const outlook = drivingOutlook([pint(evening)], at(0.75))
    expect(outlook.kind).toBe('clears')
  })

  it('says not tonight rather than quoting a time off the edge of the plot', () => {
    const many = Array.from({ length: 12 }, (_, i) => pint(at(i * 0.25)))
    expect(drivingOutlook(many, at(3)).kind).toBe('not-tonight')
  })
})

describe('bloodAlcoholCurve', () => {
  it('always samples now, so the solid and dashed halves meet', () => {
    const now = at(1)
    const points = bloodAlcoholCurve([pint(evening)], { from: at(-1), to: at(4), now })
    expect(points.some((p) => p.at === now.getTime())).toBe(true)
  })

  it('marks everything after now as projected, and now itself as measured', () => {
    const now = at(1)
    const points = bloodAlcoholCurve([pint(evening)], { from: at(-1), to: at(4), now })
    expect(points.find((p) => p.at === now.getTime())!.projected).toBe(false)
    expect(points.filter((p) => p.at > now.getTime()).every((p) => p.projected)).toBe(true)
  })

  it('is sorted and stays inside the window', () => {
    const points = bloodAlcoholCurve([pint(evening)], { from: at(-1), to: at(4), now: at(1) })
    const times = points.map((p) => p.at)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(times[0]).toBe(at(-1).getTime())
    expect(times[times.length - 1]).toBe(at(4).getTime())
  })
})
