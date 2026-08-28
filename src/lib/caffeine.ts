/**
 * Caffeine reference values and the presentation rules built on them.
 *
 * Figures come from EFSA's 2015 scientific opinion on the safety of caffeine:
 * intakes up to 400mg per day, and single doses up to 200mg, raise no safety
 * concern for healthy adults.
 *
 * https://www.efsa.europa.eu/en/efsajournal/pub/4102
 *
 * These are population guidelines, not personal medical advice, and the
 * per-drink milligram figures in the database are estimates. The UI says so
 * where it shows them.
 */
export const DAILY_MAX_MG = 400
export const SINGLE_DOSE_MAX_MG = 200

/** Fraction of the daily reference at which the meter starts warning. */
export const APPROACHING_FRACTION = 0.75

export const APPROACHING_MG = DAILY_MAX_MG * APPROACHING_FRACTION

export type LimitStatus = 'ok' | 'approaching' | 'over'

/** Where a day's total sits relative to the daily reference. */
export function limitStatus(todayMg: number): LimitStatus {
  if (todayMg >= DAILY_MAX_MG) return 'over'
  if (todayMg >= APPROACHING_MG) return 'approaching'
  return 'ok'
}

/** Progress along the meter, clamped to 0..1 so the bar cannot overflow. */
export function fractionOfDailyMax(todayMg: number): number {
  return Math.min(1, Math.max(0, todayMg / DAILY_MAX_MG))
}

export function formatMg(mg: number): string {
  return `${Math.round(mg)} mg`
}

/**
 * The line of text beside the meter.
 *
 * Colour alone must never carry the status: this text changes too, so the
 * meter is legible to colourblind and screen-reader users.
 */
export function limitHeadline(todayMg: number): string {
  const status = limitStatus(todayMg)

  if (status === 'over') {
    return `Past the ${formatMg(DAILY_MAX_MG)} daily reference`
  }

  const remaining = formatMg(DAILY_MAX_MG - todayMg)
  return status === 'approaching'
    ? `${remaining} below the daily reference`
    : `${remaining} left before the daily reference`
}

export type DrinkCategory = 'coffee' | 'energy' | 'other'

export const CATEGORY_LABELS: Record<DrinkCategory, string> = {
  coffee: 'Coffee',
  energy: 'Energy drink',
  other: 'Other',
}
