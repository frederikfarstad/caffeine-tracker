'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { logDrinkAction, undoLastDrinkAction } from '@/app/(app)/actions'
import { BuzzMeter } from '@/components/BuzzMeter'
import { DAILY_MAX_MG, formatMg, limitHeadline, limitStatus } from '@/lib/caffeine'
import type { ActiveDrinkType } from '@/server/drinks'
import type { UndoableDrink } from '@/server/drinks'

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
  drinkTypes,
  undoable,
}: {
  todayMg: number
  drinkTypes: ActiveDrinkType[]
  undoable: UndoableDrink | null
}) {
  const [optimisticMg, addMg] = useOptimistic(todayMg, (current, delta: number) =>
    Math.max(0, current + delta),
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

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
        <div className="flex flex-wrap gap-2">
          {drinkTypes.map((type) => (
            <button
              key={type.slug}
              type="button"
              disabled={pending}
              onClick={() => run(type.caffeineMg, () => logDrinkAction(type.slug))}
              className={`keycap flex min-h-13 flex-1 basis-[calc(50%-0.25rem)] items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left disabled:opacity-60 sm:basis-auto ${
                type.category === 'energy'
                  ? 'border-zap-dim bg-zap/10 hover:border-zap hover:bg-zap/15'
                  : 'border-crema-dim bg-crema/10 hover:border-crema hover:bg-crema/15'
              }`}
            >
              <span className="display text-[0.9375rem] leading-tight font-semibold text-foam">
                {type.name}
              </span>
              <span className="font-gauge text-[0.6875rem] text-oat">{type.caffeineMg}</span>
            </button>
          ))}
        </div>

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
