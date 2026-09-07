import Link from 'next/link'
import type { ComponentProps, ComponentType } from 'react'
import { PARTY_PERIODS, type PartyPeriod, type Period } from '@/lib/time'

/**
 * `next/link`'s public type hasn't caught up with its own runtime: the
 * app-dir `Link` implementation reads `unstable_dynamicOnHover` (confirmed in
 * `next/dist/client/app-dir/link.js`), but `next/link`'s exported prop type
 * doesn't list it. Widening the type at this one call site, rather than
 * reaching into Next's internal module path, is the narrower workaround —
 * safe to delete once the public type includes it.
 */
const HoverPrefetchLink = Link as ComponentType<
  ComponentProps<typeof Link> & { unstable_dynamicOnHover?: boolean }
>

const LABELS: Record<Period, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  all: 'All time',
}

const ORDER: Period[] = ['today', 'week', 'month', 'all']

/**
 * Period switcher.
 *
 * Plain links rather than client-side state: the period belongs in the URL so a
 * view can be shared, bookmarked and reloaded.
 *
 * `periods` narrows the strip for party mode, which has no all-time figures to
 * show. That is a real constraint rather than a layout choice — see
 * {@link PartyPeriod} — so the caller passes the set it can actually answer
 * instead of this component hiding a tab that would otherwise work.
 *
 * `unstable_dynamicOnHover` starts the full data fetch for a tab the moment a
 * pointer hovers it, rather than only on click — a real head start on desktop
 * without the cost of `prefetch={true}`, which would fetch every tab's full
 * data on every page view regardless of whether anyone touches another tab.
 * Skipped on the active tab: there is nothing to prefetch for the page
 * already on screen.
 */
export function PeriodTabs({
  active,
  basePath,
  periods = ORDER,
}: {
  active: Period
  basePath: string
  periods?: readonly Period[]
}) {
  return (
    <nav aria-label="Period" className="flex flex-wrap gap-1">
      {periods.map((period) => {
        const isActive = period === active
        return (
          <HoverPrefetchLink
            key={period}
            href={period === 'today' ? basePath : `${basePath}?period=${period}`}
            aria-current={isActive ? 'page' : undefined}
            unstable_dynamicOnHover={!isActive}
            className={`rounded-md px-3 py-1.5 font-gauge text-[0.6875rem] tracking-[0.12em] uppercase transition-colors ${
              isActive
                ? 'bg-crema text-roast'
                : 'border border-hairline text-oat hover:border-oat hover:text-foam'
            }`}
          >
            {LABELS[period]}
          </HoverPrefetchLink>
        )
      })}
    </nav>
  )
}

/** Narrow an untrusted `?period=` value to a known period. */
export function parsePeriod(value: string | string[] | undefined): Period {
  const candidate = Array.isArray(value) ? value[0] : value
  return ORDER.includes(candidate as Period) ? (candidate as Period) : 'today'
}

/**
 * The same, for party mode, where `all` is not answerable.
 *
 * `?period=all` falls back to today rather than erroring: a hand-typed or stale
 * URL should show something, and today is the cheapest honest answer.
 */
export function parsePartyPeriod(value: string | string[] | undefined): PartyPeriod {
  const candidate = Array.isArray(value) ? value[0] : value
  return PARTY_PERIODS.includes(candidate as PartyPeriod)
    ? (candidate as PartyPeriod)
    : 'today'
}
