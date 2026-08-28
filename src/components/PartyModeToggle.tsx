'use client'

import { useTransition } from 'react'
import { togglePartyModeAction } from '@/app/(app)/party-actions'

/**
 * The switch, and the whole of party mode's discoverability.
 *
 * A chip rather than the underlined small caps this started as. It still does
 * not explain itself — nobody who has not gone looking should have to read a
 * pitch for alcohol tracking on a page about coffee — but "quiet" and
 * "invisible" are different things, and the only control that can reach a whole
 * feature has to look like a control.
 *
 * The on-state carries the zap accent, so the switch shows its own position
 * instead of asking the reader to infer it from the verb in the label. Zap
 * rather than crema because crema is the coffee half of the palette.
 *
 * `aria-pressed` rather than a checkbox: it is a control that changes the page,
 * not a field in a form, and screen readers should announce the state it is in
 * rather than a value it holds.
 *
 * The label stays "Party mode" in both states for that reason. It used to flip
 * to "Party mode off" when on, which is an *action* label — and paired with
 * `aria-pressed="true"` it announces "party mode off, pressed", which is the
 * opposite of what is true. The name names the thing; the dot and the accent
 * say which way it is set.
 */
export function PartyModeToggle({ on }: { on: boolean }) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex justify-end pt-2">
      <button
        type="button"
        disabled={pending}
        aria-pressed={on}
        onClick={() => startTransition(() => togglePartyModeAction(!on))}
        className={`chip ${on ? 'border-zap-dim bg-zap/10 hover:border-zap' : ''}`}
      >
        <span aria-hidden className={on ? 'text-zap' : 'text-oat'}>
          ●
        </span>
        Party mode
      </button>
    </div>
  )
}
