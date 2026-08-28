'use client'

import { useRef, useState } from 'react'
import { scaleForVolume, sliderRange } from '@/lib/serving'
import type { ActiveDrinkType } from '@/server/drinks'

/** What a multiplier means for a drink with no serving size to scale from. */
const MULTIPLIERS = [0.5, 1, 1.5, 2] as const

/**
 * Log a drink at a size other than the standard one.
 *
 * Two shapes, because half the catalogue has no serving size: a millilitre
 * slider where there is a volume to scale from, and a plain multiplier where
 * there isn't. Coffee is the single most-logged drink and has no volume in the
 * catalogue, so hiding the affordance in that case would hide it exactly where
 * it is most wanted.
 *
 * Opened from a visible, focusable button rather than a long-press. A long-press
 * is invisible to a keyboard, absent for a mouse, and undiscoverable on a phone;
 * it can be a shortcut but never the only way in.
 */
export function VolumePicker({
  type,
  onLog,
  pending,
}: {
  type: ActiveDrinkType
  /** `volumeMl` is null when the multiplier path is used. */
  onLog: (choice: { volumeMl: number | null; caffeineMg: number }) => void
  pending: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const base = type.volumeMl
  const [volumeMl, setVolumeMl] = useState(base ?? 0)

  function open() {
    // Back to the standard serving each time it opens, so the slider never
    // starts on a number left over from a previous drink.
    setVolumeMl(base ?? 0)
    ref.current?.showModal()
  }

  function close() {
    ref.current?.close()
  }

  return (
    <>
      {/*
       * A glyph, not the word "Amount". Spelled out it took a third of the
       * drink button's width and truncated the names to "En…" — with two energy
       * drinks in the row, that made them indistinguishable. The accessible
       * name carries the meaning instead.
       */}
      <button
        type="button"
        aria-label={`Log a different amount of ${type.name}`}
        title={`Log a different amount of ${type.name}`}
        onClick={open}
        className="rounded-md border border-hairline px-1.5 py-1 font-gauge text-xs leading-none text-oat transition-colors hover:border-oat hover:text-foam"
      >
        <span aria-hidden="true">±</span>
      </button>

      <dialog
        ref={ref}
        aria-labelledby="volume-heading"
        className="panel m-auto w-[min(22rem,calc(100vw-2rem))] p-0 text-foam backdrop:bg-roast/80"
      >
        <div className="space-y-4 p-5">
          <div className="space-y-1">
            <p className="legend">How much?</p>
            <h2 id="volume-heading" className="display text-xl leading-tight text-foam">
              {type.name}
            </h2>
          </div>

          {base ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-gauge text-sm text-foam">{volumeMl} ml</span>
                <span className="font-gauge text-sm text-crema">
                  {scaleForVolume(type, volumeMl)} mg
                </span>
              </div>
              <input
                type="range"
                min={sliderRange(base).min}
                max={sliderRange(base).max}
                step={sliderRange(base).step}
                value={volumeMl}
                aria-label={`Volume in millilitres, standard is ${base}`}
                onChange={(event) => setVolumeMl(Number(event.target.value))}
                className="w-full accent-crema"
              />
              <p className="text-xs text-oat">
                Standard serving is {base} ml at {type.caffeineMg} mg.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  onLog({
                    // The standard serving records no volume, so history does
                    // not claim a measurement nobody made.
                    volumeMl: volumeMl === base ? null : volumeMl,
                    caffeineMg: scaleForVolume(type, volumeMl) ?? type.caffeineMg,
                  })
                  close()
                }}
                className="keycap w-full rounded-xl border border-crema-dim bg-crema/10 px-4 py-2.5 font-gauge text-[0.6875rem] tracking-[0.12em] text-foam uppercase disabled:opacity-60"
              >
                Log {scaleForVolume(type, volumeMl)} mg
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-oat">
                {type.name} has no serving size on the list, so there is nothing to measure
                against. Pick a rough multiple of a normal one instead.
              </p>
              <div className="flex flex-wrap gap-2">
                {MULTIPLIERS.map((multiplier) => (
                  <button
                    key={multiplier}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      onLog({
                        volumeMl: null,
                        caffeineMg: Math.round(type.caffeineMg * multiplier),
                      })
                      close()
                    }}
                    className="keycap flex-1 basis-20 rounded-xl border border-crema-dim bg-crema/10 px-3 py-2.5 disabled:opacity-60"
                  >
                    <span className="display block text-sm font-semibold text-foam">
                      {multiplier}×
                    </span>
                    <span className="font-gauge text-[0.625rem] text-oat">
                      {Math.round(type.caffeineMg * multiplier)} mg
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={close}
            className="w-full font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase underline decoration-hairline underline-offset-4 hover:text-foam"
          >
            Cancel
          </button>
        </div>
      </dialog>
    </>
  )
}
