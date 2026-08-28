import { redirect } from 'next/navigation'
import { AlcoholLeaderboardTable } from '@/components/AlcoholLeaderboardTable'
import { LiveRefresh } from '@/components/LiveRefresh'
import { PeriodTabs, parsePartyPeriod } from '@/components/PeriodTabs'
import { db } from '@/db'
import { formatUnits } from '@/lib/alcohol'
import { PERIOD_TITLES } from '@/lib/format'
import { PARTY_PERIODS } from '@/lib/time'
import { requireMember } from '@/server/auth'
import { getAlcoholLeaderboard } from '@/server/alcohol'

export const metadata = { title: 'Party — Buzz' }

/**
 * The alcohol leaderboard.
 *
 * Its own route rather than a second section on `/leaderboard`. Two boards on
 * one page would share a `?period=` parameter that one of them cannot take
 * every value of, and disambiguating that costs more than a route does.
 *
 * Party mode is checked here as well as in the nav, because a link that is not
 * rendered is not an access control — anyone can type the URL. Redirecting home
 * rather than 404ing: the page exists, it is just not switched on for you, and
 * the switch is on the page you land on.
 */
export default async function PartyPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const member = await requireMember()
  if (!member.partyMode) redirect('/')

  const period = parsePartyPeriod((await searchParams).period)
  const rows = await getAlcoholLeaderboard(db, period)

  const leaders = rows.filter((row) => row.rank === 1 && row.totalGrams > 0)

  return (
    <>
      <LiveRefresh />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="legend">Ranked by alcohol</p>
          <h1 className="display text-3xl leading-tight tracking-tight text-foam">
            Who&apos;s at the bar
          </h1>
        </div>
        <PeriodTabs active={period} basePath="/party" periods={PARTY_PERIODS} />
      </div>

      {leaders.length > 0 && (
        <p className="panel px-4 py-3 text-sm text-oat">
          <span className="text-foam">{leaders.map((row) => row.displayName).join(' and ')}</span>{' '}
          {leaders.length > 1 ? 'are ahead' : 'is ahead'} {PERIOD_TITLES[period]}, on{' '}
          {formatUnits(leaders[0].totalGrams)}.
        </p>
      )}

      <div className="panel px-4 py-2">
        <AlcoholLeaderboardTable rows={rows} highlightUserId={member.userId} />
      </div>

      {/*
       * Said once, at the bottom, rather than beside every row. The dashboard
       * gauge is the reading somebody might act on and carries the warning
       * there; this page is a scoreboard of what people logged, and repeating
       * the driving line here would dilute it in the place it matters.
       */}
      <p className="max-w-prose text-xs leading-relaxed text-oat">
        One unit is 12.8 g of pure alcohol, the Norwegian standard. The counts come from what
        people tapped and the typical strength of each drink, so they are estimates of estimates.
        It stops at this month: a running total of everything anyone has ever drunk is a different
        kind of number, and not one a scoreboard should keep.
      </p>
    </>
  )
}
