import Image from 'next/image'
import { BadgeRow } from '@/components/BadgeList'
import { DAILY_MAX_MG, formatMg, limitStatus } from '@/lib/caffeine'
import type { EarnedBadge } from '@/server/badges'
import type { LeaderboardRow } from '@/server/stats'

/**
 * The team ranked by caffeine.
 *
 * Rank is shown explicitly rather than implied by row order, so the shared
 * ranks produced by a tie are legible.
 *
 * The over-reference marker only appears for today, because 400mg is a *daily*
 * figure — flagging it on a monthly total would be meaningless. It is worded
 * neutrally on purpose: the leaderboard should not turn a health reference into
 * a trophy.
 */
export function LeaderboardTable({
  rows,
  badges,
  highlightUserId,
  showDailyReference,
}: {
  rows: LeaderboardRow[]
  /** Earned badges by member id. Missing and empty mean the same thing here. */
  badges: Map<string, EarnedBadge[]>
  highlightUserId: string
  showDailyReference: boolean
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-hairline text-left">
          <th scope="col" className="legend py-2 pr-2 font-normal">
            #
          </th>
          <th scope="col" className="legend py-2 pr-2 font-normal">
            Name
          </th>
          <th scope="col" className="legend py-2 pr-2 text-right font-normal">
            mg
          </th>
          <th scope="col" className="legend hidden py-2 pr-2 text-right font-normal sm:table-cell">
            Coffee
          </th>
          <th scope="col" className="legend hidden py-2 text-right font-normal sm:table-cell">
            Energy
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isMe = row.userId === highlightUserId
          const overReference = showDailyReference && limitStatus(row.totalMg) === 'over'

          return (
            <tr
              key={row.userId}
              className={`border-b border-hairline/40 ${isMe ? 'bg-crema/10' : ''}`}
            >
              <td className="py-2.5 pr-2 font-gauge text-xs text-oat">{row.rank}</td>
              <td className="py-2.5 pr-2">
                <span className="flex items-center gap-2.5">
                  {row.image ? (
                    <Image
                      src={row.image}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6 shrink-0 rounded-full"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="grid size-6 shrink-0 place-items-center rounded-full bg-grounds-raised font-gauge text-[0.625rem] text-oat"
                    >
                      {row.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="truncate text-sm text-foam">
                    {row.displayName}
                    {isMe && <span className="text-oat"> · you</span>}
                  </span>
                  {/*
                   * Inside the name cell rather than in a column of their own,
                   * so the table still fits a phone. Oldest first: the ones you
                   * earned early say more about you than this morning's.
                   */}
                  <BadgeRow
                    badgeIds={(badges.get(row.userId) ?? [])
                      .slice()
                      .sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime())
                      .map((badge) => badge.badgeId)}
                  />
                  {overReference && (
                    <span className="shrink-0 rounded border border-scald/50 px-1.5 py-0.5 font-gauge text-[0.5625rem] tracking-[0.08em] text-scald uppercase">
                      Past {DAILY_MAX_MG} mg
                    </span>
                  )}
                </span>
              </td>
              <td className="py-2.5 pr-2 text-right font-gauge text-sm text-foam">
                {formatMg(row.totalMg)}
              </td>
              <td className="hidden py-2.5 pr-2 text-right font-gauge text-sm text-oat sm:table-cell">
                {row.coffeeCount}
              </td>
              <td className="hidden py-2.5 text-right font-gauge text-sm text-oat sm:table-cell">
                {row.energyCount}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
