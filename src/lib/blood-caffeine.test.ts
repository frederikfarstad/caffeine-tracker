import { describe, expect, it } from 'vitest'
import {
  ABSORPTION_HALF_LIFE_MS,
  DEFAULT_PROFILE,
  ELIMINATION_HALF_LIFE_MS,
  SLEEP_THRESHOLD_MG,
  bloodCaffeineCurve,
  bodyLoadAt,
  combinedCaffeineCurve,
  combinedLoadAt,
  clearsBelowAt,
  curveWindow,
  lastCallBefore,
  sleepOutlook,
  type Dose,
  type Profile,
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

describe('per-person profiles', () => {
  const fast: Profile = { eliminationHalfLifeMs: 2.5 * HOUR, sleepThresholdMg: 50 }
  const slow: Profile = { eliminationHalfLifeMs: 10 * HOUR, sleepThresholdMg: 50 }

  it('defaults to the typical adult profile', () => {
    expect(DEFAULT_PROFILE).toEqual({
      eliminationHalfLifeMs: ELIMINATION_HALF_LIFE_MS,
      sleepThresholdMg: SLEEP_THRESHOLD_MG,
    })
  })

  it('leaves the load unchanged when the default profile is passed explicitly', () => {
    const doses = [dose(95, -3 * HOUR)]
    expect(bodyLoadAt(doses, now, DEFAULT_PROFILE)).toBeCloseTo(bodyLoadAt(doses, now), 9)
  })

  it('halves every half-life the profile names, not every five hours', () => {
    const doses = [dose(200, -3 * HOUR)]
    const atNow = bodyLoadAt(doses, now, fast)
    const oneHalfLifeLater = bodyLoadAt(doses, at(fast.eliminationHalfLifeMs), fast)

    expect(oneHalfLifeLater / atNow).toBeCloseTo(0.5, 3)
  })

  it('leaves less in a fast clearer than in a slow one', () => {
    const doses = [dose(200, -4 * HOUR)]
    expect(bodyLoadAt(doses, now, fast)).toBeLessThan(bodyLoadAt(doses, now, slow))
  })

  /*
   * Absorption is not self-reportable and varies far less, so its rate constant
   * stays fixed. That does not mean the peak lands at the same minute: a slow
   * clearer has eliminated less by the time absorption finishes, so its peak
   * arrives later and higher. Both must stay inside the 15-120 minute window
   * the literature reports for peak plasma caffeine.
   */
  it('keeps the peak inside the observed window for any clearance rate', () => {
    const peak = (profile: Profile) => {
      const samples = Array.from({ length: 121 }, (_, minute) => ({
        minute,
        mg: bodyLoadAt([dose(100)], at(minute * MINUTE), profile),
      }))
      return samples.reduce((best, s) => (s.mg > best.mg ? s : best))
    }

    for (const profile of [fast, DEFAULT_PROFILE, slow]) {
      expect(peak(profile).minute).toBeGreaterThan(15)
      expect(peak(profile).minute).toBeLessThan(120)
    }
  })

  it('peaks later and higher for a slow clearer than a fast one', () => {
    const peak = (profile: Profile) => {
      const samples = Array.from({ length: 121 }, (_, minute) => ({
        minute,
        mg: bodyLoadAt([dose(100)], at(minute * MINUTE), profile),
      }))
      return samples.reduce((best, s) => (s.mg > best.mg ? s : best))
    }

    expect(peak(slow).minute).toBeGreaterThan(peak(fast).minute)
    expect(peak(slow).mg).toBeGreaterThan(peak(fast).mg)
  })

  it('clears the threshold sooner for a fast clearer', () => {
    const doses = [dose(200, -30 * MINUTE)]
    const fastCrossing = clearsBelowAt(doses, { from: now, profile: fast })
    const slowCrossing = clearsBelowAt(doses, { from: now, profile: slow })

    expect(fastCrossing!.getTime()).toBeLessThan(slowCrossing!.getTime())
  })

  it('takes its default threshold from the profile', () => {
    const doses = [dose(200, -30 * MINUTE)]
    const strict: Profile = { ...DEFAULT_PROFILE, sleepThresholdMg: 20 }

    expect(clearsBelowAt(doses, { from: now, profile: strict })).toEqual(
      clearsBelowAt(doses, { from: now, threshold: 20 }),
    )
  })

  it('projects the window further ahead for a slow clearer', () => {
    const doses = [dose(160, -30 * MINUTE)]
    expect(curveWindow(doses, now, slow).to.getTime()).toBeGreaterThan(
      curveWindow(doses, now, fast).to.getTime(),
    )
  })

  it('samples the curve against the profile', () => {
    const doses = [dose(160, -HOUR)]
    const curve = bloodCaffeineCurve(doses, {
      from: at(-2 * HOUR),
      to: at(2 * HOUR),
      now,
      stepMs: HOUR,
      profile: fast,
    })

    for (const point of curve) {
      expect(point.mg).toBeCloseTo(bodyLoadAt(doses, new Date(point.at), fast), 6)
    }
  })

  it('reads the outlook against the profile threshold', () => {
    const doses = [dose(95, -8 * HOUR)]
    const lenient: Profile = { ...DEFAULT_PROFILE, sleepThresholdMg: 100 }
    const strict: Profile = { ...DEFAULT_PROFILE, sleepThresholdMg: 5 }

    expect(sleepOutlook(doses, now, lenient)).toEqual({ kind: 'clear' })
    expect(sleepOutlook(doses, now, strict).kind).not.toBe('clear')
  })
})

describe('lastCallBefore', () => {
  const bedtime = at(12 * HOUR)
  const COFFEE_MG = 95

  /** The worst moment of the night, which is what the answer must respect. */
  function peakDuringSleep(doses: Dose[], profile: Profile = DEFAULT_PROFILE): number {
    let worst = 0
    for (let t = bedtime.getTime(); t <= bedtime.getTime() + 3 * HOUR; t += 10 * MINUTE) {
      worst = Math.max(worst, bodyLoadAt(doses, new Date(t), profile))
    }
    return worst
  }

  it('answers with an instant before bedtime', () => {
    const found = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG })

    expect(found).not.toBeNull()
    expect(found!.getTime()).toBeLessThan(bedtime.getTime())
    expect(found!.getTime()).toBeGreaterThanOrEqual(now.getTime())
  })

  it('leaves the night under the threshold', () => {
    const found = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG })!
    const withCoffee = [{ consumedAt: found, mg: COFFEE_MG }]

    expect(peakDuringSleep(withCoffee)).toBeLessThanOrEqual(SLEEP_THRESHOLD_MG)
  })

  it('is the latest such instant — half an hour later would break it', () => {
    const found = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG })!
    const halfHourLater = [{ consumedAt: at(found.getTime() - now.getTime() + 30 * MINUTE), mg: COFFEE_MG }]

    expect(peakDuringSleep(halfHourLater)).toBeGreaterThan(SLEEP_THRESHOLD_MG)
  })

  /*
   * The trap this function exists to avoid. A dose contributes 0 mg at the
   * moment it is drunk and peaks about fifty minutes later, so anything that
   * only checks the load *at* bedtime happily green-lights a coffee at 22:50.
   */
  it('never green-lights a coffee minutes before bed', () => {
    const found = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG })!
    expect(bedtime.getTime() - found.getTime()).toBeGreaterThan(60 * MINUTE)
  })

  it('is null when the day is already lost', () => {
    // 400mg half an hour ago, with bed in two hours: nothing more is safe.
    const doses = [dose(400, -30 * MINUTE)]
    expect(lastCallBefore(doses, { now, bedtime: at(2 * HOUR), doseMg: COFFEE_MG })).toBeNull()
  })

  it('is null once bedtime has passed', () => {
    expect(lastCallBefore([], { now, bedtime: at(-HOUR), doseMg: COFFEE_MG })).toBeNull()
  })

  it('accounts for what is already in the system', () => {
    // A morning coffee still leaves room for another, but brings the deadline
    // forward. A much bigger history returns null instead, which the
    // already-lost case above covers.
    const withHistory = lastCallBefore([dose(95, -4 * HOUR)], { now, bedtime, doseMg: COFFEE_MG })!
    const empty = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG })!

    expect(withHistory).not.toBeNull()
    expect(withHistory.getTime()).toBeLessThan(empty.getTime())
  })

  it('gives a bigger drink an earlier deadline', () => {
    const espresso = lastCallBefore([], { now, bedtime, doseMg: 63 })!
    const energy = lastCallBefore([], { now, bedtime, doseMg: 160 })!

    expect(energy.getTime()).toBeLessThan(espresso.getTime())
  })

  it('gives a fast clearer a later deadline than a slow one', () => {
    const fast: Profile = { eliminationHalfLifeMs: 2.5 * HOUR, sleepThresholdMg: 50 }
    const slow: Profile = { eliminationHalfLifeMs: 10 * HOUR, sleepThresholdMg: 50 }

    const fastCall = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG, profile: fast })!
    const slowCall = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG, profile: slow })!

    expect(fastCall.getTime()).toBeGreaterThan(slowCall.getTime())
  })

  it('gives a stricter sleeper an earlier deadline', () => {
    const strict: Profile = { ...DEFAULT_PROFILE, sleepThresholdMg: 20 }

    const strictCall = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG, profile: strict })!
    const normalCall = lastCallBefore([], { now, bedtime, doseMg: COFFEE_MG })!

    expect(strictCall.getTime()).toBeLessThan(normalCall.getTime())
  })
})

