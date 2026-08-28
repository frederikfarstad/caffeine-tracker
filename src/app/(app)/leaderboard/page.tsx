import { LeaderboardTable } from '@/components/LeaderboardTable'
import { LiveRefresh } from '@/components/LiveRefresh'
import { PeriodTabs, parsePeriod } from '@/components/PeriodTabs'
import { db } from '@/db'
import { formatMg } from '@/lib/caffeine'
import { PERIOD_TITLES } from '@/lib/format'
import { requireMember } from '@/server/auth'
import { getLeaderboard } from '@/server/stats'

export const metadata = { title: 'Leaderboard — Buzz' }

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const member = await requireMember()
  const period = parsePeriod((await searchParams).period)
  const rows = await getLeaderboard(db, period)

  const leaders = rows.filter((row) => row.rank === 1 && row.totalMg > 0)

  return (
    <>
      <LiveRefresh />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="legend">Ranked by caffeine</p>
          <h1 className="display text-3xl leading-tight tracking-tight text-foam">
            Who&apos;s running the place
          </h1>
        </div>
        <PeriodTabs active={period} basePath="/leaderboard" />
      </div>

      {leaders.length > 0 && (
        <p className="panel px-4 py-3 text-sm text-oat">
          <span className="text-foam">
            {leaders.map((row) => row.displayName).join(' and ')}
          </span>{' '}
          {leaders.length > 1 ? 'are running the place' : 'is running the place'} {PERIOD_TITLES[period]}, on{' '}
          {formatMg(leaders[0].totalMg)}.
        </p>
      )}

      <div className="panel px-4 py-2">
        <LeaderboardTable
          rows={rows}
          highlightUserId={member.userId}
          showDailyReference={period === 'today'}
        />
      </div>
    </>
  )
}
