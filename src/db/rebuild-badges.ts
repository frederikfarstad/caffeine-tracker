import { db } from './index'
import { findBadgeDrift, rebuildBadges } from '@/server/badges'

/**
 * Report any drift between `earned_badges` and `drink_logs`, then rebuild.
 *
 * On a healthy database this reports no drift — which is the point of running
 * it as a check.
 */
async function main() {
  const drift = await findBadgeDrift(db)

  if (drift.length === 0) {
    console.log('No drift: earned_badges matches drink_logs.')
  } else {
    console.warn(`Found ${drift.length} drifted badge(s):`)
    for (const row of drift) {
      console.warn(
        `  ${row.userId} ${row.badgeId}: ${row.stored ? 'stored but not earned' : 'earned but not stored'}`,
      )
    }
  }

  const rows = await rebuildBadges(db)
  console.log(`Rebuilt earned_badges: ${rows} row(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
