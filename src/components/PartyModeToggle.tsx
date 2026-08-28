'use client'

import { useTransition } from 'react'
import { togglePartyModeAction } from '@/app/(app)/party-actions'

/**
 * The switch, and the whole of party mode's discoverability.
 *
 * Understated when off, and it does not explain itself. Anyone who wants it
 * will recognise what it is; nobody who doesn't should have to read a pitch for
 * alcohol tracking on a page about coffee.
 *
 * `aria-pressed` rather than a checkbox: it is a control that changes the page,
 * not a field in a form, and screen readers should announce the state it is in
 * rather than a value it holds.
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
        className="font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase underline decoration-hairline underline-offset-4 transition-colors hover:text-foam disabled:opacity-60"
      >
        {on ? 'Party mode off' : 'Party mode'}
      </button>
    </div>
  )
}
