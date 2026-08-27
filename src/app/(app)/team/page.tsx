import { CategorySplitBar } from '@/components/charts/CategorySplitBar'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { ConsumptionChart } from '@/components/charts/ConsumptionChart'
import { HourOfDayChart } from '@/components/charts/HourOfDayChart'
import { LiveRefresh } from '@/components/LiveRefresh'
import { PeriodTabs, parsePeriod } from '@/components/PeriodTabs'
import { StatTile } from '@/components/StatTile'
import { db } from '@/db'
import { CATEGORY_LABELS, formatMg } from '@/lib/caffeine'
import { PERIOD_TITLES, formatBucketLabel } from '@/lib/format'
import { requireMember } from '@/server/auth'
import { getTeamHourHistogram, getTeamSplit, getTeamTimeSeries } from '@/server/stats'

export const metadata = { title: 'Everyone — Buzz' }

export default async function TeamDashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  await requireMember()
  const period = parsePeriod((await searchParams).period)

  const [series, hours, split] = await Promise.all([
    getTeamTimeSeries(db, period),
    getTeamHourHistogram(db, period),
    getTeamSplit(db, period),
  ])

  const totalMg = split.reduce((sum, entry) => sum + entry.mg, 0)
  const totalDrinks = split.reduce((sum, entry) => sum + entry.count, 0)
  const peak = hours.reduce((best, bar) => (bar.mg > best.mg ? bar : best), hours[0])
  const hasData = totalMg > 0

  return (
    <>
      <LiveRefresh />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="legend">Everyone combined</p>
          <h1 className="display text-3xl leading-tight tracking-tight text-foam">
            Ovio and Teoria, all of it
          </h1>
        </div>
        <PeriodTabs active={period} basePath="/team" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          legend={`Caffeine · ${PERIOD_TITLES[period]}`}
          value={formatMg(totalMg)}
          tone="crema"
        />
        <StatTile legend={`Drinks · ${PERIOD_TITLES[period]}`} value={String(totalDrinks)} />
        <StatTile
          legend="Busiest hour"
          value={hasData ? `${String(peak.hour).padStart(2, '0')}:00` : '—'}
          detail={hasData ? `${formatMg(peak.mg)} logged` : 'Nothing logged yet'}
          tone="zap"
        />
      </div>

      {hasData ? (
        <>
          <ChartFrame
            legend={`Milligrams · ${PERIOD_TITLES[period]}`}
            title={
              period === 'today' ? 'Today, hour by hour' : 'Combined caffeine over time'
            }
            columns={['Caffeine (mg)']}
            rows={series.map((point) => ({
              label: formatBucketLabel(point.bucket, period),
              values: [String(point.mg)],
            }))}
          >
            <ConsumptionChart data={series} period={period} />
          </ChartFrame>

          <ChartFrame
            legend="Milligrams · by hour of day"
            title="When everyone drinks"
            columns={['Caffeine (mg)']}
            rows={hours.map((bar) => ({
              label: `${String(bar.hour).padStart(2, '0')}:00`,
              values: [String(bar.mg)],
            }))}
            footnote="Local hour in Oslo, summed across the whole period."
          >
            <HourOfDayChart data={hours} />
          </ChartFrame>

          <ChartFrame
            legend={`Share of caffeine · ${PERIOD_TITLES[period]}`}
            title="Coffee against energy drinks"
            columns={['Caffeine (mg)', 'Drinks']}
            rows={split.map((entry) => ({
              label: CATEGORY_LABELS[entry.category],
              values: [String(entry.mg), String(entry.count)],
            }))}
          >
            <CategorySplitBar split={split} />
          </ChartFrame>
        </>
      ) : (
        <p className="panel px-4 py-8 text-center text-sm text-oat">
          Nothing logged {PERIOD_TITLES[period]}. The charts appear the moment someone
          pours a coffee.
        </p>
      )}
    </>
  )
}
