import Link from 'next/link'
import { Suspense } from 'react'
import { BloodAlcoholChart } from '@/components/charts/BloodAlcoholChart'
import { BloodCaffeineChart } from '@/components/charts/BloodCaffeineChart'
import { ConsumptionChart } from '@/components/charts/ConsumptionChart'
import { WeekdayChart } from '@/components/charts/WeekdayChart'
import { HourOfDayChart } from '@/components/charts/HourOfDayChart'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { BadgeList } from '@/components/BadgeList'
import { LogDrinkPanel } from '@/components/LogDrinkPanel'
import { PartyModeToggle } from '@/components/PartyModeToggle'
import { PartyPanel } from '@/components/PartyPanel'
import { RecentAlcohol } from '@/components/RecentAlcohol'
import { RecentDrinks } from '@/components/RecentDrinks'
import { PeriodTabs, parsePeriod } from '@/components/PeriodTabs'
import { SkeletonBlock } from '@/components/Skeleton'
import { StatTile } from '@/components/StatTile'
import { db } from '@/db'
import { PERIOD_TITLES, formatBucketLabel, formatOsloClock, formatWeekday } from '@/lib/format'
import { formatMg } from '@/lib/caffeine'
import {
  bloodCaffeineCurve,
  bodyLoadAt,
  curveWindow,
  lastCallBefore,
  sleepOutlook,
  type Profile,
} from '@/lib/blood-caffeine'
import {
  bacAt,
  bloodAlcoholCurve,
  curveWindow as alcoholCurveWindow,
  drivingOutlook,
} from '@/lib/blood-alcohol'
import { isPartyTime } from '@/lib/party-time'
import { localDateOf, nextLocalTimeAfter, type Period } from '@/lib/time'
import { requireMember, type Member } from '@/server/auth'
import {
  getUndoableAlcoholDrink,
  getUserAlcoholEvents,
  getUserAlcoholToday,
  getUserRecentAlcohol,
  listActiveAlcoholTypes,
} from '@/server/alcohol'
import { buildContext, getBadgesFor } from '@/server/badges'
import { getUndoableDrink, getUserRecentDrinks, listActiveDrinkTypes } from '@/server/drinks'
import {
  getUserFavouriteDrinkTypes,
  getUserHourHistogram,
  getUserIntakeEvents,
  getUserPreviousPeriodMg,
  getUserStreak,
  getUserSummary,
  getUserTimeSeries,
  getUserWeekdayHistogram,
} from '@/server/stats'

const PREVIOUS_PERIOD_LABEL: Record<Exclude<Period, 'all'>, string> = {
  today: 'yesterday',
  week: 'last week',
  month: 'last month',
}

/**
 * The comparison line under the caffeine total, or undefined when there is
 * nothing to compare against: "all" has no earlier "all", and a zero
 * previous period would only produce a meaningless divide-by-zero percentage.
 */
function periodDeltaDetail(period: Period, currentMg: number, previousMg: number): string | undefined {
  if (period === 'all' || previousMg <= 0) return undefined

  const change = Math.round(((currentMg - previousMg) / previousMg) * 100)
  const label = PREVIOUS_PERIOD_LABEL[period]
  if (change === 0) return `Flat vs ${label}`
  return `${change > 0 ? '+' : ''}${change}% vs ${label}`
}

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

