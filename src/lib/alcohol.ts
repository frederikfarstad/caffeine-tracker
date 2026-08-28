/**
 * Alcohol dose arithmetic and the presentation rules built on it.
 *
 * The counterpart to `caffeine.ts`, and deliberately shaped like it. Two things
 * differ. Caffeine arrives as a milligram figure somebody typed; alcohol is
 * computed from a volume and a strength, because those are what a label states
 * and a 0.5L at 4.7% is a fact where "18.5 grams" is a calculation. And the
 * reference figure is a legal limit rather than a health guideline, which makes
 * the copy's job the opposite one: EFSA's 400 mg is advice you may ignore, and
 * 0.2 permille is not.
 *
 * Sources:
 * - Vegtrafikkloven § 22: the Norwegian limit is 0.2 ‰.
 *   https://lovdata.no/lov/1965-06-18-4/§22
 * - Helsedirektoratet count a standard unit ("alkoholenhet") as 12.8 g of pure
 *   alcohol, which is 1.5 cl by volume.
 *
 * Every figure the app derives from these is an estimate. The strength on a
 * bottle is rounded, the pour is not measured, and the model downstream in
 * `blood-alcohol.ts` describes an average body. The UI says so.
 */

export type AlcoholCategory = 'beer' | 'wine' | 'spirits' | 'cider' | 'other'

export const CATEGORY_LABELS: Record<AlcoholCategory, string> = {
  beer: 'Beer',
  wine: 'Wine',
  spirits: 'Spirits',
  cider: 'Cider',
  other: 'Other',
}

/** Grams per millilitre of pure ethanol at room temperature. */
export const ETHANOL_DENSITY_G_PER_ML = 0.789

/** One Norwegian standard unit, in grams of pure alcohol. */
export const STANDARD_UNIT_G = 12.8

/** The Norwegian legal driving limit, in permille. */
export const DRIVING_LIMIT_PERMILLE = 0.2

/** Where the readout stops calling it a normal evening. */
export const HEAVY_PERMILLE = 1

/** Top of the gauge. Past the point anyone should be reading a gauge. */
export const SCALE_MAX_PERMILLE = 2

/**
 * Grams of pure alcohol in a serving.
 *
 * Not rounded. At an average body one gram is about 0.02 ‰ — a tenth of the
 * legal limit — so rounding per drink would put visible error on the one number
 * this whole feature exists to show.
 */
export function gramsOfAlcohol({
  volumeMl,
  abvPercent,
}: {
  volumeMl: number
  abvPercent: number
}): number {
  return volumeMl * (abvPercent / 100) * ETHANOL_DENSITY_G_PER_ML
}

export function unitsFrom(grams: number): number {
  return grams / STANDARD_UNIT_G
}

/**
 * Units to one decimal.
 *
 * Beers do not come in whole units — a half-litre is 1.4 — so rounding to
 * integers would make the count disagree with the drinks visibly on the screen.
 */
export function formatUnits(grams: number): string {
  if (grams <= 0) return 'Nothing yet'

  const rounded = Math.round(unitsFrom(grams) * 10) / 10
  return `${rounded} ${rounded === 1 ? 'unit' : 'units'}`
}

/** Permille to two decimals, the resolution the legal limit is written at. */
export function formatPermille(bac: number): string {
  return `${bac.toFixed(2)} ‰`
}

export type BacStatus = 'clear' | 'over-limit' | 'heavy'

export function bacStatus(bac: number): BacStatus {
  if (bac >= HEAVY_PERMILLE) return 'heavy'
  if (bac >= DRIVING_LIMIT_PERMILLE) return 'over-limit'
  return 'clear'
}

/**
 * The line beside the meter.
 *
 * Colour never carries the status alone, exactly as in `caffeine.ts`. The
 * difference is what the "clear" case is allowed to say: under the limit is a
 * statement about a modelled number, not permission to drive, and this string
 * must never be readable as the latter. The estimate has no idea what was
 * actually poured.
 */
export function bacHeadline(bac: number): string {
  switch (bacStatus(bac)) {
    case 'heavy':
      return 'Well past the 0.2 ‰ limit. Estimated, and an estimate is not a breathalyser.'
    case 'over-limit':
      return 'Over the 0.2 ‰ driving limit on this estimate.'
    case 'clear':
      return 'Under 0.2 ‰ on this estimate — which is a model, not a test.'
  }
}
