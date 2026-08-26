import Link from 'next/link'
import type { Period } from '@/lib/time'

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
 */
export function PeriodTabs({ active, basePath }: { active: Period; basePath: string }) {
  return (
    <nav aria-label="Period" className="flex flex-wrap gap-1">
      {ORDER.map((period) => {
        const isActive = period === active
        return (
          <Link
            key={period}
            href={period === 'today' ? basePath : `${basePath}?period=${period}`}
            aria-current={isActive ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 font-gauge text-[0.6875rem] tracking-[0.12em] uppercase transition-colors ${
              isActive
                ? 'bg-crema text-roast'
                : 'border border-hairline text-oat hover:border-oat hover:text-foam'
            }`}
          >
            {LABELS[period]}
          </Link>
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
