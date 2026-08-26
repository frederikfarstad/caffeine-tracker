import type { DrinkCategory } from '@/lib/caffeine'

export type DrinkTypeSeed = {
  slug: string
  name: string
  category: DrinkCategory
  volumeMl: number | null
  caffeineMg: number
  sortOrder: number
}

/**
 * Starting drink types.
 *
 * The milligram figures are typical estimates, not measurements — a filter
 * coffee varies with grind, dose and machine. They are editable from the admin
 * page precisely because the defaults are approximations, and existing logs
 * keep the value they were recorded with.
 */
export const DRINK_TYPE_SEEDS: DrinkTypeSeed[] = [
  {
    slug: 'coffee',
    name: 'Coffee',
    category: 'coffee',
    volumeMl: null,
    caffeineMg: 95,
    sortOrder: 10,
  },
  {
    slug: 'espresso',
    name: 'Espresso',
    category: 'coffee',
    volumeMl: 30,
    caffeineMg: 63,
    sortOrder: 20,
  },
  {
    slug: 'energy_033',
    name: 'Energy 0.33L',
    category: 'energy',
    volumeMl: 330,
    caffeineMg: 105,
    sortOrder: 30,
  },
  {
    slug: 'energy_050',
    name: 'Energy 0.5L',
    category: 'energy',
    volumeMl: 500,
    caffeineMg: 160,
    sortOrder: 40,
  },
]
