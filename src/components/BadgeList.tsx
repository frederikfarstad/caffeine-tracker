import { BADGES, badgeById, type BadgeContext, type BadgeId } from '@/lib/badges'

/**
 * A row of badges beside a name.
 *
 * Capped, because one decorated member should not push every other row of the
 * leaderboard onto a second line. The overflow is counted rather than hidden,
 * so the table never quietly understates what somebody has.
 */
export function BadgeRow({ badgeIds, max = 3 }: { badgeIds: BadgeId[]; max?: number }) {
  if (badgeIds.length === 0) return null

  const shown = badgeIds.slice(0, max)
  const rest = badgeIds.length - shown.length

  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      {shown.map((id) => (
        <span
          key={id}
          title={badgeById(id).description}
          className="rounded border border-hairline px-1.5 py-0.5 font-gauge text-[0.5625rem] tracking-[0.08em] text-oat uppercase"
        >
          {badgeById(id).name}
        </span>
      ))}
      {rest > 0 && <span className="font-gauge text-[0.625rem] text-oat">+{rest}</span>}
    </span>
  )
}

/**
 * Everything there is to earn, earned first.
 *
 * Unearned badges show progress only where the badge is a count, because a
 * fraction is the part that makes one worth chasing. The rest simply say what
 * they are: "log a drink before seven" needs no progress bar, it needs an
 * early morning.
 */
export function BadgeList({ earned, context }: { earned: BadgeId[]; context: BadgeContext }) {
  const held = new Set(earned)
  const ordered = [...BADGES].sort((a, b) => Number(held.has(b.id)) - Number(held.has(a.id)))

  return (
    <section className="panel space-y-3 p-4" aria-labelledby="badges-heading">
      <p className="legend" id="badges-heading">
        Badges · {earned.length} of {BADGES.length}
      </p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {ordered.map((badge) => {
          const has = held.has(badge.id)
          const progress = has ? null : badge.progress(context)

          return (
            <li
              key={badge.id}
              className={`flex items-baseline justify-between gap-2 rounded-md border border-hairline px-3 py-2 ${
                has ? 'text-foam' : 'text-oat opacity-60'
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm">{badge.name}</span>
                <span className="block text-xs text-oat">{badge.description}</span>
              </span>
              {progress && (
                <span className="font-gauge text-xs whitespace-nowrap text-oat">
                  {progress.have}/{progress.need}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
