import { BadgeRow } from '@/components/BadgeList'
import { StatTile } from '@/components/StatTile'
import { formatMg } from '@/lib/caffeine'
import { formatDayTick } from '@/lib/format'
import { formatMonth } from '@/lib/wrapped'
import type { Wrapped } from '@/server/wrapped'

/**
 * The month, told in tiles and a short list.
 *
 * Shared by the page and the dialog rather than written twice, so the two
 * cannot drift into telling slightly different stories about the same month.
 */
export function WrappedSummary({ wrapped }: { wrapped: Wrapped }) {
  const share = wrapped.teamMg > 0 ? Math.round((wrapped.totalMg / wrapped.teamMg) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile legend="Caffeine" value={formatMg(wrapped.totalMg)} tone="crema" />
        <StatTile
          legend="Drinks"
          value={String(wrapped.drinkCount)}
          detail={`${wrapped.coffeeCount} coffee · ${wrapped.energyCount} energy`}
        />
        <StatTile legend="Rank" value={`${wrapped.rank} of ${wrapped.memberCount}`} />
        <StatTile
          legend="Longest streak"
          value={String(wrapped.longestStreak)}
          detail={`${wrapped.activeDays} days logged`}
          tone="zap"
        />
      </div>

      <dl className="space-y-2 text-sm">
        {wrapped.favourite && (
          <div className="flex justify-between gap-3">
            <dt className="text-oat">Your drink</dt>
            <dd className="text-foam">
              {wrapped.favourite.name} · {wrapped.favourite.count} of them
            </dd>
          </div>
        )}
        {wrapped.biggestDay && (
          <div className="flex justify-between gap-3">
            <dt className="text-oat">Biggest day</dt>
            <dd className="text-foam">
              {formatDayTick(wrapped.biggestDay.localDate)} · {formatMg(wrapped.biggestDay.mg)}
            </dd>
          </div>
        )}
        {wrapped.peakHour !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-oat">Your hour</dt>
            <dd className="text-foam">{String(wrapped.peakHour).padStart(2, '0')}:00</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-oat">Share of the office</dt>
          <dd className="text-foam">{share}%</dd>
        </div>
      </dl>

      {wrapped.badgeIds.length > 0 && (
        <div className="space-y-2 border-t border-hairline pt-3">
          <p className="legend">Earned in {formatMonth(wrapped.month)}</p>
          <BadgeRow badgeIds={wrapped.badgeIds} max={6} />
        </div>
      )}
    </div>
  )
}
