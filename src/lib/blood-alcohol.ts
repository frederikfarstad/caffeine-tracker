/**
 * How much alcohol is in your blood, and when it will be gone.
 *
 * The sibling of `blood-caffeine.ts`, and structurally not the same model.
 * Caffeine is eliminated first-order — a fixed *fraction* per unit time — which
 * makes each dose an independent exponential and lets that module sum a closed
 * form per drink. Alcohol above the first drink or so is eliminated
 * **zero-order**: the liver's enzymes are saturated, so it clears at a roughly
 * constant 0.15 ‰ per hour whatever the level, and stops at zero.
 *
 * That single difference removes superposition. A constant shared by all the
 * alcohol present cannot be attributed to individual doses, and the floor at
 * zero is a non-linearity no sum of per-dose curves can reproduce: two drinks
 * an hour apart are emphatically not the sum of two lone drinks. So this module
 * steps a simulation forward rather than evaluating a formula.
 *
 * Sources:
 * - Widmark, *Die theoretischen Grundlagen und die praktische Verwendbarkeit
 *   der gerichtlich-medizinischen Alkoholbestimmung* (1932) — the r ratios and
 *   the distribution formula still in forensic use.
 * - Jones, *Evidence-based survey of the elimination rates of ethanol from
 *   blood*, Forensic Sci Int 200(1-3) 2010 — 0.15 ‰/hour is the usual figure;
 *   the observed range runs about 0.10 to 0.25.
 *   https://pubmed.ncbi.nlm.nih.gov/20304569/
 * - Vegtrafikkloven § 22: the Norwegian limit, 0.2 ‰.
 *
 * Everything here is an estimate about a body the app barely knows. Food in the
 * stomach can double the time to peak and is not modelled; elimination varies
 * by half between people; the strength of what was actually poured is a guess.
 * This is never a breathalyser and the UI must never let it read as one.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Zero-order elimination, in permille per hour. */
export const ELIMINATION_PERMILLE_PER_HOUR = 0.15

/**
 * Absorption half-life.
 *
 * Chosen so a drink peaks 30-45 minutes after it is swallowed, which is an
 * average stomach. A full one is much slower; that is a variable the app cannot
 * ask about and does not pretend to model.
 */
export const ABSORPTION_HALF_LIFE_MS = 12 * MINUTE_MS

/** Widmark's distribution ratios: the fraction of the body that is water. */
export const WIDMARK_RATIO = { male: 0.68, female: 0.55 } as const

export const DEFAULT_WEIGHT_KG = 80

/**
 * The ratio used when sex is unknown: the midpoint of the two.
 *
 * A midpoint is wrong for everybody by about ten per cent rather than wrong for
 * half of everybody by twenty, which is the better failure for a number nobody
 * is obliged to supply.
 */
export const DEFAULT_WIDMARK_RATIO = 0.615

/**
 * The body the estimate is computed against.
 *
 * `personal` is the honest flag: false means these are population figures, and
 * the UI is required to say so rather than presenting an average as the
 * reader's own. `blood-caffeine.ts` needs no equivalent because milligrams in
 * the body do not depend on the body — permille does.
 */
export type BodyProfile = {
  weightKg: number
  widmarkRatio: number
  personal: boolean
}

export const DEFAULT_BODY_PROFILE: BodyProfile = {
  weightKg: DEFAULT_WEIGHT_KG,
  widmarkRatio: DEFAULT_WIDMARK_RATIO,
  personal: false,
}

/** Build a profile from whatever the member chose to tell us, if anything. */
export function bodyProfileFrom({
  bodyWeightKg,
  sex,
}: {
  bodyWeightKg: number | null
  sex: 'male' | 'female' | null
}): BodyProfile {
  if (bodyWeightKg === null && sex === null) return DEFAULT_BODY_PROFILE

  return {
    weightKg: bodyWeightKg ?? DEFAULT_WEIGHT_KG,
    widmarkRatio: sex ? WIDMARK_RATIO[sex] : DEFAULT_WIDMARK_RATIO,
    personal: true,
  }
}

