/**
 * How much caffeine is still in you, and when it will be out.
 *
 * A daily total answers "how much have I had"; it cannot answer "can I have
 * another one now" or "will this keep me up". Those need the shape of the day,
 * not its sum — a 400mg morning and a 400mg evening are the same number and
 * very different nights.
 *
 * The model is the standard single-compartment one with first-order absorption
 * and first-order elimination, summed over each drink. Two half-lives set it:
 * caffeine is absorbed from the gut within the hour and eliminated with a
 * half-life of around five hours in a healthy adult.
 *
 * Sources:
 * - Institute of Medicine, *Caffeine for the Sustainment of Mental Task
 *   Performance* (2001), ch. 2 — pharmacokinetics; 2.5-10h elimination half
 *   life in healthy adults, peak plasma 15-120 minutes after ingestion.
 *   https://www.ncbi.nlm.nih.gov/books/NBK223808/
 * - Drake et al., *Caffeine Effects on Sleep Taken 0, 3, or 6 Hours before
 *   Going to Bed*, J Clin Sleep Med 9(11) 2013 — caffeine six hours before bed
 *   still measurably disrupts sleep.
 *   https://pubmed.ncbi.nlm.nih.gov/24235903/
 *
 * Everything here is an estimate about an average adult. Half-life varies
 * several-fold between people — smoking roughly halves it, pregnancy and some
 * medications multiply it — and the per-drink milligram figures are estimates
 * of their own. The UI says as much wherever these numbers are shown.
 *
 * Milligrams *in the body*, deliberately, not a plasma concentration: mg/L
 * would need a volume of distribution, which needs body weight the app does
 * not have and should not ask for.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Elimination half-life for a healthy adult. */
export const ELIMINATION_HALF_LIFE_MS = 5 * HOUR_MS

/**
 * Absorption half-life.
 *
 * Chosen so the curve peaks about 50 minutes after the drink, in the middle of
 * the observed 15-120 minute range for peak plasma caffeine.
 */
export const ABSORPTION_HALF_LIFE_MS = 10 * MINUTE_MS

/**
 * The load below which caffeine is unlikely to cost you sleep.
 *
 * A rule of thumb rather than a published limit: there is no clean threshold in
 * the literature, only the finding that a normal dose within six hours of bed
 * measurably disrupts sleep. 50mg is roughly what a 200mg afternoon coffee
 * decays to over those six hours, which makes it a defensible line to draw and
 * an honest one to label as a rule of thumb.
 */
export const SLEEP_THRESHOLD_MG = 50

const LN2 = Math.LN2
const ABSORPTION_RATE = LN2 / ABSORPTION_HALF_LIFE_MS

/**
 * The two figures that differ enough between people to be worth asking about.
 *
 * Elimination half-life is the one that matters most: the several-fold spread
 * between individuals means a single hardcoded figure is confidently wrong for
 * most of them. The sleep threshold is a preference as much as a physiological
 * fact, so it belongs to the person too.
 *
 * Absorption is deliberately *not* here. It varies far less, and nobody can
 * sensibly self-report how fast their gut works.
 */
export type Profile = {
  eliminationHalfLifeMs: number
  sleepThresholdMg: number
}

/** The typical healthy adult, and what every member starts on. */
export const DEFAULT_PROFILE: Profile = {
  eliminationHalfLifeMs: ELIMINATION_HALF_LIFE_MS,
  sleepThresholdMg: SLEEP_THRESHOLD_MG,
}

/** One drink's worth of caffeine, and when it was drunk. */
export type Dose = { consumedAt: Date; mg: number }

/**
 * One dose's remaining contribution, `elapsed` milliseconds after drinking it.
 *
 * The two-exponential form is the solution to the gut → bloodstream → cleared
 * cascade: the first term is what is left after elimination, the second is what
 * has not been absorbed yet. Zero at the moment of drinking, when the whole
 * dose is still in the first compartment.
 */
function contribution(mg: number, elapsedMs: number, eliminationRate: number): number {
  if (elapsedMs <= 0) return 0

  const scale = ABSORPTION_RATE / (ABSORPTION_RATE - eliminationRate)
  return (
    mg *
    scale *
    (Math.exp(-eliminationRate * elapsedMs) - Math.exp(-ABSORPTION_RATE * elapsedMs))
  )
}

