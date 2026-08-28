import Link from 'next/link'
import { BloodCaffeineChart } from '@/components/charts/BloodCaffeineChart'
import { ConsumptionChart } from '@/components/charts/ConsumptionChart'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { LogDrinkPanel } from '@/components/LogDrinkPanel'
import { RecentDrinks } from '@/components/RecentDrinks'
import { PeriodTabs, parsePeriod } from '@/components/PeriodTabs'
import { StatTile } from '@/components/StatTile'
import { db } from '@/db'
import { PERIOD_TITLES, formatBucketLabel, formatOsloClock } from '@/lib/format'
import { formatMg } from '@/lib/caffeine'
import {
  bloodCaffeineCurve,
  bodyLoadAt,
  curveWindow,
  lastCallBefore,
  sleepOutlook,
  type Profile,
} from '@/lib/blood-caffeine'
import { nextLocalTimeAfter } from '@/lib/time'
import { requireMember } from '@/server/auth'
import { getUndoableDrink, getUserRecentDrinks, listActiveDrinkTypes } from '@/server/drinks'
import {
  getUserFavouriteDrinkTypes,
  getUserIntakeEvents,
  getUserStreak,
  getUserSummary,
  getUserTimeSeries,
} from '@/server/stats'

/** The sentence under the caffeine curve, which is the point of the chart. */
function outlookFootnote(outlook: ReturnType<typeof sleepOutlook>, thresholdMg: number): string {
  switch (outlook.kind) {
    case 'clear':
      return `Under ${thresholdMg} mg already — this shouldn't be what keeps you up.`
    case 'clears':
      return `Down under ${thresholdMg} mg around ${formatOsloClock(outlook.at)}.`
    case 'not-tonight':
      return `Still over ${thresholdMg} mg twelve hours from now.`
  }
}

/**
 * The last-call tile's two lines.
 *
 * Names the drink it is talking about, because the answer depends entirely on
 * the size of the dose — "14:40" alone would invite people to read it as a
 * blanket curfew.
 */
function lastCall({
  doses,
  now,
  bedtimeLocal,
  profile,
  reference,
}: {
  doses: { consumedAt: Date; mg: number }[]
  now: Date
  bedtimeLocal: string
  profile: Profile
  reference: { name: string; caffeineMg: number } | undefined
}): { value: string; detail: string } {
  if (!reference) return { value: '—', detail: 'No drinks set up yet' }

  const bedtime = nextLocalTimeAfter(bedtimeLocal, now)
  const deadline = lastCallBefore(doses, {
    now,
    bedtime,
    doseMg: reference.caffeineMg,
    profile,
  })

  if (!deadline) {
    return { value: 'Passed', detail: `Another ${reference.name} would cost you sleep` }
  }

  return {
    value: formatOsloClock(deadline),
    detail: `Latest ${reference.name} before ${bedtimeLocal}`,
  }
}

export default async function PersonalDashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; history?: string }>
}) {
  const member = await requireMember()
  const params = await searchParams
  const period = parsePeriod(params.period)
  // The editable list shows today by default; "show earlier" widens it.
  const historyDays = params.history === '7' ? 7 : 0

  // One instant for the whole render, so the curve, its window and the "now"
  // rule cannot disagree by the milliseconds between two `new Date()` calls.
  const now = new Date()
  const profile = member.profile
  const lookback = curveWindow([], now, profile).from

  const [drinkTypes, favourites, undoable, today, summary, series, streak, intake, recent] =
    await Promise.all([
      listActiveDrinkTypes(db),
      getUserFavouriteDrinkTypes(db, member.userId, { limit: 4, now }),
      getUndoableDrink(db, { userId: member.userId }),
      getUserSummary(db, member.userId, 'today'),
      getUserSummary(db, member.userId, period),
      getUserTimeSeries(db, member.userId, period),
      getUserStreak(db, member.userId),
      getUserIntakeEvents(db, member.userId, { from: lookback, now }),
      getUserRecentDrinks(db, member.userId, { now, days: historyDays }),
    ])

  const hasHistory = series.some((point) => point.mg > 0)

  const doses = intake.map((event) => ({ consumedAt: event.consumedAt, mg: event.caffeineMg }))
  const bounds = curveWindow(doses, now, profile)
  const curve = bloodCaffeineCurve(doses, { ...bounds, now, profile })
  const inSystemMg = bodyLoadAt(doses, now, profile)

  // The member's own most-logged drink is the honest reference for "last call":
  // the answer depends on the size of the dose, so it should be the dose they
  // actually reach for.
  const call = lastCall({
    doses,
    now,
    bedtimeLocal: member.bedtimeLocal,
    profile,
    reference: favourites[0],
  })

  return (
    <>
      <LogDrinkPanel
        todayMg={today.totalMg}
        favourites={favourites}
        drinkTypes={drinkTypes}
        undoable={undoable}
      />

      <RecentDrinks drinks={recent} days={historyDays} />

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
        <div className="grid grid-cols-2 gap-3 pt-2">
          <StatTile legend="In your system · mg" value={String(Math.round(inSystemMg))} tone="crema" />
          <StatTile legend="Last call" value={call.value} detail={call.detail} />
        </div>
      )}

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
              {outlookFootnote(sleepOutlook(doses, now, profile), profile.sleepThresholdMg)} Solid
              to now, dashed ahead. Modelled on your{' '}
              {profile.eliminationHalfLifeMs / 3_600_000}-hour half-life and a{' '}
              {profile.sleepThresholdMg} mg threshold, both of which you can{' '}
              <Link href="/settings" className="underline decoration-hairline underline-offset-2">
                change in settings
              </Link>
              .
            </>
          }
        >
          <BloodCaffeineChart data={curve} now={now} thresholdMg={profile.sleepThresholdMg} />
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