describe('combinedLoadAt and combinedCaffeineCurve', () => {
  const fast: Profile = { eliminationHalfLifeMs: 2.5 * HOUR, sleepThresholdMg: 50 }
  const slow: Profile = { eliminationHalfLifeMs: 10 * HOUR, sleepThresholdMg: 50 }

  const team = [
    { profile: fast, doses: [dose(200, -3 * HOUR)] },
    { profile: slow, doses: [dose(95, -2 * HOUR), dose(160, -HOUR)] },
  ]

  it('is zero for an empty team', () => {
    expect(combinedLoadAt([], now)).toBe(0)
  })

  it('is zero for a team who have drunk nothing', () => {
    expect(combinedLoadAt([{ profile: fast, doses: [] }], now)).toBe(0)
  })

  it('matches the individual figure for a team of one', () => {
    expect(combinedLoadAt([team[0]], now)).toBeCloseTo(
      bodyLoadAt(team[0].doses, now, fast),
      9,
    )
  })

  it('adds the members up', () => {
    expect(combinedLoadAt(team, now)).toBeCloseTo(
      bodyLoadAt(team[0].doses, now, fast) + bodyLoadAt(team[1].doses, now, slow),
      9,
    )
  })

  /*
   * The reason this exists rather than pooling the milligrams: applying one
   * half-life to the team's total would model thirty people as one very large
   * human, and the answer differs.
   */
  it('differs from pooling every dose under one profile', () => {
    const pooled = bodyLoadAt([...team[0].doses, ...team[1].doses], now, fast)
    expect(combinedLoadAt(team, now)).not.toBeCloseTo(pooled, 1)
  })

  it('samples the curve in step with the individual one', () => {
    const window = { from: at(-4 * HOUR), to: at(4 * HOUR), now }
    const curve = combinedCaffeineCurve(team, { ...window, stepMs: HOUR })

    for (const point of curve) {
      expect(point.mg).toBeCloseTo(combinedLoadAt(team, new Date(point.at)), 6)
    }
  })

  it('marks the present instant as measured and the rest ahead as projected', () => {
    const window = { from: at(-4 * HOUR), to: at(4 * HOUR), now }
    const curve = combinedCaffeineCurve(team, { ...window, stepMs: HOUR })

    expect(curve.find((point) => point.at === now.getTime())?.projected).toBe(false)
    expect(curve.filter((p) => p.at > now.getTime()).every((p) => p.projected)).toBe(true)
  })

  it('spans the window it is given', () => {
    const window = { from: at(-4 * HOUR), to: at(4 * HOUR), now }
    const curve = combinedCaffeineCurve(team, { ...window, stepMs: HOUR })

    expect(curve[0].at).toBe(window.from.getTime())
    expect(curve.at(-1)?.at).toBe(window.to.getTime())
  })
})
