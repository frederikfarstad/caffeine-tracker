import { ConsumptionChart } from '@/components/charts/ConsumptionChart'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { LogDrinkPanel } from '@/components/LogDrinkPanel'
import { PeriodTabs, parsePeriod } from '@/components/PeriodTabs'
import { StatTile } from '@/components/StatTile'
import { db } from '@/db'
import { PERIOD_TITLES, formatBucketLabel } from '@/lib/format'
import { formatMg } from '@/lib/caffeine'
import { requireMember } from '@/server/auth'
import { getUndoableDrink, listActiveDrinkTypes } from '@/server/drinks'
import { getUserStreak, getUserSummary, getUserTimeSeries } from '@/server/stats'

export default async function PersonalDashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const member = await requireMember()
  const period = parsePeriod((await searchParams).period)

  const [drinkTypes, undoable, today, summary, series, streak] = await Promise.all([
    listActiveDrinkTypes(db),
    getUndoableDrink(db, { userId: member.userId }),
    getUserSummary(db, member.userId, 'today'),
    getUserSummary(db, member.userId, period),
    getUserTimeSeries(db, member.userId, period),
    getUserStreak(db, member.userId),
  ])

  const hasHistory = series.some((point) => point.mg > 0)

  return (
    <>
      <LogDrinkPanel todayMg={today.totalMg} drinkTypes={drinkTypes} undoable={undoable} />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <p className="legend">Your intake</p>
        <PeriodTabs active={period} basePath="/" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          legend={`Caffeine · ${PERIOD_TITLES[period]}`}
          value={formatMg(summary.totalMg)}
          tone="crema"
        />
        <StatTile
          legend={`Drinks · ${PERIOD_TITLES[period]}`}
          value={String(summary.drinkCount)}
          detail={`${summary.coffeeCount} coffee · ${summary.energyCount} energy`}
        />
        <StatTile
          legend={`Rank · ${PERIOD_TITLES[period]}`}
          value={`${summary.rank} of ${summary.memberCount}`}
        />
        <StatTile
          legend="Streak · days"
          value={String(streak)}
          detail={streak === 0 ? 'Start one today' : 'Consecutive days'}
          tone="zap"
        />
      </div>

      {hasHistory ? (
        <ChartFrame
          legend={`Milligrams · ${PERIOD_TITLES[period]}`}
          title={period === 'today' ? 'Your day, hour by hour' : 'Your caffeine over time'}
          columns={['Caffeine (mg)']}
          rows={series.map((point) => ({
            label: formatBucketLabel(point.bucket, period),
            values: [String(point.mg)],
          }))}
        >
          <ConsumptionChart data={series} period={period} />
        </ChartFrame>
      ) : (
        <p className="panel px-4 py-8 text-center text-sm text-oat">
          Nothing logged {PERIOD_TITLES[period]}. Tap a drink above the moment you pour one.
        </p>
      )}
    </>
  )
}
