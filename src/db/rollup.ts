import { sql } from 'drizzle-orm'
import type { Db } from './index'
import type { TestDb } from './test-db'

type AnyDb = Db | TestDb

/**
 * The rollup as it *should* be, derived from the authoritative log table.
 *
 * Shared by the rebuild and the drift check so the two can never disagree
 * about what "correct" means.
 */
const computedTotals = sql`
  SELECT
    user_id AS userId,
    local_date AS localDate,
    SUM(caffeine_mg) AS totalMg,
    SUM(CASE WHEN category = 'coffee' THEN caffeine_mg ELSE 0 END) AS coffeeMg,
    SUM(CASE WHEN category = 'energy' THEN caffeine_mg ELSE 0 END) AS energyMg,
    SUM(CASE WHEN category = 'other' THEN caffeine_mg ELSE 0 END) AS otherMg,
    SUM(CASE WHEN category = 'coffee' THEN 1 ELSE 0 END) AS coffeeCount,
    SUM(CASE WHEN category = 'energy' THEN 1 ELSE 0 END) AS energyCount,
    SUM(CASE WHEN category = 'other' THEN 1 ELSE 0 END) AS otherCount
  FROM drink_logs
  GROUP BY user_id, local_date
`

/**
 * Rebuild `daily_totals` from `drink_logs`.
 *
 * The rollup is derived data; this is the escape hatch that makes that claim
 * true in practice. Safe to run at any time.
 */
export async function rebuildRollup(db: AnyDb): Promise<number> {
  await db.run(sql`DELETE FROM daily_totals`)
  await db.run(sql`
    INSERT INTO daily_totals (user_id, local_date, total_mg, coffee_mg, energy_mg, other_mg, coffee_count, energy_count, other_count)
    ${computedTotals}
  `)

  const [{ count }] = await db
    .all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM daily_totals`)
  return count
}

export type RollupDrift = {
  userId: string
  localDate: string
  storedMg: number | null
  computedMg: number | null
}

/**
 * Rows where the stored rollup disagrees with a fresh aggregate of the logs.
 *
 * An empty result is the invariant the whole rollup design rests on, so it is
 * asserted in tests and reported by the CLI rather than merely assumed.
 */
export async function findRollupDrift(db: AnyDb): Promise<RollupDrift[]> {
  return db.all<RollupDrift>(sql`
    WITH computed AS (${computedTotals})
    SELECT
      COALESCE(stored.user_id, computed.userId) AS userId,
      COALESCE(stored.local_date, computed.localDate) AS localDate,
      stored.total_mg AS storedMg,
      computed.totalMg AS computedMg
    FROM daily_totals AS stored
    FULL OUTER JOIN computed
      ON stored.user_id = computed.userId
     AND stored.local_date = computed.localDate
    WHERE stored.total_mg IS NOT computed.totalMg
       OR stored.coffee_count IS NOT computed.coffeeCount
       OR stored.energy_count IS NOT computed.energyCount
       OR stored.other_count IS NOT computed.otherCount
  `)
}
