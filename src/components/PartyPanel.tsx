'use client'

import Link from 'next/link'
import { useOptimistic, useState, useTransition } from 'react'
import { logAlcoholAction, undoLastAlcoholAction } from '@/app/(app)/actions'
import { BacMeter } from '@/components/BacMeter'
import { bacHeadline, bacStatus, formatUnits, unitsFrom } from '@/lib/alcohol'
import { osloClockNow } from '@/lib/format'
import type { ActiveAlcoholType, UndoableAlcoholDrink } from '@/server/alcohol'

const HEADLINE_TONE = {
  clear: 'text-oat',
  'over-limit': 'text-crema',
  heavy: 'text-scald',
} as const

/**
 * Party mode's hero: what is in your blood, and the buttons that put it there.
 *
 * Built to mirror `LogDrinkPanel`, with one deliberate difference that is the
 * most important line in the file.
 *
 * **The permille figure is never optimistic.** Grams are a running total the
 * client can add to on the tap, so the unit count moves instantly the way the
 * caffeine readout does. A blood alcohol figure is a replayed simulation over
 * every dose of the evening, and guessing it on the client would make the
 * needle jump to a number the server then quietly contradicts a moment later —
 * on the one reading somebody might act on. So the gauge shows what the server
 * last said, and moves when the page refreshes.
 *
 * A tap therefore looks slightly odd on purpose: the units go up and the needle
 * does not. That is also physically true. Nothing has been absorbed yet.
 */
export function PartyPanel({
  todayGrams,
  drinkCount,
  bac,
  profilePersonal,
  drinkTypes,
  undoable,
}: {
  todayGrams: number
  drinkCount: number
  /** The server's reading. Never optimistic — see above. */
  bac: number
  /** False when the estimate used population figures rather than the member's. */
  profilePersonal: boolean
  drinkTypes: ActiveAlcoholType[]
  undoable: UndoableAlcoholDrink | null
}) {
  const [optimisticGrams, addGrams] = useOptimistic(todayGrams, (current, delta: number) =>
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
      addGrams(delta)
      const result = await action()
      // A failed action leaves the optimistic value to unwind on its own; all
      // that's left is to say what went wrong.
      if (!result.ok) setError(result.message)
    })
  }

  function log(type: ActiveAlcoholType) {
    run(type.alcoholGrams, () => logAlcoholAction(type.slug, earlierTime ?? undefined))
  }

  const status = bacStatus(bac)

  return (
    <section className="panel overflow-hidden" aria-labelledby="party-reading">
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8">
        <div className="flex justify-center sm:justify-start">
          <BacMeter bac={bac} />
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="legend" id="party-reading">
            In your blood · ‰
          </p>
          <p className="display text-7xl leading-none tracking-tighter text-foam">
            {bac.toFixed(2)}
          </p>
          <p className={`text-sm ${HEADLINE_TONE[status]}`}>{bacHeadline(bac)}</p>
          <p className="font-gauge text-[0.6875rem] tracking-[0.1em] text-oat uppercase">
            {formatUnits(optimisticGrams)} today
            {drinkCount > 0 && ` · ${drinkCount} ${drinkCount === 1 ? 'drink' : 'drinks'}`}
          </p>

          {/*
           * In the panel, in the status colour, and not tucked into a footnote
           * under the chart. A permille readout gets read as a driving decision
           * whether or not it is labelled as one, so the disclaimer has to sit
           * where the number is rather than where the reader might scroll to.
           */}
          <p className="pt-1 text-xs leading-relaxed text-scald">
            An estimate from {profilePersonal ? 'your figures' : 'an average adult'} and a guessed
            strength — not a breathalyser, and never a reason to decide you can drive.
          </p>

          {!profilePersonal && (
            <p className="text-xs leading-relaxed text-oat">
              Set your weight in{' '}
              <Link href="/settings" className="underline decoration-hairline underline-offset-2">
                settings
              </Link>{' '}
              and this uses your body rather than an 80 kg average.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-hairline bg-roast/40 p-4">
        {earlierTime !== null && (
          <p className="legend pb-2 text-crema" aria-live="polite">
            Logging at {earlierTime}
          </p>
        )}

        {/*
         * No volume picker beside these, unlike the caffeine buttons. A pint
         * and a 4cl measure are already the units people pour in, so the button
         * is the whole control — and a slider would invite a precision the ABV
         * estimate underneath it cannot back.
         */}
        <div className="flex flex-wrap gap-2">
          {drinkTypes.map((type) => (
            <button
              key={type.slug}
              type="button"
              disabled={pending}
              onClick={() => log(type)}
              className="keycap flex min-h-13 basis-full items-center justify-between gap-3 overflow-hidden rounded-xl border border-zap-dim bg-zap/10 px-4 py-2.5 text-left hover:bg-zap/15 disabled:opacity-60 sm:flex-1 sm:basis-[calc(50%-0.25rem)]"
            >
              <span className="display truncate text-[0.9375rem] leading-tight font-semibold text-foam">
                {type.name}
              </span>
              {/*
               * Units, not grams. Nobody pours in grams of ethanol, and the
               * unit is the figure the health advice everyone has already read
               * is written in.
               */}
              <span className="font-gauge text-[0.6875rem] whitespace-nowrap text-oat">
                {(Math.round(unitsFrom(type.alcoholGrams) * 10) / 10).toFixed(1)} u
              </span>
            </button>
          ))}
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
              htmlFor="earlier-drink-time"
              className="font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase"
            >
              Drunk at
            </label>
            <input
              id="earlier-drink-time"
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
              onClick={() => run(-undoable.alcoholGrams, undoLastAlcoholAction)}
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
