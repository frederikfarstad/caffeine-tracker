'use client'

import { useActionState } from 'react'
import { saveSettings, type SettingsFormState } from '@/app/(app)/settings/actions'
import {
  MAX_HALF_LIFE_HOURS,
  MAX_THRESHOLD_MG,
  MIN_HALF_LIFE_HOURS,
  MIN_THRESHOLD_MG,
} from '@/server/settings'

const initialState: SettingsFormState = { error: null, notice: null }

const FIELD_CLASS =
  'w-full rounded-md border border-hairline bg-roast px-3 py-2 text-sm text-foam focus:border-crema focus:outline-none'

/**
 * The three numbers the caffeine model can't guess.
 *
 * Each field carries its own explanation rather than deferring to a help page,
 * because nobody knows their own caffeine half-life and a bare number input
 * invites people to type something worse than the default. The copy's job is to
 * make leaving it alone feel like a decision.
 */
export function SettingsForm({
  halfLifeHours,
  sleepThresholdMg,
  bedtimeLocal,
}: {
  halfLifeHours: number
  sleepThresholdMg: number
  bedtimeLocal: string
}) {
  const [state, action, pending] = useActionState(saveSettings, initialState)

  return (
    <form action={action} className="panel space-y-5 p-5">
      <div className="space-y-2">
        <label htmlFor="halfLifeHours" className="legend block">
          Caffeine half-life · hours
        </label>
        <input
          id="halfLifeHours"
          name="halfLifeHours"
          type="number"
          step="0.5"
          min={MIN_HALF_LIFE_HOURS}
          max={MAX_HALF_LIFE_HOURS}
          defaultValue={halfLifeHours}
          required
          className={`${FIELD_CLASS} font-gauge max-w-32`}
        />
        <p className="text-xs leading-relaxed text-oat">
          How long your body takes to clear half a dose. Five hours is typical for an adult, and
          if you have no idea, leave it there. Smoking roughly halves it; pregnancy and some
          medications, including several hormonal contraceptives, can double it. Measured values
          in healthy adults run from about 2.5 to 10 hours.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="sleepThresholdMg" className="legend block">
          Sleep threshold · mg
        </label>
        <input
          id="sleepThresholdMg"
          name="sleepThresholdMg"
          type="number"
          step="5"
          min={MIN_THRESHOLD_MG}
          max={MAX_THRESHOLD_MG}
          defaultValue={sleepThresholdMg}
          required
          className={`${FIELD_CLASS} font-gauge max-w-32`}
        />
        <p className="text-xs leading-relaxed text-oat">
          How much caffeine you reckon you can still have on board without it costing you sleep.
          This one is a rule of thumb, not a published limit — there is no clean threshold in the
          research, only the finding that a normal dose within six hours of bed measurably
          disrupts sleep. 50 mg is roughly what an afternoon coffee decays to over those hours.
          Lower it if you sleep badly.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="bedtimeLocal" className="legend block">
          Usual bedtime
        </label>
        <input
          id="bedtimeLocal"
          name="bedtimeLocal"
          type="time"
          defaultValue={bedtimeLocal}
          required
          className={`${FIELD_CLASS} font-gauge max-w-32`}
        />
        <p className="text-xs leading-relaxed text-oat">
          Used for one thing: working out how late you could still have a drink and be under your
          threshold once you turn in.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        <button
          type="submit"
          disabled={pending}
          className="keycap rounded-xl border border-crema-dim bg-crema/10 px-4 py-2.5 font-gauge text-[0.6875rem] tracking-[0.12em] text-foam uppercase transition-colors hover:border-crema hover:bg-crema/15 disabled:opacity-60"
        >
          {pending ? 'Saving' : 'Save settings'}
        </button>

        <p aria-live="polite" className="text-xs text-oat">
          {state.error ? <span className="text-scald">{state.error}</span> : state.notice}
        </p>
      </div>
    </form>
  )
}
