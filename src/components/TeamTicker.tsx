import { formatAgo } from '@/lib/format'
import type { TeamActivityEvent } from '@/server/stats'

/**
 * Who logged what, recently.
 *
 * A server component with no state: freshness comes from `LiveRefresh`, which
 * the team page already mounts and which re-renders this along with everything
 * else. A client-side ticking clock would cost a timer per row to say the same
 * thing thirty seconds sooner.
 *
 * Caffeine only, by construction — `getTeamActivity` does not read the alcohol
 * table, and that is a privacy decision rather than an oversight.
 */
export function TeamTicker({ events, now }: { events: TeamActivityEvent[]; now: Date }) {
  if (events.length === 0) return null

  return (
    <section className="panel space-y-3 p-4" aria-labelledby="ticker-heading">
      <p className="legend" id="ticker-heading">
        Just now
      </p>

      <ul className="divide-y divide-hairline">
        {events.map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5">
            <span className="min-w-0 flex-1 text-sm text-foam">
              <span className="text-oat">{event.displayName}</span> · {event.drinkName}
              {event.volumeMl && <span className="text-oat"> · {event.volumeMl} ml</span>}
            </span>
            <span className="font-gauge text-xs whitespace-nowrap text-oat">
              {formatAgo(event.consumedAt, now)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
