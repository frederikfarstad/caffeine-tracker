import { describe, expect, it } from 'vitest'
import {
  ABSORPTION_HALF_LIFE_MS,
  ELIMINATION_HALF_LIFE_MS,
  SLEEP_THRESHOLD_MG,
  bloodCaffeineCurve,
  bodyLoadAt,
  clearsBelowAt,
  curveWindow,
  sleepOutlook,
  type Dose,
} from './blood-caffeine'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** 10:00 Oslo time on a Wednesday. */
const now = new Date('2026-08-26T08:00:00Z')

function at(offsetMs: number): Date {
  return new Date(now.getTime() + offsetMs)
}

function dose(mg: number, offsetMs = 0): Dose {
  return { consumedAt: at(offsetMs), mg }
}

describe('reference values', () => {
  it('eliminates with a five-hour half-life', () => {
    expect(ELIMINATION_HALF_LIFE_MS).toBe(5 * HOUR)
  })

  it('absorbs an order of magnitude faster than it eliminates', () => {
    expect(ABSORPTION_HALF_LIFE_MS).toBeLessThan(ELIMINATION_HALF_LIFE_MS / 10)
  })
})

describe('bodyLoadAt', () => {
  it('is zero with nothing logged', () => {
    expect(bodyLoadAt([], now)).toBe(0)
  })

  it('is zero before the drink was drunk', () => {
    expect(bodyLoadAt([dose(95, 2 * HOUR)], now)).toBe(0)
  })

  // Nothing has crossed the gut wall at the moment of the first sip.
  it('is zero at the instant of the drink', () => {
    expect(bodyLoadAt([dose(95)], now)).toBe(0)
  })

  it('rises during absorption', () => {
    const early = bodyLoadAt([dose(95)], at(10 * MINUTE))
    const later = bodyLoadAt([dose(95)], at(30 * MINUTE))
    expect(later).toBeGreaterThan(early)
  })

  // Caffeine peaks 30-60 minutes after drinking, short of the full dose
  // because elimination has already begun.
  it('peaks under an hour in, below the dose itself', () => {
    const samples = Array.from({ length: 121 }, (_, minute) => ({
      minute,
      mg: bodyLoadAt([dose(100)], at(minute * MINUTE)),
    }))
    const peak = samples.reduce((best, sample) => (sample.mg > best.mg ? sample : best))

    expect(peak.minute).toBeGreaterThan(35)
    expect(peak.minute).toBeLessThan(60)
    expect(peak.mg).toBeGreaterThan(85)
    expect(peak.mg).toBeLessThan(92)
  })

  it('halves every elimination half-life once absorption is done', () => {
    const doses = [dose(200)]
    const threeHoursIn = bodyLoadAt(doses, at(3 * HOUR))
    const oneHalfLifeLater = bodyLoadAt(doses, at(3 * HOUR + ELIMINATION_HALF_LIFE_MS))

    expect(oneHalfLifeLater / threeHoursIn).toBeCloseTo(0.5, 3)
  })

  it('falls monotonically after the last drink', () => {
    const doses = [dose(95, -3 * HOUR), dose(160, -1 * HOUR)]
    const samples = Array.from({ length: 12 }, (_, i) => bodyLoadAt(doses, at(i * HOUR)))

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1])
    }
  })

  // Doses add: two coffees an hour apart are one curve, not two.
  it('sums the contributions of several drinks', () => {
    const morning = dose(95, -4 * HOUR)
    const lunch = dose(160, -1 * HOUR)

    expect(bodyLoadAt([morning, lunch], now)).toBeCloseTo(
      bodyLoadAt([morning], now) + bodyLoadAt([lunch], now),
      6,
    )
  })

  it('scales linearly with the size of the dose', () => {
    expect(bodyLoadAt([dose(200, -2 * HOUR)], now)).toBeCloseTo(
      2 * bodyLoadAt([dose(100, -2 * HOUR)], now),
      6,
    )
  })
})

