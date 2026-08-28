/**
 * Serving sizes: how a drink's caffeine scales when you have more or less of it.
 *
 * Here rather than in `server/drinks.ts` because both sides need it — the
 * server to record the dose, the picker to show you what you are about to log.
 * Two copies of this arithmetic is how the number on the button stops matching
 * the number in the database.
 */

/** Serving sizes below this get a finer slider; 10ml steps on an espresso are useless. */
const FINE_STEP_THRESHOLD_ML = 120

/**
 * Caffeine for a given volume, or `null` when the drink has no standard serving
 * to scale from.
 *
 * Linear, which is right for a drink of fixed strength: twice the cup is twice
 * the caffeine. `null` volume means the standard serving, so nothing is scaled.
 */
export function scaleForVolume(
  type: { caffeineMg: number; volumeMl: number | null },
  volumeMl: number | null,
): number | null {
  if (volumeMl === null) return type.caffeineMg
  if (type.volumeMl === null || type.volumeMl <= 0) return null

  return Math.round((type.caffeineMg * volumeMl) / type.volumeMl)
}

export type SliderRange = { step: number; min: number; max: number }

/**
 * The volume slider's bounds, snapped so the standard serving is reachable.
 *
 * Every bound is a multiple of the step on purpose. A range of 125–1500 in tens
 * goes 125, 135, … 505: a normal 500ml can then reads as 505ml and 162mg, and
 * there is no way to slide back to the standard serving at all.
 */
export function sliderRange(baseMl: number): SliderRange {
  const step = baseMl <= FINE_STEP_THRESHOLD_ML ? 5 : 10
  const snap = (value: number) => Math.max(step, Math.round(value / step) * step)

  return { step, min: snap(baseMl / 4), max: snap(baseMl * 3) }
}
