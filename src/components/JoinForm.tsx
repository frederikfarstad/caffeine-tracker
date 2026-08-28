'use client'

import { useActionState } from 'react'
import { submitJoinCode, type JoinFormState } from '@/app/join/actions'

const initialState: JoinFormState = { error: null }

export function JoinForm() {
  const [state, action, pending] = useActionState(submitJoinCode, initialState)

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="code" className="legend block">
          Team code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? 'code-error' : undefined}
          className="w-full rounded-lg border border-hairline bg-grounds px-4 py-3 font-gauge text-base text-foam placeholder:text-oat focus:border-crema focus:outline-none"
          placeholder="the code from Slack"
        />
      </div>

      {state.error && (
        <p id="code-error" role="alert" className="text-sm text-scald">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-crema px-5 py-3.5 display text-base font-semibold text-roast transition-colors hover:bg-crema/90 disabled:opacity-60"
      >
        {pending ? 'Checking…' : 'Join the team'}
      </button>
    </form>
  )
}