/** The sentence under the alcohol curve, which is the point of that chart. */
function soberFootnote(outlook: ReturnType<typeof drivingOutlook>): string {
  switch (outlook.kind) {
    case 'clear':
      return 'Nothing on board on this estimate — which is still an estimate.'
    case 'clears':
      return `Down to nothing around ${formatOsloClock(outlook.at)}, which is hours later than you will feel fine. That gap is the reason to draw this at all.`
    case 'not-tonight':
      return 'Still not clear twelve hours from now.'
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

/**
 * The chrome that marks the second half of the page.
 *
 * Only the trailing section gets it. The leading one opens the page and needs
 * no label to say what it is; the one below it needs a rule and a name so the
 * change of subject reads as deliberate rather than abrupt. Which of the two
 * that is depends on the day — see `lib/party-time.ts`.
 */
function TrailingSection({
  id,
  legend,
  title,
  children,
}: {
  id: string
  legend: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 border-t border-hairline pt-6" aria-labelledby={id}>
      <div className="space-y-1">
        <p className="legend" id={id}>
          {legend}
        </p>
        <h2 className="display text-2xl leading-tight tracking-tight text-foam">{title}</h2>
      </div>
      {children}
    </section>
  )
}

/**
 * The part of the caffeine section a tap has to wait for: the panel that logs
 * a drink, and the list that shows what you just logged. Small, fast queries
 * only, so this tier settles long before the stats and charts below it do.
 */
async function CaffeineCritical({
  member,
  now,
  historyDays,
}: {
  member: Member
  now: Date
  historyDays: number
}) {
  const [drinkTypes, favourites, undoable, today, recent] = await Promise.all([
    listActiveDrinkTypes(db),
    getUserFavouriteDrinkTypes(db, member.userId, { limit: 4, now }),
    getUndoableDrink(db, { userId: member.userId }),
    getUserSummary(db, member.userId, 'today'),
    getUserRecentDrinks(db, member.userId, { now, days: historyDays }),
  ])

  return (
    <>
      <LogDrinkPanel
        todayMg={today.totalMg}
        favourites={favourites}
        drinkTypes={drinkTypes}
        undoable={undoable}
      />
      <RecentDrinks drinks={recent} days={historyDays} />
    </>
  )
}

/**
 * Everything else in the caffeine section: the period's stats, the caffeine
 * curve, and the three charts. Slower than {@link CaffeineCritical} — nothing
 * here is needed to log or edit a drink — so it resolves under its own
 * Suspense boundary instead of blocking that panel from appearing.
 *
 * Fetches `favourites` and today's summary a second time (both cheap,
 * indexed reads) rather than sharing the copies {@link CaffeineCritical}
 * already has: the two components resolve independently, and lifting either
 * value above both boundaries would make them block together again — which
 * is the thing this split exists to avoid.
 */
async function CaffeineSecondary({
  member,
  now,
  period,
}: {
  member: Member
  now: Date
  period: Period
}) {
  const profile = member.profile
  const lookback = curveWindow([], now, profile).from

  const [summary, previousPeriodMg, series, weekdays, hours, streak, intake, favourites, badges, badgeContext] =
    await Promise.all([
      getUserSummary(db, member.userId, period),
      period === 'all'
        ? Promise.resolve(0)
        : getUserPreviousPeriodMg(db, member.userId, period, now),
      getUserTimeSeries(db, member.userId, period),
      /*
       * Always all time, independent of the period tabs — like the curve
       * below, this is a question about a habit rather than a selected
       * window. "Which day hits hardest" gated to "today" would render six
       * empty bars.
       */
      getUserWeekdayHistogram(db, member.userId, 'all', now),
      getUserHourHistogram(db, member.userId, period, now),
      getUserStreak(db, member.userId),
      getUserIntakeEvents(db, member.userId, { from: lookback, now }),
      getUserFavouriteDrinkTypes(db, member.userId, { limit: 4, now }),
      getBadgesFor(db, member.userId),
      /*
       * `localHour: null` because nothing is being logged here. The hour
       * badges must not fire merely because somebody opened the dashboard
       * before seven.
       */
      buildContext(db, member.userId, {
        today: localDateOf(now),
        localHour: null,
        needDistinctTypes: true,
      }),
    ])

  const hasHistory = series.some((point) => point.mg > 0)
  const hasWeekdayHistory = weekdays.some((bar) => bar.mg > 0)

  const doses = intake.map((event) => ({ consumedAt: event.consumedAt, mg: event.caffeineMg }))
  const bounds = curveWindow(doses, now, profile)
  const curve = bloodCaffeineCurve(doses, { ...bounds, now, profile })
  const inSystemMg = bodyLoadAt(doses, now, profile)

  // The member's own most-logged drink is the honest reference for "last
  // call": the answer depends on the size of the dose, so it should be the
  // dose they actually reach for.
  const call = lastCall({
    doses,
    now,
    bedtimeLocal: member.bedtimeLocal,
    profile,
    reference: favourites[0],
  })

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          legend={`Caffeine · ${PERIOD_TITLES[period]}`}
          value={formatMg(summary.totalMg)}
          detail={periodDeltaDetail(period, summary.totalMg, previousPeriodMg)}
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
        <>
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

          <ChartFrame
            legend="Milligrams · by hour of day"
            title="When you drink"
            columns={['Caffeine (mg)']}
            rows={hours.map((bar) => ({
              label: `${String(bar.hour).padStart(2, '0')}:00`,
              values: [String(bar.mg)],
            }))}
            footnote="Local hour in Oslo, summed across the whole period."
          >
            <HourOfDayChart data={hours} />
          </ChartFrame>
        </>
      ) : (
        <p className="panel px-4 py-8 text-center text-sm text-oat">
          Nothing logged {PERIOD_TITLES[period]}. Tap a drink above the moment you pour one.
        </p>
      )}

      {hasWeekdayHistory && (
        <ChartFrame
          legend="Milligrams · all time"
          title="Which day hits hardest"
          columns={['Caffeine (mg)']}
          rows={weekdays.map((bar) => ({
            label: formatWeekday(bar.weekday),
            values: [String(bar.mg)],
          }))}
          footnote="Summed across your whole history, not an average — some weekdays have come around more often than others."
        >
          <WeekdayChart data={weekdays} />
        </ChartFrame>
      )}

      <BadgeList earned={badges.map((badge) => badge.badgeId)} context={badgeContext} />
    </>
  )
}