/** One drink's worth of pure alcohol, and when it was drunk. */
export type AlcoholDose = { consumedAt: Date; grams: number }

export type BacPoint = {
  /** Epoch milliseconds, so the chart can use a real time axis. */
  at: number
  bac: number
  /** True after `now`: a forecast, not a record. */
  projected: boolean
}

const ABSORPTION_RATE = Math.LN2 / ABSORPTION_HALF_LIFE_MS

/** Integration step. One minute is far finer than anything displayed. */
const STEP_MS = MINUTE_MS

/** Below this, the gut is empty enough that nothing more is coming. */
const GUT_EMPTY_G = 0.01

type Sample = { bac: number; gutG: number }

/**
 * Walk the two-compartment state forward and read it at each requested instant.
 *
 * The simulation **always** begins at the earliest dose, never at the first
 * sample. Seeding it at the caller's window would start a body sober in the
 * middle of an evening, which is the one mistake this shape of model invites:
 * with no closed form there is nothing to evaluate at an arbitrary instant, so
 * the history has to be replayed every time.
 *
 * `sampleTimes` must be sorted ascending; the walk is single-pass.
 */
function simulate(doses: AlcoholDose[], sampleTimes: number[], profile: BodyProfile): Sample[] {
  if (sampleTimes.length === 0) return []

  const ordered = [...doses].sort((a, b) => a.consumedAt.getTime() - b.consumedAt.getTime())
  const eliminationPerMs = ELIMINATION_PERMILLE_PER_HOUR / HOUR_MS
  /** Permille added per gram absorbed — the Widmark denominator. */
  const permillePerGram = 1 / (profile.widmarkRatio * profile.weightKg)

  let t = ordered.length
    ? Math.min(ordered[0].consumedAt.getTime(), sampleTimes[0])
    : sampleTimes[0]
  let gutG = 0
  let bac = 0
  let next = 0

  const swallowUpTo = (instant: number) => {
    while (next < ordered.length && ordered[next].consumedAt.getTime() <= instant) {
      gutG += ordered[next].grams
      next++
    }
  }

  const out: Sample[] = []

  for (const sampleAt of sampleTimes) {
    while (t < sampleAt) {
      swallowUpTo(t)
      // The last step of a stretch is short when a sample falls off the grid.
      // Both processes are rate-based, so a partial step is exact for
      // elimination and correct to the same order for absorption.
      const step = Math.min(STEP_MS, sampleAt - t)
      const absorbed = gutG * (1 - Math.exp(-ABSORPTION_RATE * step))
      gutG -= absorbed
      bac = Math.max(0, bac + absorbed * permillePerGram - eliminationPerMs * step)
      t += step
    }

    swallowUpTo(t)
    out.push({ bac, gutG })
  }

  return out
}

/** Estimated blood alcohol, in permille, at `instant`. */
export function bacAt(
  doses: AlcoholDose[],
  instant: Date,
  profile: BodyProfile = DEFAULT_BODY_PROFILE,
): number {
  return simulate(doses, [instant.getTime()], profile)[0].bac
}

/**
 * Sample the curve across a window.
 *
 * The grid is anchored on `now` rather than on `from`, so the present instant is
 * always a sample — the chart draws the past solid and the future dashed, and
 * they can only meet if they share a point. Same rule as `bloodCaffeineCurve`.
 */
export function bloodAlcoholCurve(
  doses: AlcoholDose[],
  {
    from,
    to,
    now,
    stepMs = 10 * MINUTE_MS,
    profile = DEFAULT_BODY_PROFILE,
  }: { from: Date; to: Date; now: Date; stepMs?: number; profile?: BodyProfile },
): BacPoint[] {
  const times = new Set<number>([from.getTime(), to.getTime()])

  for (let t = now.getTime(); t >= from.getTime(); t -= stepMs) times.add(t)
  for (let t = now.getTime(); t <= to.getTime(); t += stepMs) times.add(t)

  const ordered = [...times]
    .filter((t) => t >= from.getTime() && t <= to.getTime())
    .sort((a, b) => a - b)

  const samples = simulate(doses, ordered, profile)

  return ordered.map((at, index) => ({
    at,
    bac: samples[index].bac,
    // The joining sample counts as measured, so the solid line reaches it.
    projected: at > now.getTime(),
  }))
}

