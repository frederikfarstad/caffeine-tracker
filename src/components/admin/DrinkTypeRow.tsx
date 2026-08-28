'use client'

import { useActionState } from 'react'
import { updateDrinkType, type AdminFormState } from '@/app/(app)/admin/actions'
import { CATEGORY_LABELS } from '@/lib/caffeine'
import type { DrinkCategory } from '@/lib/caffeine'

const initialState: AdminFormState = { error: null, notice: null }

export function DrinkTypeRow({
  type,
}: {
  type: {
    id: number
    slug: string
    name: string
    category: DrinkCategory
    volumeMl: number | null
    caffeineMg: number
    isActive: boolean
  }
}) {
  const [state, action, pending] = useActionState(updateDrinkType, initialState)

  return (
    <form action={action} className="panel space-y-3 p-4">
      <input type="hidden" name="id" value={type.id} />

      <div className="flex items-baseline justify-between gap-2">
        <p className="legend">
          {CATEGORY_LABELS[type.category]}
          {type.volumeMl ? ` · ${type.volumeMl} ml` : ''}
        </p>
        <p className="font-gauge text-[0.625rem] text-oat">{type.slug}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex-1 basis-40 space-y-1">
          <span className="legend block">Name</span>
          <input
            name="name"
            defaultValue={type.name}
            required
            maxLength={60}
            className="w-full rounded-md border border-hairline bg-roast px-3 py-2 text-sm text-foam focus:border-crema focus:outline-none"
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
            step={1}
            defaultValue={type.caffeineMg}
            required
            className="w-full rounded-md border border-hairline bg-roast px-3 py-2 font-gauge text-sm text-foam focus:border-crema focus:outline-none"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-oat">
          <input
            name="isActive"
            type="checkbox"
            defaultChecked={type.isActive}
            className="size-4 accent-[var(--color-crema)]"
          />
          Available to log
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-crema px-4 py-2 display text-sm font-semibold text-roast transition-colors hover:bg-crema/90 disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

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
