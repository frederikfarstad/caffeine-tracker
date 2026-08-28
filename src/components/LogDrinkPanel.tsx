'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { logDrinkAction, undoLastDrinkAction } from '@/app/(app)/actions'
import { BuzzMeter } from '@/components/BuzzMeter'
import { DrinkSheet } from '@/components/DrinkSheet'
import { VolumePicker } from '@/components/VolumePicker'
import { DAILY_MAX_MG, formatMg, limitHeadline, limitStatus } from '@/lib/caffeine'
import type { ActiveDrinkType } from '@/server/drinks'
import type { UndoableDrink } from '@/server/drinks'

/**
 * The current Oslo wall clock as `HH:MM`, for prefilling the time input.
 *
 * Formatted in the app's timezone rather than the browser's, so someone opening
 * the app from a conference abroad still sees — and logs against — the clock the
 * rest of the numbers are bucketed by.
 */
function osloClockNow(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date())
}

const HEADLINE_TONE = {
  ok: 'text-oat',
  approaching: 'text-crema',
  over: 'text-scald',
} as const

/**
 * The hero: today's reading, and the buttons that change it.
 *
 * The optimistic total lives here rather than in the gauge so that the needle
 * and the readout move on the same tick as the tap. Waiting for the server
 * round trip would make the primary action of the whole app feel slow.
 */
export function LogDrinkPanel({
  todayMg,
  favourites,
  drinkTypes,
  undoable,
}: {
  todayMg: number
  /** The member's own most-logged drinks: the one-tap row. */
  favourites: ActiveDrinkType[]
  /** The whole catalogue, for the search sheet. */
  drinkTypes: ActiveDrinkType[]
  undoable: UndoableDrink | null
}) {
  const [optimisticMg, addMg] = useOptimistic(todayMg, (current, delta: number) =>
    Math.max(0, current + delta),
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // `null` is the normal case: the buttons log the moment they are tapped. A
  // string means the next tap is backdated to that time today.
  const [earlierTime, setEarlierTime] = useState<string | null>(null)

  function run(delta: number, action: () => Promise<{ ok: boolean; message: string | null }>) {
    startTransition(async () => {
      setError(null)
      addMg(delta)
      const result = await action()
      // A failed action leaves the optimistic value to unwind on its own; all
      // that's left is to say what went wrong.
      if (!result.ok) setError(result.message)
    })
  }

  /** Log the standard serving of a drink. */
  function log(type: ActiveDrinkType) {
    run(type.caffeineMg, () => logDrinkAction(type.slug, earlierTime ?? undefined))
  }

  const status = limitStatus(optimisticMg)

  return (
    <section className="panel overflow-hidden" aria-labelledby="today-heading">
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8">
        <div className="flex justify-center sm:justify-start">
          <BuzzMeter todayMg={optimisticMg} />
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="legend" id="today-heading">
            Today&apos;s buzz · mg
          </p>
          <p className="display text-7xl leading-none tracking-tighter text-foam">
            {Math.round(optimisticMg)}
          </p>
          <p className={`text-sm ${HEADLINE_TONE[status]}`}>{limitHeadline(optimisticMg)}</p>
          <p className="pt-1 text-xs leading-relaxed text-oat">
            Estimates, not measurements. {formatMg(DAILY_MAX_MG)} is the{' '}
            <a
              href="https://www.efsa.europa.eu/en/efsajournal/pub/4102"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-hairline underline-offset-2 hover:text-oat"
            >
              EFSA daily reference
            </a>{' '}
            for healthy adults, not personal medical advice.
          </p>
        </div>
      </div>

      <div className="border-t border-hairline bg-roast/40 p-4">
        {/*
         * With a time set, the buttons no longer mean "now" — so they say so
         * above the grid, where the tap is about to happen, rather than only in
         * the control that changed it.
         */}
        {earlierTime !== null && (
          <p className="legend pb-2 text-crema" aria-live="polite">
            Logging at {earlierTime}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {favourites.map((type) => (
            <div
              key={type.slug}
              /*
               * One per row on a phone, two from `sm`. Two-up at 375px left
               * about 150px for the name, which truncated "Energy 0.33L" and
               * "Energy 0.5L" to the same "Energy 0…" — the buttons became
               * indistinguishable on the device the app is mostly used on.
               */
              className={`flex min-h-13 basis-full items-stretch gap-px overflow-hidden rounded-xl border sm:flex-1 sm:basis-[calc(50%-0.25rem)] ${
                type.category === 'energy' ? 'border-zap-dim' : 'border-crema-dim'
              }`}
            >
              <button
                type="button"
                disabled={pending}
                onClick={() => log(type)}
                className={`keycap flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-2.5 text-left disabled:opacity-60 ${
                  type.category === 'energy'
                    ? 'bg-zap/10 hover:bg-zap/15'
                    : 'bg-crema/10 hover:bg-crema/15'
                }`}
              >
                <span className="display truncate text-[0.9375rem] leading-tight font-semibold text-foam">
                  {type.name}
                </span>
                <span className="font-gauge text-[0.6875rem] text-oat">{type.caffeineMg}</span>
              </button>

              {/*
               * Its own control beside the button rather than a long-press on
               * it: a long-press cannot be reached by keyboard and is invisible
               * to anyone who has not been told about it.
               */}
              <span
                className={`flex items-center px-1.5 ${
                  type.category === 'energy' ? 'bg-zap/10' : 'bg-crema/10'
                }`}
              >
                <VolumePicker
                  type={type}
                  pending={pending}
                  onLog={(choice) =>
                    run(choice.caffeineMg, () =>
                      logDrinkAction(type.slug, earlierTime ?? undefined, choice.volumeMl),
                    )
                  }
                />
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <DrinkSheet drinkTypes={drinkTypes} onPick={log} pending={pending} />
        </div>

        {earlierTime === null ? (
          <button
            type="button"
            onClick={() => setEarlierTime(osloClockNow())}
            className="mt-3 font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase underline decoration-hairline underline-offset-4 transition-colors hover:text-foam"
          >
            Log an earlier time
          </button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label
              htmlFor="earlier-time"
              className="font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase"
            >
              Drunk at
            </label>
            <input
              id="earlier-time"
              type="time"
              value={earlierTime}
              // Times later today are refused by the server anyway; `max` lets
              // the browser say so before a round trip.
              max={osloClockNow()}
              onChange={(event) => setEarlierTime(event.target.value)}
              className="font-gauge rounded-lg border border-hairline bg-roast px-2.5 py-1.5 text-sm text-foam"
            />
            <button
              type="button"
              onClick={() => setEarlierTime(null)}
              className="font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase underline decoration-hairline underline-offset-4 transition-colors hover:text-foam"
            >
              Back to now
            </button>
          </div>
        )}

        <div className="mt-3 flex min-h-6 items-center justify-between gap-3">
          <p aria-live="polite" className="text-xs text-scald">
            {error}
          </p>
          {undoable && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(-undoable.caffeineMg, undoLastDrinkAction)}
              className="font-gauge text-[0.6875rem] tracking-[0.12em] whitespace-nowrap text-oat uppercase underline decoration-hairline underline-offset-4 transition-colors hover:text-foam disabled:opacity-60"
            >
              Undo {undoable.name}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
