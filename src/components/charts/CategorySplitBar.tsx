import { CATEGORY_LABELS, formatMg } from '@/lib/caffeine'
import type { CategorySplit } from '@/server/stats'

const MARK_COLOR: Record<string, string> = {
  coffee: 'var(--color-chart-coffee)',
  energy: 'var(--color-chart-energy)',
  other: 'var(--color-oat)',
}

/**
 * Coffee against energy drinks, as one stacked bar.
 *
 * Plain HTML rather than a chart library: two or three magnitudes summing to a
 * whole need a proportion, not a plot. A pie would be worse at the same job.
 *
 * Identity is never colour alone — each segment is directly labelled beneath the
 * bar with its name, milligrams and drink count.
 */
export function CategorySplitBar({ split }: { split: CategorySplit[] }) {
  const present = split.filter((entry) => entry.mg > 0)
  const total = present.reduce((sum, entry) => sum + entry.mg, 0)

  if (total === 0) {
    return <p className="py-4 text-sm text-oat">No drinks logged in this period yet.</p>
  }

  return (
    <div className="space-y-3">
      {/* gap-0.5 is the 2px surface gap that keeps adjacent fills distinct. */}
      <div className="flex h-6 gap-0.5 overflow-hidden rounded-md" role="presentation">
        {present.map((entry) => (
          <div
            key={entry.category}
            style={{
              width: `${(entry.mg / total) * 100}%`,
              backgroundColor: MARK_COLOR[entry.category],
            }}
          />
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {present.map((entry) => (
          <li key={entry.category} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: MARK_COLOR[entry.category] }}
            />
            <span className="text-sm text-foam">{CATEGORY_LABELS[entry.category]}</span>
            <span className="font-gauge text-xs text-oat">
              {formatMg(entry.mg)} · {entry.count} {entry.count === 1 ? 'drink' : 'drinks'} ·{' '}
              {Math.round((entry.mg / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
