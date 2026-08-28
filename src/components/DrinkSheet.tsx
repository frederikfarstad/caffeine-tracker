'use client'

import { useActionState, useMemo, useRef, useState } from 'react'
import { addDrinkTypeAction, type NewDrinkState } from '@/app/(app)/actions'
import { CATEGORY_LABELS, type DrinkCategory } from '@/lib/caffeine'
import type { ActiveDrinkType } from '@/server/drinks'

const CATEGORY_ORDER: DrinkCategory[] = ['coffee', 'energy', 'other']

const FIELD_CLASS =
  'w-full rounded-md border border-hairline bg-roast px-3 py-2 text-sm text-foam focus:border-crema focus:outline-none'

const initialState: NewDrinkState = { error: null, notice: null }

/**
 * The whole catalogue, behind a search box.
 *
 * The favourites row in front of this covers the four drinks anyone actually
 * orders; this is for the fifth. It exists because the catalogue is open to
 * every member now, so it will not stay a tidy grid of four for long — and a
 * flat wall of thirty buttons would cost the app the thing it is for, which is
 * logging a coffee in one tap while standing next to the machine.
 *
 * A native `<dialog>`, for the focus trap and Escape handling that come with it.
 */
export function DrinkSheet({
  drinkTypes,
  onPick,
  pending,
}: {
  drinkTypes: ActiveDrinkType[]
  onPick: (type: ActiveDrinkType) => void
  pending: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [state, addAction, addPending] = useActionState(addDrinkTypeAction, initialState)

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = needle
      ? drinkTypes.filter((type) => type.name.toLowerCase().includes(needle))
      : drinkTypes

    return CATEGORY_ORDER.map((category) => ({
      category,
      types: matches.filter((type) => type.category === category),
    })).filter((group) => group.types.length > 0)
  }, [drinkTypes, query])

  function open() {
    ref.current?.showModal()
    // Focus the search rather than the first drink: with a long list, typing is
    // the fast path, and it keeps the dialog from opening "on" a random drink.
    searchRef.current?.focus()
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="chip"
      >
        Search all drinks
      </button>

      <dialog
        ref={ref}
        aria-labelledby="drink-sheet-heading"
        className="panel m-auto w-[min(30rem,calc(100vw-2rem))] p-0 text-foam backdrop:bg-roast/80"
      >
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="legend">Every drink</p>
              <h2
                id="drink-sheet-heading"
                className="display text-xl leading-tight tracking-tight text-foam"
              >
                What are you having?
              </h2>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase transition-colors hover:text-foam"
            >
              Close
            </button>
          </div>

          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name"
            aria-label="Search drinks by name"
            className={FIELD_CLASS}
          />

          <div className="max-h-[45vh] space-y-4 overflow-y-auto">
            {grouped.map((group) => (
              <section key={group.category} className="space-y-1.5">
                <p className="legend">{CATEGORY_LABELS[group.category]}</p>
                {group.types.map((type) => (
                  <button
                    key={type.slug}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      onPick(type)
                      ref.current?.close()
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5 text-left transition-colors hover:border-oat disabled:opacity-60"
                  >
                    <span className="text-sm text-foam">{type.name}</span>
                    <span className="font-gauge text-[0.6875rem] whitespace-nowrap text-oat">
                      {type.caffeineMg} mg{type.volumeMl ? ` · ${type.volumeMl} ml` : ''}
                    </span>
                  </button>
                ))}
              </section>
            ))}

            {grouped.length === 0 && (
              <p className="py-4 text-center text-sm text-oat">
                Nothing matches “{query.trim()}”. Add it below.
              </p>
            )}
          </div>

          <div className="space-y-3 border-t border-hairline pt-4">
            {adding ? (
              /*
               * Keyed on the notice so a successful add remounts the form with
               * empty fields, rather than an effect reaching in to clear them.
               * The form stays open: adding two drinks in a row is a real thing
               * to want, and the new one appears in the list above either way.
               */
              <form key={state.notice ?? 'new'} action={addAction} className="space-y-3">
                <p className="legend">Add a drink for everyone</p>

                <label className="block space-y-1">
                  <span className="legend block">Name</span>
                  <input
                    name="name"
                    required
                    maxLength={60}
                    defaultValue={query.trim()}
                    placeholder="Oat latte"
                    className={FIELD_CLASS}
                  />
                </label>

                <div className="flex flex-wrap gap-3">
                  <label className="flex-1 basis-32 space-y-1">
                    <span className="legend block">Category</span>
                    <select name="category" defaultValue="coffee" className={FIELD_CLASS}>
                      {CATEGORY_ORDER.map((category) => (
                        <option key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex-1 basis-24 space-y-1">
                    <span className="legend block">Caffeine · mg</span>
                    <input
                      name="caffeineMg"
                      type="number"
                      required
                      min={0}
                      max={1000}
                      placeholder="75"
                      className={`${FIELD_CLASS} font-gauge`}
                    />
                  </label>

                  <label className="flex-1 basis-24 space-y-1">
                    <span className="legend block">Volume · ml</span>
                    <input
                      name="volumeMl"
                      type="number"
                      min={1}
                      max={5000}
                      placeholder="250"
                      className={`${FIELD_CLASS} font-gauge`}
                    />
                  </label>
                </div>

                <p className="text-xs leading-relaxed text-oat">
                  Volume is optional, and giving one is what lets anyone log a bigger or smaller
                  serving of this drink later. The caffeine figure is an estimate — everyone&apos;s
                  is.
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={addPending}
                    className="keycap rounded-xl border border-crema-dim bg-crema/10 px-4 py-2 font-gauge text-[0.6875rem] tracking-[0.12em] text-foam uppercase disabled:opacity-60"
                  >
                    {addPending ? 'Adding' : 'Add drink'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="font-gauge text-[0.6875rem] tracking-[0.12em] text-foam uppercase underline decoration-oat/60 underline-offset-4 hover:text-foam"
                  >
                    Cancel
                  </button>
                  {state.error && <p className="text-xs text-scald">{state.error}</p>}
                  {state.notice && <p className="text-xs text-oat">{state.notice}</p>}
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="chip"
                >
                  + Add a drink
                </button>
                {state.notice && <p className="text-xs text-oat">{state.notice}</p>}
              </div>
            )}
          </div>
        </div>
      </dialog>
    </>
  )
}
