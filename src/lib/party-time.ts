/**
 * When the dashboard leads with party mode rather than with caffeine.
 *
 * The two halves of the page answer different questions and people want them in
 * a different order depending on when they look. On a Tuesday morning the
 * question is "how much coffee have I had"; at six on a Friday it is not. So
 * the page reorders itself rather than making anyone scroll past the wrong one.
 *
 * A rule about the clock rather than a setting, deliberately: a setting would be
 * one more thing to find and to keep in step with a week that already has an
 * obvious shape. It only ever reorders — nothing is hidden by it, and the
 * ordering does nothing at all for members who have not switched party mode on.
 *
 * Oslo time throughout, via `lib/time.ts`, so this is right on both sides of a
 * daylight saving change rather than drifting by an hour twice a year.
 */

import { localBuckets, weekdayOf } from './time'

/** ISO weekday numbers, matching what {@link weekdayOf} returns. */
const FRIDAY = 5
const SATURDAY = 6

/**
 * When Friday stops being a work day.
 *
 * Four in the afternoon rather than five: Norwegian offices empty early on a
 * Friday, and being an hour late to reorder the page is worse than being an
 * hour early. Nothing is hidden either way.
 */
export const PARTY_FROM_HOUR = 16

/**
 * When Friday night finally ends.
 *
 * Four in the morning, not midnight. An evening does not stop at the date
 * change — `getUserRecentAlcohol` spans two local dates for exactly this
 * reason — and a page that reshuffles itself under someone at 00:00 while they
 * are still using it would be the one moment the reordering actively annoys.
 */
export const PARTY_UNTIL_HOUR = 4

/**
 * Whether now counts as Friday evening in Oslo.
 *
 * Callers must still check that the member has party mode on; this answers only
 * the question about the clock.
 */
export function isPartyTime(now: Date): boolean {
  const { localDate, localHour } = localBuckets(now)
  const weekday = weekdayOf(localDate)

  if (weekday === FRIDAY) return localHour >= PARTY_FROM_HOUR
  if (weekday === SATURDAY) return localHour < PARTY_UNTIL_HOUR

  return false
}
