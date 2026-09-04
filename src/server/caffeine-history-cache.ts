import { unstable_cache } from 'next/cache'
import { db } from '@/db'
import { curveWindow, type Profile } from '@/lib/blood-caffeine'
import { localDateOf } from '@/lib/time'
import { buildContext, getEarnedBadgeIds } from './badges'
import type { ActiveDrinkType } from './drinks'
import type { BadgeContext, BadgeId } from '@/lib/badges'
import {
  getUserFavouriteDrinkTypes,
  getUserIntakeEvents,
  getUserStreak,
  getUserWeekdayHistogram,
  type WeekdayBar,
} from './stats'

/**
 * The cache tag scoping every period-independent Me-page query to one user.
 *
 * Invalidated with `updateTag` (not `revalidateTag`) from every Server Action
 * that can change what it covers, so the same request's own `refresh()` sees
 * the write — for every one of `logDrink`/`undoLastDrink`/`deleteDrinkLog`,
 * using that function's own `affectedUserIds` (the drinker, and the drink
 * type's author too when a `pioneer` badge is in play), not just the acting
 * user, so a badge revoked or granted by someone else's action doesn't wait
 * on the five-minute safety-net TTL to stop looking stale for them.
 */
export function caffeineHistoryTag(userId: string): string {
  return `caffeine-history:${userId}`
}

export type CaffeineHistory = {
  /** `IntakeEvent[]`, with `consumedAt` as epoch ms: the cache entry is a
   * plain `JSON.stringify`, and `JSON.parse` does not revive dates. */
  intakeEventsMs: { consumedAtMs: number; caffeineMg: number }[]
  favourites: ActiveDrinkType[]
  weekdays: WeekdayBar[]
  badgeIds: BadgeId[]
  badgeContext: BadgeContext
  streak: number
}

/** Five minutes: a safety net, not the primary invalidation mechanism. */
const CACHE_REVALIDATE_SECONDS = 300

/**
 * Everything on the Me page that does not depend on the period tabs: the
 * caffeine curve's raw doses, the weekday breakdown, badges, and the streak.
 *
 * Switching a period tab re-renders the whole page — Server Components have
 * no memory of a previous render to diff against, so nothing here would be
 * skipped just because its own inputs didn't change. Caching it by tag is
 * what actually stops a tab click from re-running these queries every time,
 * rather than merely reordering when they show up.
 *
 * `now` and `lookback` are computed inside the cached function, from its own
 * `new Date()`, not passed in — an argument becomes part of the cache key
 * (`unstable_cache` keys on the serialized call), and a value that changes
 * every millisecond would mean no two calls ever share an entry. The upper
 * bound this produces on `getUserIntakeEvents` can only under-count doses
 * logged after the cache was populated, and any such log immediately
 * invalidates this same tag — so a cache hit is, by construction, one that no
 * write has touched since.
 */
export async function getCaffeineHistory(userId: string, profile: Profile): Promise<CaffeineHistory> {
  return unstable_cache(
    async () => {
      const now = new Date()
      const lookback = curveWindow([], now, profile).from

      const [intake, favourites, weekdays, badgeIds, streak] = await Promise.all([
        getUserIntakeEvents(db, userId, { from: lookback, now }),
        getUserFavouriteDrinkTypes(db, userId, { limit: 4, now }),
        getUserWeekdayHistogram(db, userId, 'all', now),
        getEarnedBadgeIds(db, userId),
        getUserStreak(db, userId),
      ])
      const badgeContext = await buildContext(db, userId, {
        today: localDateOf(now),
        localHour: null,
        needDistinctTypes: true,
      })

      return {
        intakeEventsMs: intake.map((event) => ({
          consumedAtMs: event.consumedAt.getTime(),
          caffeineMg: event.caffeineMg,
        })),
        favourites,
        weekdays,
        badgeIds,
        badgeContext,
        streak,
      }
    },
    [caffeineHistoryTag(userId)],
    { tags: [caffeineHistoryTag(userId)], revalidate: CACHE_REVALIDATE_SECONDS },
  )()
}
