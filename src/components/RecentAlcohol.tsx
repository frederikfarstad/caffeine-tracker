'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { deleteAlcoholLogAction, updateAlcoholLogAction } from '@/app/(app)/actions'
import { unitsFrom } from '@/lib/alcohol'
import { formatOsloClock } from '@/lib/format'
import {
  applyOptimisticListAction,
  type OptimisticListAction,
  type WithOptimisticTime,
} from '@/lib/optimisticList'
import type { RecentAlcoholDrink } from '@/server/alcohol'

/**
 * Tonight's drinks, with a way to fix them.
 *
 * The ten-minute undo covers a mistap; this covers realising at midnight that
 * the round at nine went in twice, or that the one logged at 22:00 was actually
 * at 20:30. That matters more here than it does for caffeine: the curve is
 * driven by *when* each drink was, not just how many there were, so a drink at
 * the wrong hour moves the "sober by" answer rather than only a daily total.
 *
 * Editing is limited to the time and to deletion, the same as `RecentDrinks`.
 * There is no volume to correct, and changing which drink it was is a delete
 * and a re-log — two taps, against a per-row picker on every line.
 *
 * The list spans two local dates rather than one, because an evening does: at
 * 00:30 a list bounded to today would be empty while the gauge still read 0.8.
 * That is `getUserRecentAlcohol`'s doing; this component just renders what it
 * is handed.
 */
export function RecentAlcohol({ drinks }: { drinks: RecentAlcoholDrink[] }) {
  const [optimisticDrinks, applyOptimistic] = useOptimistic<
    WithOptimisticTime<RecentAlcoholDrink>[],
    OptimisticListAction
  >(drinks, applyOptimisticListAction)
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<number | null>(null)
  const [time, setTime] = useState('')
  const [error, setError] = useState<string | null>(null)

  function run(
    update: OptimisticListAction,
    action: () => Promise<{ ok: boolean; message: string | null }>,
  ) {
    startTransition(async () => {
      setError(null)
      applyOptimistic(update)
      const result = await action()
      // A failed action leaves the optimistic list to unwind on its own once
      // this transition settles against the unchanged `drinks` prop; all
      // that's left is to say what went wrong.
      if (!result.ok) setError(result.message)
      else setEditing(null)
    })
  }

  if (drinks.length === 0) return null

  return (
    <section className="panel space-y-3 p-4" aria-labelledby="recent-alcohol-heading">
      <p className="legend" id="recent-alcohol-heading">
        Logged tonight
      </p>

      <ul className="divide-y divide-hairline">
        {optimisticDrinks.map((drink) => (
          <li key={drink.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <span className="font-gauge text-xs text-oat">
              {drink.optimisticTimeLabel ?? formatOsloClock(drink.consumedAt)}
            </span>
            <span className="min-w-0 flex-1 text-sm text-foam">
              {drink.name}
              <span className="text-oat"> · {drink.volumeMl} ml</span>
            </span>
            <span className="font-gauge text-xs text-oat">
              {(Math.round(unitsFrom(drink.alcoholGrams) * 10) / 10).toFixed(1)} u
            </span>

            {editing === drink.id ? (
              <span className="flex w-full items-center gap-2 sm:w-auto">
                <input
                  type="time"
                  value={time}
                  aria-label={`New time for ${drink.name}`}
                  onChange={(event) => setTime(event.target.value)}
                  className="font-gauge rounded-md border border-hairline bg-roast px-2 py-1 text-sm text-foam"
                />
                <button
                  type="button"
                  disabled={pending || !time}
                  onClick={() =>
                    run({ type: 'edit', id: drink.id, timeLabel: time }, () =>
                      updateAlcoholLogAction(drink.id, time),
                    )
                  }
                  className="font-gauge text-[0.6875rem] tracking-[0.08em] text-crema uppercase underline decoration-crema/50 underline-offset-4 disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="font-gauge text-[0.6875rem] tracking-[0.08em] text-foam uppercase underline decoration-oat/60 underline-offset-4"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setEditing(drink.id)
                    setTime(drink.optimisticTimeLabel ?? formatOsloClock(drink.consumedAt))
                  }}
                  className="font-gauge text-[0.6875rem] tracking-[0.08em] text-foam uppercase underline decoration-oat/60 underline-offset-4 transition-colors hover:decoration-foam disabled:opacity-60"
                >
                  Edit time
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run({ type: 'delete', id: drink.id }, () => deleteAlcoholLogAction(drink.id))}
                  className="font-gauge text-[0.6875rem] tracking-[0.08em] text-oat uppercase underline decoration-oat/60 underline-offset-4 transition-colors hover:text-scald hover:decoration-scald disabled:opacity-60"
                >
                  Delete
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <p aria-live="polite" className="min-h-4 text-xs text-scald">
        {error}
      </p>
    </section>
  )
}