/** Estimated milligrams of caffeine in the body at `instant`. */
export function bodyLoadAt(
  doses: Dose[],
  instant: Date,
  profile: Profile = DEFAULT_PROFILE,
): number {
  const eliminationRate = LN2 / profile.eliminationHalfLifeMs

  return doses.reduce(
    (total, dose) =>
      total +
      contribution(dose.mg, instant.getTime() - dose.consumedAt.getTime(), eliminationRate),
    0,
  )
}

export type CurvePoint = {
  /** Epoch milliseconds, so the chart can use a real time axis. */
  at: number
  mg: number
  /** True after `now`: this part of the curve is a forecast, not a record. */
  projected: boolean
}

/**
 * Sample the curve across a window.
 *
 * The grid is anchored on `now` rather than on `from`, so the present instant is
 * always a sample. The chart draws the past as a solid line and the future as a
 * dashed one, and they can only meet if they share a point.
 */
export function bloodCaffeineCurve(
  doses: Dose[],
  {
    from,
    to,
    now,
    stepMs = 10 * MINUTE_MS,
    profile = DEFAULT_PROFILE,
  }: { from: Date; to: Date; now: Date; stepMs?: number; profile?: Profile },
): CurvePoint[] {
  const times = new Set<number>([from.getTime(), to.getTime()])

  for (let t = now.getTime(); t >= from.getTime(); t -= stepMs) times.add(t)
  for (let t = now.getTime(); t <= to.getTime(); t += stepMs) times.add(t)

  return [...times]
    .filter((t) => t >= from.getTime() && t <= to.getTime())
    .sort((a, b) => a - b)
    .map((at) => ({
      at,
      mg: bodyLoadAt(doses, new Date(at), profile),
      // The joining sample counts as measured, so the solid line reaches it.
      projected: at > now.getTime(),
    }))
}

/**
 * The first instant from `from` onwards at which the load sits at or below a
 * threshold, or `null` if that does not happen inside the horizon.
 *
 * Searched by sampling rather than solved: a sum of exponentials has no
 * closed-form inverse, and the answer is displayed to the nearest five minutes.
 */
export function clearsBelowAt(
  doses: Dose[],
  {
    from,
    profile = DEFAULT_PROFILE,
    threshold = profile.sleepThresholdMg,
    stepMs = 5 * MINUTE_MS,
    horizonMs = 24 * HOUR_MS,
  }: {
    from: Date
    profile?: Profile
    threshold?: number
    stepMs?: number
    horizonMs?: number
  },
): Date | null {
  const limit = from.getTime() + horizonMs

  for (let t = from.getTime(); t <= limit; t += stepMs) {
    if (bodyLoadAt(doses, new Date(t), profile) <= threshold) return new Date(t)
  }

  return null
}

/** How far back the curve looks. Long enough to hold a whole working day. */
const LOOKBACK_MS = 12 * HOUR_MS

/** How far ahead it is willing to guess. */
const MAX_PROJECTION_MS = 12 * HOUR_MS
const MIN_PROJECTION_MS = HOUR_MS

/** A little air either side of the first drink and the crossing. */
const PADDING_MS = 30 * MINUTE_MS

/**
 * The window worth drawing.
 *
 * Starts just before the first drink still in range rather than at a fixed
 * twelve hours: on a normal day the first coffee is hours after waking, and a
 * fixed start spends a third of the plot drawing a flat zero.
 *
 * Ends a little past the point the load clears the sleep threshold, because
 * that crossing is the answer people come to this chart for. Clamped at both
 * ends: an empty day still needs an axis, and a day that will not clear inside
 * twelve hours is better shown as "not tonight" than by zooming out further.
 */
export function curveWindow(
  doses: Dose[],
  now: Date,
  profile: Profile = DEFAULT_PROFILE,
): { from: Date; to: Date } {
  const earliest = Math.min(...doses.map((d) => d.consumedAt.getTime()))
  const from = Number.isFinite(earliest)
    ? Math.max(now.getTime() - LOOKBACK_MS, earliest - PADDING_MS)
    : now.getTime() - LOOKBACK_MS

  const crossing = clearsBelowAt(doses, { from: now, profile })
  const wanted = crossing ? crossing.getTime() + PADDING_MS : now.getTime() + MAX_PROJECTION_MS
  const to = Math.min(
    now.getTime() + MAX_PROJECTION_MS,
    Math.max(now.getTime() + MIN_PROJECTION_MS, wanted),
  )

  return { from: new Date(from), to: new Date(to) }
}

