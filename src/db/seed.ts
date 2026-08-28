import { db } from './index'
import { ALCOHOL_TYPE_SEEDS } from './alcohol-seed-data'
import { DRINK_TYPE_SEEDS } from './seed-data'
import { alcoholDrinkTypes, drinkTypes } from './schema'

/**
 * Insert the starting drink types, caffeinated and not.
 *
 * Idempotent: existing slugs are left alone, so running this against a live
 * database will not overwrite values that have been tuned by hand.
 */
async function seed() {
  const caffeinated = await db
    .insert(drinkTypes)
    .values(DRINK_TYPE_SEEDS)
    .onConflictDoNothing({ target: drinkTypes.slug })
    .returning({ slug: drinkTypes.slug })

  const alcoholic = await db
    .insert(alcoholDrinkTypes)
    .values(ALCOHOL_TYPE_SEEDS)
    .onConflictDoNothing({ target: alcoholDrinkTypes.slug })
    .returning({ slug: alcoholDrinkTypes.slug })

  for (const [label, rows] of [
    ['drink type', caffeinated],
    ['alcoholic drink type', alcoholic],
  ] as const) {
    if (rows.length === 0) {
      console.log(`No new ${label}s to seed.`)
    } else {
      console.log(`Seeded ${rows.length} ${label}(s): ${rows.map((r) => r.slug).join(', ')}`)
    }
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