/**
 * The whole party-mode block: hero panel, recent list, BAC chart.
 *
 * Not split into a critical/secondary pair like the caffeine section is.
 * `PartyPanel`'s own reading (current blood alcohol) needs the same windowed
 * event query the BAC chart draws from — there is no cheap rollup-only number
 * standing in for it the way `today.totalMg` stands in for the caffeine
 * gauge — so splitting it would only buy a second copy of the same query for
 * no independent-loading benefit. One boundary keeps party mode (opt-in, off
 * by default) from delaying the caffeine tiers above it without pretending
 * to a finer split it can't actually get from this data.
 */
async function PartySection({ member, now }: { member: Member; now: Date }) {
  const alcoholLookback = alcoholCurveWindow([], now, member.bodyProfile).from

  const [alcoholTypes, undoableAlcohol, alcoholToday, alcoholEvents, recentAlcohol] = await Promise.all([
    listActiveAlcoholTypes(db),
    getUndoableAlcoholDrink(db, { userId: member.userId }),
    getUserAlcoholToday(db, member.userId, { now }),
    getUserAlcoholEvents(db, member.userId, { from: alcoholLookback, now }),
    getUserRecentAlcohol(db, member.userId, { now }),
  ])

  // Party mode's own curve, off the same single `now` as the caffeine one, so
  // the window, the reading and the "now" rule cannot disagree.
  const alcoholDoses = alcoholEvents.map((event) => ({
    consumedAt: event.consumedAt,
    grams: event.alcoholGrams,
  }))
  const alcoholBounds = alcoholCurveWindow(alcoholDoses, now, member.bodyProfile)
  const bacCurve = bloodAlcoholCurve(alcoholDoses, {
    ...alcoholBounds,
    now,
    profile: member.bodyProfile,
  })
  const bacNow = bacAt(alcoholDoses, now, member.bodyProfile)

  return (
    <>
      <PartyPanel
        todayGrams={alcoholToday.totalGrams}
        drinkCount={alcoholToday.drinkCount}
        bac={bacNow}
        profilePersonal={member.bodyProfile.personal}
        drinkTypes={alcoholTypes}
        undoable={undoableAlcohol}
      />

      <RecentAlcohol drinks={recentAlcohol} />

      {alcoholDoses.length > 0 && (
        <ChartFrame
          legend="Permille · in your blood"
          title="Blood alcohol tonight"
          columns={['Blood alcohol (‰)', 'Measured or projected']}
          rows={bacCurve
            // Every sixth sample, for the same reason as the caffeine table:
            // it is for reading, and ten-minute steps are not.
            .filter((_, index) => index % 6 === 0)
            .map((point) => ({
              label: formatOsloClock(point.at),
              values: [point.bac.toFixed(2), point.projected ? 'Projected' : 'Measured'],
            }))}
          footnote={
            <>
              {soberFootnote(drivingOutlook(alcoholDoses, now, member.bodyProfile))} Solid to now,
              dashed ahead. Modelled on{' '}
              {member.bodyProfile.personal
                ? `${member.bodyProfile.weightKg} kg`
                : 'an average 80 kg adult'}{' '}
              and a constant 0.15 ‰ an hour, neither of which knows what you actually poured or
              whether you had dinner.
            </>
          }
        >
          <BloodAlcoholChart data={bacCurve} now={now} />
        </ChartFrame>
      )}
    </>
  )
}