export type SleepOutlook =
  /** Already below the threshold. */
  | { kind: 'clear' }
  /** Will drop below it, at a time the chart can show. */
  | { kind: 'clears'; at: Date }
  /** Will not drop below it inside the projection window. */
  | { kind: 'not-tonight' }

/**
 * The one-line answer the chart exists to give.
 *
 * Never names an instant beyond the end of {@link curveWindow}: a time quoted
 * off the right-hand edge of the plot is a claim the reader cannot check
 * against the line, and the further out the projection runs the less it is
 * worth. "Not tonight" is the honest form of that answer.
 */
export function sleepOutlook(
  doses: Dose[],
  now: Date,
  profile: Profile = DEFAULT_PROFILE,
): SleepOutlook {
  const crossing = clearsBelowAt(doses, { from: now, profile })
  if (crossing && crossing.getTime() <= now.getTime()) return { kind: 'clear' }

  const { to } = curveWindow(doses, now, profile)
  if (!crossing || crossing.getTime() > to.getTime()) return { kind: 'not-tonight' }

  return { kind: 'clears', at: crossing }
}

/**
 * How long after bedtime the caffeine still has to behave.
 *
 * A dose peaks roughly fifty minutes after it is drunk, so a constraint applied
 * only at the moment of getting into bed is no constraint at all. Three hours
 * covers the peak of anything drunk right up to bedtime with room to spare.
 */
const SLEEP_WINDOW_MS = 3 * HOUR_MS

/**
 * The latest you could have one more drink and still sleep.
 *
 * Sampled backwards from bedtime rather than solved, for the same reason as
 * {@link clearsBelowAt}: no closed form, and the answer is shown to the nearest
 * five minutes.
 *
 * The condition is deliberately the *worst* load across the first hours of
 * sleep, not the load at bedtime. Checking bedtime alone would report that a
 * coffee ten minutes earlier is fine — it has barely been absorbed by then, and
 * peaks in the middle of the night.
 *
 * Returns `null` when no time works: either bedtime has passed, or what is
 * already in the system will breach the threshold on its own. "Not tonight" is
 * a real answer and better than a time that isn't true.
 */
export function lastCallBefore(
  doses: Dose[],
  {
    now,
    bedtime,
    doseMg,
    profile = DEFAULT_PROFILE,
    stepMs = 5 * MINUTE_MS,
  }: { now: Date; bedtime: Date; doseMg: number; profile?: Profile; stepMs?: number },
): Date | null {
  const worstDuringSleep = (candidate: Dose[]) => {
    let worst = 0
    for (let t = bedtime.getTime(); t <= bedtime.getTime() + SLEEP_WINDOW_MS; t += stepMs) {
      worst = Math.max(worst, bodyLoadAt(candidate, new Date(t), profile))
    }
    return worst
  }

  for (let t = bedtime.getTime(); t >= now.getTime(); t -= stepMs) {
    const withOneMore = [...doses, { consumedAt: new Date(t), mg: doseMg }]
    if (worstDuringSleep(withOneMore) <= profile.sleepThresholdMg) return new Date(t)
  }

  return null
}

/** One person's drinks and the physiology to model them by. */
export type Bloodstream = { profile: Profile; doses: Dose[] }

/**
 * Everyone's caffeine added together.
 *
 * Each member is modelled with their own clearance rate and the results summed,
 * rather than pooling the milligrams and applying one half-life to the total —
 * that would treat the office as a single very large person, and gives a
 * different answer.
 */
export function combinedLoadAt(team: Bloodstream[], instant: Date): number {
  return team.reduce(
    (total, member) => total + bodyLoadAt(member.doses, instant, member.profile),
    0,
  )
}

/**
 * The team curve, sampled the same way {@link bloodCaffeineCurve} samples one
 * person's — grid anchored on `now`, so the measured and projected halves meet.
 */
export function combinedCaffeineCurve(
  team: Bloodstream[],
  {
    from,
    to,
    now,
    stepMs = 10 * MINUTE_MS,
  }: { from: Date; to: Date; now: Date; stepMs?: number },
): CurvePoint[] {
  const times = new Set<number>([from.getTime(), to.getTime()])

  for (let t = now.getTime(); t >= from.getTime(); t -= stepMs) times.add(t)
  for (let t = now.getTime(); t <= to.getTime(); t += stepMs) times.add(t)

  return [...times]
    .filter((t) => t >= from.getTime() && t <= to.getTime())
    .sort((a, b) => a - b)
    .map((at) => ({
      at,
      mg: combinedLoadAt(team, new Date(at)),
      projected: at > now.getTime(),
    }))
}
