import type { AlcoholCategory } from '@/lib/alcohol'

export type AlcoholTypeSeed = {
  slug: string
  name: string
  category: AlcoholCategory
  volumeMl: number
  abvPercent: number
  sortOrder: number
}

/**
 * Starting alcoholic drinks.
 *
 * Real servings rather than round numbers: these are the containers a bar and a
 * fridge actually hand you, which is why party mode ships without a volume
 * slider — the button *is* the measure. The strengths are typical Norwegian
 * ones and, like the caffeine figures, estimates. A craft IPA is nearer 6.5%
 * than 4.7%, which is why the list is editable for the same reason the coffee
 * list is.
 */
export const ALCOHOL_TYPE_SEEDS: AlcoholTypeSeed[] = [
  {
    slug: 'beer_pint',
    name: 'Pint 0.5L',
    category: 'beer',
    volumeMl: 500,
    abvPercent: 4.7,
    sortOrder: 10,
  },
  {
    slug: 'beer_small',
    name: 'Beer 0.33L',
    category: 'beer',
    volumeMl: 330,
    abvPercent: 4.7,
    sortOrder: 20,
  },
  {
    slug: 'beer_strong',
    name: 'Strong beer 0.33L',
    category: 'beer',
    volumeMl: 330,
    abvPercent: 6.5,
    sortOrder: 30,
  },
  {
    slug: 'wine_glass',
    name: 'Wine glass',
    category: 'wine',
    volumeMl: 150,
    abvPercent: 12,
    sortOrder: 40,
  },
  {
    slug: 'spirit_4cl',
    name: 'Spirit 4cl',
    category: 'spirits',
    volumeMl: 40,
    abvPercent: 40,
    sortOrder: 50,
  },
  {
    slug: 'cider_033',
    name: 'Cider 0.33L',
    category: 'cider',
    volumeMl: 330,
    abvPercent: 4.5,
    sortOrder: 60,
  },
]
