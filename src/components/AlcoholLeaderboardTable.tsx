import Image from 'next/image'
import { unitsFrom } from '@/lib/alcohol'
import type { AlcoholLeaderboardRow } from '@/server/alcohol'

/**
 * The team ranked by alcohol.
 *
 * Shaped like `LeaderboardTable`, and it does one thing that one does not: it
 * carries no "past the reference" marker. The caffeine table flags a day over
 * 400 mg, worded neutrally, because EFSA's figure is a health guideline a
 * leaderboard should not turn into a trophy. Alcohol has no equivalent number
 * that would survive the same treatment — a marker for "most units this week"
 * is a trophy however it is worded, and the driving limit is about an instant
 * rather than a total, so it means nothing against a week's sum.
 *
 * Units rather than grams for the same reason as the buttons: nobody drinks in
 * grams of ethanol.
 */
export function AlcoholLeaderboardTable({
  rows,
  highlightUserId,
}: {
  rows: AlcoholLeaderboardRow[]
  highlightUserId: string
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
            Units
          </th>
          <th scope="col" className="legend hidden py-2 text-right font-normal sm:table-cell">
            Drinks
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isMe = row.userId === highlightUserId

          return (
            <tr
              key={row.userId}
              className={`border-b border-hairline/40 ${isMe ? 'bg-zap/10' : ''}`}
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
                </span>
              </td>
              <td className="py-2.5 pr-2 text-right font-gauge text-sm text-foam">
                {(Math.round(unitsFrom(row.totalGrams) * 10) / 10).toFixed(1)}
              </td>
              <td className="hidden py-2.5 text-right font-gauge text-sm text-oat sm:table-cell">
                {row.drinkCount}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