describe('bloodCaffeineCurve', () => {
  const doses = [dose(95, -4 * HOUR), dose(160, -1 * HOUR)]
  const window = { from: at(-6 * HOUR), to: at(6 * HOUR), now }

  it('covers the window at the requested resolution', () => {
    const curve = bloodCaffeineCurve(doses, { ...window, stepMs: HOUR })

    expect(curve).toHaveLength(13)
    expect(curve[0].at).toBe(window.from.getTime())
    expect(curve.at(-1)?.at).toBe(window.to.getTime())
  })

  // The solid and dashed halves have to meet, so `now` must be a sample.
  it('always samples the present instant', () => {
    const curve = bloodCaffeineCurve(doses, { ...window, stepMs: 37 * MINUTE })
    expect(curve.some((point) => point.at === now.getTime())).toBe(true)
  })

  it('marks everything after now as projected, and nothing before', () => {
    const curve = bloodCaffeineCurve(doses, { ...window, stepMs: HOUR })

    expect(curve.filter((point) => point.at < now.getTime()).every((p) => !p.projected)).toBe(true)
    expect(curve.filter((point) => point.at > now.getTime()).every((p) => p.projected)).toBe(true)
  })

  // The joining sample belongs to the measured half; the chart draws the dashed
  // series from it so the two lines touch.
  it('counts the present instant as measured, not projected', () => {
    const curve = bloodCaffeineCurve(doses, { ...window, stepMs: HOUR })
    expect(curve.find((point) => point.at === now.getTime())?.projected).toBe(false)
  })

  it('agrees with bodyLoadAt at every sample', () => {
    const curve = bloodCaffeineCurve(doses, { ...window, stepMs: HOUR })

    for (const point of curve) {
      expect(point.mg).toBeCloseTo(bodyLoadAt(doses, new Date(point.at)), 6)
    }
  })

  it('is a flat zero line with nothing logged', () => {
    const curve = bloodCaffeineCurve([], { ...window, stepMs: HOUR })
    expect(curve.every((point) => point.mg === 0)).toBe(true)
  })

  it('is ordered in time', () => {
    const curve = bloodCaffeineCurve(doses, { ...window, stepMs: 20 * MINUTE })
    const times = curve.map((point) => point.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe('clearsBelowAt', () => {
  it('is the present instant when already below the threshold', () => {
    const found = clearsBelowAt([dose(95, -12 * HOUR)], { from: now })
    expect(found).toEqual(now)
  })

  it('is the present instant with nothing in the system', () => {
    expect(clearsBelowAt([], { from: now })).toEqual(now)
  })

  it('finds a future instant when the load is still high', () => {
    const found = clearsBelowAt([dose(400, -30 * MINUTE)], { from: now })

    expect(found).not.toBeNull()
    expect(found!.getTime()).toBeGreaterThan(now.getTime())
  })

  it('returns an instant at which the load really is below the threshold', () => {
    const doses = [dose(400, -30 * MINUTE)]
    const found = clearsBelowAt(doses, { from: now })

    expect(bodyLoadAt(doses, found!)).toBeLessThanOrEqual(SLEEP_THRESHOLD_MG)
  })

  it('returns the first such instant, not a later one', () => {
    const doses = [dose(400, -30 * MINUTE)]
    const found = clearsBelowAt(doses, { from: now, stepMs: 10 * MINUTE })
    const tenMinutesEarlier = new Date(found!.getTime() - 10 * MINUTE)

    expect(bodyLoadAt(doses, tenMinutesEarlier)).toBeGreaterThan(SLEEP_THRESHOLD_MG)
  })

  it('honours a threshold other than the sleep one', () => {
    const doses = [dose(200, -30 * MINUTE)]
    const toTwentyFive = clearsBelowAt(doses, { from: now, threshold: 25 })
    const toHundred = clearsBelowAt(doses, { from: now, threshold: 100 })

    expect(toTwentyFive!.getTime()).toBeGreaterThan(toHundred!.getTime())
  })

  // A pathological pile of caffeine must not search forever.
  it('gives up past the horizon', () => {
    const found = clearsBelowAt([dose(5000, -HOUR)], { from: now, horizonMs: 2 * HOUR })
    expect(found).toBeNull()
  })
})

describe('curveWindow', () => {
  // Starting a fixed twelve hours back would spend half the plot on a flat
  // zero line before the first coffee of the day.
  it('starts shortly before the first drink in range', () => {
    const { from } = curveWindow([dose(95, -2 * HOUR), dose(63, -1 * HOUR)], now)
    expect(from).toEqual(at(-2 * HOUR - 30 * MINUTE))
  })

  it('looks no further back than twelve hours', () => {
    const { from } = curveWindow([dose(95, -20 * HOUR)], now)
    expect(from).toEqual(at(-12 * HOUR))
  })

  it('still spans twelve hours back with nothing logged', () => {
    const { from } = curveWindow([], now)
    expect(from).toEqual(at(-12 * HOUR))
  })

  it('shows an hour ahead when there is nothing left to project', () => {
    const { to } = curveWindow([], now)
    expect(to).toEqual(at(HOUR))
  })

  it('runs past the point the load clears the sleep threshold', () => {
    const doses = [dose(160, -30 * MINUTE)]
    const { to } = curveWindow(doses, now)
    const crossing = clearsBelowAt(doses, { from: now })!

    expect(to.getTime()).toBeGreaterThan(crossing.getTime())
  })

  it('never projects more than twelve hours ahead', () => {
    const { to } = curveWindow([dose(5000, -HOUR)], now)
    expect(to).toEqual(at(12 * HOUR))
  })
})

describe('sleepOutlook', () => {
  it('is already clear when nothing is in the system', () => {
    expect(sleepOutlook([], now)).toEqual({ kind: 'clear' })
  })

  it('is already clear when the load sits below the threshold', () => {
    expect(sleepOutlook([dose(95, -12 * HOUR)], now)).toEqual({ kind: 'clear' })
  })

  it('reports when a recent drink will clear', () => {
    const outlook = sleepOutlook([dose(160, -30 * MINUTE)], now)

    expect(outlook.kind).toBe('clears')
    if (outlook.kind !== 'clears') throw new Error('unreachable')
    expect(outlook.at.getTime()).toBeGreaterThan(now.getTime())
    expect(bodyLoadAt([dose(160, -30 * MINUTE)], outlook.at)).toBeLessThanOrEqual(
      SLEEP_THRESHOLD_MG,
    )
  })

  // A crossing the chart cannot show must not be quoted as if it could.
  it('refuses to name a time beyond the projection window', () => {
    expect(sleepOutlook([dose(600, -30 * MINUTE)], now)).toEqual({ kind: 'not-tonight' })
  })

  it('never names a time past the end of the curve window', () => {
    const doses = [dose(200, -30 * MINUTE)]
    const outlook = sleepOutlook(doses, now)

    if (outlook.kind !== 'clears') throw new Error('unreachable')
    expect(outlook.at.getTime()).toBeLessThanOrEqual(curveWindow(doses, now).to.getTime())
  })
})
