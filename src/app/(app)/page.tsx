import { BloodCaffeineChart } from '@/components/charts/BloodCaffeineChart'
import { ConsumptionChart } from '@/components/charts/ConsumptionChart'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { LogDrinkPanel } from '@/components/LogDrinkPanel'
import { PeriodTabs, parsePeriod } from '@/components/PeriodTabs'
import { StatTile } from '@/components/StatTile'
import { db } from '@/db'
import { PERIOD_TITLES, formatBucketLabel, formatOsloClock } from '@/lib/format'
import { formatMg } from '@/lib/caffeine'
import {
  SLEEP_THRESHOLD_MG,
  bloodCaffeineCurve,
  bodyLoadAt,
  curveWindow,
  sleepOutlook,
} from '@/lib/blood-caffeine'
import { requireMember } from '@/server/auth'
import { getUndoableDrink, listActiveDrinkTypes } from '@/server/drinks'
import {
  getUserIntakeEvents,
  getUserStreak,
  getUserSummary,
  getUserTimeSeries,
} from '@/server/stats'

/** The sentence under the caffeine curve, which is the point of the chart. */
function outlookFootnote(outlook: ReturnType<typeof sleepOutlook>): string {
  switch (outlook.kind) {
    case 'clear':
      return `Under ${SLEEP_THRESHOLD_MG} mg already — this shouldn't be what keeps you up.`
    case 'clears':
      return `Down under ${SLEEP_THRESHOLD_MG} mg around ${formatOsloClock(outlook.at)}.`
    case 'not-tonight':
      return `Still over ${SLEEP_THRESHOLD_MG} mg twelve hours from now.`
  }
}

export default async function PersonalDashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const member = await requireMember()
  const period = parsePeriod((await searchParams).period)

  // One instant for the whole render, so the curve, its window and the "now"
  // rule cannot disagree by the milliseconds between two `new Date()` calls.
  const now = new Date()
  const lookback = curveWindow([], now).from

  const [drinkTypes, undoable, today, summary, series, streak, intake] = await Promise.all([
    listActiveDrinkTypes(db),
    getUndoableDrink(db, { userId: member.userId }),
    getUserSummary(db, member.userId, 'today'),
    getUserSummary(db, member.userId, period),
    getUserTimeSeries(db, member.userId, period),
    getUserStreak(db, member.userId),
    getUserIntakeEvents(db, member.userId, { from: lookback, now }),
  ])

  const hasHistory = series.some((point) => point.mg > 0)

  const doses = intake.map((event) => ({ consumedAt: event.consumedAt, mg: event.caffeineMg }))
  const bounds = curveWindow(doses, now)
  const curve = bloodCaffeineCurve(doses, { ...bounds, now })
  const inSystemMg = bodyLoadAt(doses, now)

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

      {doses.length > 0 && (
        <ChartFrame
          legend="Milligrams · in your system"
          title="Caffeine still in you"
          columns={['Caffeine (mg)', 'Measured or projected']}
          rows={curve
            // Every tenth sample: the table is for reading, and 145 rows of
            // ten-minute steps is not reading.
            .filter((_, index) => index % 6 === 0)
            .map((point) => ({
              label: formatOsloClock(point.at),
              values: [String(Math.round(point.mg)), point.projected ? 'Projected' : 'Measured'],
            }))}
          footnote={
            <>
              {formatMg(inSystemMg)} in your system now. {outlookFootnote(sleepOutlook(doses, now))}{' '}
              Solid to now, dashed ahead. A rough model on a five-hour half-life, and{' '}
              {SLEEP_THRESHOLD_MG} mg is a rule of thumb rather than a published limit — caffeine
              clears at very different speeds in different people.
            </>
          }
        >
          <BloodCaffeineChart data={curve} now={now} />
        </ChartFrame>
      )}

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
