import { db } from './index'
import { DRINK_TYPE_SEEDS } from './seed-data'
import { drinkTypes } from './schema'

/**
 * Insert the starting drink types.
 *
 * Idempotent: existing slugs are left alone, so running this against a live
 * database will not overwrite caffeine values that have been tuned by hand.
 */
async function seed() {
  const inserted = await db
    .insert(drinkTypes)
    .values(DRINK_TYPE_SEEDS)
    .onConflictDoNothing({ target: drinkTypes.slug })
    .returning({ slug: drinkTypes.slug })

  if (inserted.length === 0) {
    console.log('Drink types already seeded, nothing to do.')
  } else {
    console.log(`Seeded ${inserted.length} drink type(s): ${inserted.map((r) => r.slug).join(', ')}`)
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