/**
 * The first instant from `from` onwards at or below a threshold, or `null`
 * inside the horizon.
 *
 * The gut check is load-bearing, and is the one thing this does that the
 * caffeine module's `clearsBelowAt` does not. Two minutes after a drink the
 * blood is still near zero because nothing has been absorbed yet; asking only
 * "is the level low" would answer "you are already sober" to someone with a
 * pint in their stomach. A candidate only counts once there is nothing left to
 * arrive.
 */
export function soberAt(
  doses: AlcoholDose[],
  {
    from,
    profile = DEFAULT_BODY_PROFILE,
    threshold = 0,
    stepMs = 5 * MINUTE_MS,
    horizonMs = 24 * HOUR_MS,
  }: {
    from: Date
    profile?: BodyProfile
    threshold?: number
    stepMs?: number
    horizonMs?: number
  },
): Date | null {
  const times: number[] = []
  for (let t = from.getTime(); t <= from.getTime() + horizonMs; t += stepMs) times.push(t)

  const samples = simulate(doses, times, profile)

  for (let i = 0; i < samples.length; i++) {
    if (samples[i].gutG <= GUT_EMPTY_G && samples[i].bac <= threshold) {
      return new Date(times[i])
    }
  }

  return null
}

/** How far back the curve looks. An evening, not a working day. */
const LOOKBACK_MS = 8 * HOUR_MS

/** How far ahead it is willing to guess. */
const MAX_PROJECTION_MS = 12 * HOUR_MS
const MIN_PROJECTION_MS = HOUR_MS

/** A little air either side of the first drink and the crossing. */
const PADDING_MS = 30 * MINUTE_MS

/**
 * The window worth drawing.
 *
 * Same reasoning as the caffeine chart's: start just before the first drink
 * rather than a fixed span back, so the plot is not mostly flat zero, and end a
 * little past the point the reader came for — here, sober rather than under a
 * sleep threshold.
 */
export function curveWindow(
  doses: AlcoholDose[],
  now: Date,
  profile: BodyProfile = DEFAULT_BODY_PROFILE,
): { from: Date; to: Date } {
  const earliest = Math.min(...doses.map((d) => d.consumedAt.getTime()))
  const from = Number.isFinite(earliest)
    ? Math.max(now.getTime() - LOOKBACK_MS, earliest - PADDING_MS)
    : now.getTime() - LOOKBACK_MS

  const crossing = soberAt(doses, { from: now, profile })
  const wanted = crossing ? crossing.getTime() + PADDING_MS : now.getTime() + MAX_PROJECTION_MS
  const to = Math.min(
    now.getTime() + MAX_PROJECTION_MS,
    Math.max(now.getTime() + MIN_PROJECTION_MS, wanted),
  )

  return { from: new Date(from), to: new Date(to) }
}

export type DrivingOutlook =
  /** Nothing on board. */
  | { kind: 'clear' }
  /** Will be sober at a time the chart can show. */
  | { kind: 'clears'; at: Date }
  /** Not inside the projection window. */
  | { kind: 'not-tonight' }

/**
 * The one-line answer, and never a time past the right-hand edge of the plot.
 *
 * A figure quoted off the end of the chart is a claim the reader cannot check
 * against the line, and the further out the projection runs the less it is
 * worth. "Not tonight" is the honest form of that answer — and for this
 * quantity it is also the safer one.
 */
export function drivingOutlook(
  doses: AlcoholDose[],
  now: Date,
  profile: BodyProfile = DEFAULT_BODY_PROFILE,
): DrivingOutlook {
  const crossing = soberAt(doses, { from: now, profile })
  if (crossing && crossing.getTime() <= now.getTime()) return { kind: 'clear' }

  const { to } = curveWindow(doses, now, profile)
  if (!crossing || crossing.getTime() > to.getTime()) return { kind: 'not-tonight' }

  return { kind: 'clears', at: crossing }
}
