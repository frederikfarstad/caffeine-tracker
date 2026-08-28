'use client'

import { useActionState } from 'react'
import { createDrinkType, type AdminFormState } from '@/app/(app)/admin/actions'

const initialState: AdminFormState = { error: null, notice: null }

const FIELD_CLASS =
  'w-full rounded-md border border-hairline bg-roast px-3 py-2 text-sm text-foam focus:border-crema focus:outline-none'

export function NewDrinkTypeForm() {
  const [state, action, pending] = useActionState(createDrinkType, initialState)

  return (
    <form action={action} className="panel space-y-3 p-4">
      <p className="legend">Add a drink</p>

      <div className="flex flex-wrap gap-3">
        <label className="flex-1 basis-40 space-y-1">
          <span className="legend block">Name</span>
          <input name="name" required maxLength={60} placeholder="Nocco 0.33L" className={FIELD_CLASS} />
        </label>

        <label className="flex-1 basis-32 space-y-1">
          <span className="legend block">Short id</span>
          <input
            name="slug"
            required
            maxLength={40}
            pattern="[a-z0-9_]+"
            placeholder="nocco_033"
            className={`${FIELD_CLASS} font-gauge`}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex-1 basis-32 space-y-1">
          <span className="legend block">Category</span>
          <select name="category" defaultValue="energy" className={FIELD_CLASS}>
            <option value="coffee">Coffee</option>
            <option value="energy">Energy drink</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="basis-28 space-y-1">
          <span className="legend block">Volume ml</span>
          <input
            name="volumeMl"
            type="number"
            inputMode="numeric"
            min={1}
            max={5000}
            placeholder="330"
            className={`${FIELD_CLASS} font-gauge`}
          />
        </label>

        <label className="basis-28 space-y-1">
          <span className="legend block">Caffeine mg</span>
          <input
            name="caffeineMg"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            required
            placeholder="105"
            className={`${FIELD_CLASS} font-gauge`}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-crema px-4 py-2 display text-sm font-semibold text-crema transition-colors hover:bg-crema hover:text-roast disabled:opacity-60"
      >
        {pending ? 'Adding…' : 'Add drink'}
      </button>

      {state.error && (
        <p role="alert" className="text-sm text-scald">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p aria-live="polite" className="text-sm text-zap">
          {state.notice}
        </p>
      )}
    </form>
  )
}
