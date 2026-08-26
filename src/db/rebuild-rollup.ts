import { db } from './index'
import { findRollupDrift, rebuildRollup } from './rollup'

/**
 * Report any drift between `daily_totals` and `drink_logs`, then rebuild.
 *
 * On a healthy database this reports no drift — which is the point of running
 * it as a check.
 */
async function main() {
  const drift = await findRollupDrift(db)

  if (drift.length === 0) {
    console.log('No drift: daily_totals matches drink_logs.')
  } else {
    console.warn(`Found ${drift.length} drifted row(s):`)
    for (const row of drift) {
      console.warn(
        `  ${row.userId} ${row.localDate}: stored ${row.storedMg ?? 'none'} mg, computed ${row.computedMg ?? 'none'} mg`,
      )
    }
  }

  const rows = await rebuildRollup(db)
  console.log(`Rebuilt daily_totals: ${rows} row(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
