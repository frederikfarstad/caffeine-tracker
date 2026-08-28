'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { deleteDrinkLogAction, updateDrinkLogAction } from '@/app/(app)/actions'
import { formatOsloClock } from '@/lib/format'
import type { RecentDrink } from '@/server/drinks'

/**
 * Today's drinks, with a way to fix them.
 *
 * The ten-minute undo covers a mistap; this covers realising at four o'clock
 * that the 11:00 coffee was actually at 09:30, or that it was logged twice.
 * Without it the only remedy was asking an admin to edit the database.
 *
 * Editing is deliberately limited to the time and to deletion. Changing which
 * drink it was is possible on the server but not offered here: deleting and
 * re-logging is two taps, and a per-row drink picker would double the size of
 * this list for a rarer case.
 */
export function RecentDrinks({ drinks, days }: { drinks: RecentDrink[]; days: number }) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<number | null>(null)
  const [time, setTime] = useState('')
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<{ ok: boolean; message: string | null }>) {
    startTransition(async () => {
      setError(null)
      const result = await action()
      if (!result.ok) setError(result.message)
      else setEditing(null)
    })
  }

  if (drinks.length === 0) return null

  return (
    <section className="panel space-y-3 p-4" aria-labelledby="recent-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="legend" id="recent-heading">
          {days === 0 ? 'Logged today' : `Logged in the last ${days} days`}
        </p>
        <Link
          href={days === 0 ? '/?history=7' : '/'}
          scroll={false}
          className="font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase underline decoration-hairline underline-offset-4 transition-colors hover:text-foam"
        >
          {days === 0 ? 'Show earlier' : 'Today only'}
        </Link>
      </div>

      <ul className="divide-y divide-hairline">
        {drinks.map((drink) => (
          <li key={drink.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <span className="font-gauge text-xs text-oat">{formatOsloClock(drink.consumedAt)}</span>
            <span className="min-w-0 flex-1 text-sm text-foam">
              {drink.name}
              {drink.volumeMl && (
                <span className="text-oat"> · {drink.volumeMl} ml</span>
              )}
            </span>
            <span className="font-gauge text-xs text-oat">{drink.caffeineMg} mg</span>

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
                  onClick={() => run(() => updateDrinkLogAction(drink.id, { time }))}
                  className="font-gauge text-[0.625rem] tracking-[0.08em] text-crema uppercase underline decoration-hairline underline-offset-4 disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="font-gauge text-[0.625rem] tracking-[0.08em] text-oat uppercase underline decoration-hairline underline-offset-4"
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
                    setTime(formatOsloClock(drink.consumedAt))
                  }}
                  className="font-gauge text-[0.625rem] tracking-[0.08em] text-oat uppercase underline decoration-hairline underline-offset-4 transition-colors hover:text-foam disabled:opacity-60"
                >
                  Edit time
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteDrinkLogAction(drink.id))}
                  className="font-gauge text-[0.625rem] tracking-[0.08em] text-oat uppercase underline decoration-hairline underline-offset-4 transition-colors hover:text-scald disabled:opacity-60"
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