function CriticalSkeleton() {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8">
        <SkeletonBlock className="mx-auto h-40 w-40 shrink-0 rounded-full sm:mx-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-10 w-32" />
          <SkeletonBlock className="h-3 w-40" />
        </div>
      </div>
      <div className="border-t border-hairline bg-roast/40 p-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonBlock key={i} className="h-13 flex-1 basis-full sm:basis-[calc(50%-0.25rem)]" />
          ))}
        </div>
      </div>
    </section>
  )
}

function SecondarySkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[4.5rem]" />
        ))}
      </div>
      <SkeletonBlock className="h-[228px] w-full" />
    </>
  )
}

function PartySkeleton() {
  return (
    <>
      <CriticalSkeleton />
      <SkeletonBlock className="h-[228px] w-full" />
    </>
  )
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

  // One instant for the whole render, so every Suspense-bounded section below
  // agrees on the same "now" even though they resolve at different times.
  const now = new Date()
  const party = member.partyMode

  /*
   * Which half of the page leads.
   *
   * From four on a Friday afternoon until four on the Saturday morning the
   * alcohol section goes first — `lib/party-time.ts` argues for those hours.
   * It only ever reorders: both sections render either way, nothing is hidden,
   * and none of it happens for a member who has not switched party mode on.
   *
   * Whichever section comes second carries the heading and the rule above it.
   * The one that leads opens the page and needs neither.
   */
  const partyLeads = party && isPartyTime(now)

  const caffeineBlock = (
    <>
      <Suspense fallback={<CriticalSkeleton />}>
        <CaffeineCritical member={member} now={now} historyDays={historyDays} />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <p className="legend">Your intake</p>
        <div className="flex items-center gap-3">
          {/*
           * A link rather than a nav pill. The layout already argues that a
           * fifth pill wraps the bar to two rows on a phone, and that has not
           * stopped being true.
           */}
          <Link
            href="/wrapped"
            className="text-sm text-oat underline decoration-hairline underline-offset-2"
          >
            Last month
          </Link>
          <PeriodTabs active={period} basePath="/" />
        </div>
      </div>

      <Suspense fallback={<SecondarySkeleton />}>
        <CaffeineSecondary member={member} now={now} period={period} />
      </Suspense>
    </>
  )

  const partyBlock = (
    <Suspense fallback={<PartySkeleton />}>
      <PartySection member={member} now={now} />
    </Suspense>
  )

  return (
    <>
      {partyLeads ? (
        <>
          {partyBlock}
          <TrailingSection id="caffeine-heading" legend="Caffeine" title="Still on the coffee">
            {caffeineBlock}
          </TrailingSection>
        </>
      ) : (
        <>
          {caffeineBlock}
          {party && (
            <TrailingSection id="party-heading" legend="Party mode" title="The other kind of buzz">
              {partyBlock}
            </TrailingSection>
          )}
        </>
      )}

      <PartyModeToggle on={party} />
    </>
  )
}
