'use client'

import { useEffect, useRef, useTransition } from 'react'
import { dismissPatchNotes } from '@/app/(app)/actions'
import type { PatchNote } from '@/lib/patch-notes'

/**
 * What changed since you were last here.
 *
 * A native `<dialog>` opened with `showModal()`, which brings the focus trap,
 * the backdrop and Escape-to-close with it. Rebuilding those by hand is how
 * modals end up keyboard traps.
 *
 * The server only renders this component when there is something unseen, so
 * there is no flash of a dialog that immediately decides to close itself.
 *
 * Marking them seen hangs off `close`, which fires however the dialog was
 * closed — the button, Escape, or anything else. The alternative, intercepting
 * Escape's `cancel` event to route it through one handler, means an unclosable
 * modal the moment that handler misbehaves; hooking the outcome instead of each
 * input cannot fail that way.
 *
 * Dismissing is fire-and-forget: the notes are on screen and read by the time
 * this runs, so the only failure left is the mark never landing, which at worst
 * shows them once more.
 */
export function PatchNotesDialog({ notes, seen }: { notes: PatchNote[]; seen: string | null }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="patch-notes-heading"
      onClose={() => {
        startTransition(() => {
          void dismissPatchNotes(seen)
        })
      }}
      className="panel m-auto w-[min(32rem,calc(100vw-2rem))] p-0 text-foam backdrop:bg-roast/80"
    >
      <div className="space-y-4 p-5">
        <div className="space-y-1">
          <p className="legend">What&apos;s new in Buzz</p>
          <h2
            id="patch-notes-heading"
            className="display text-2xl leading-tight tracking-tight text-foam"
          >
            {notes[0].title}
          </h2>
        </div>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto">
          {notes.map((note) => (
            <section key={note.id} className="space-y-2">
              {notes.length > 1 && (
                <p className="font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase">
                  {note.title}
                </p>
              )}
              <ul className="space-y-2">
                {note.items.map((item, index) => (
                  <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-oat">
                    <span aria-hidden="true" className="text-crema">
                      ·
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="border-t border-hairline pt-4">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="keycap w-full rounded-xl border border-crema-dim bg-crema/10 px-4 py-2.5 font-gauge text-[0.6875rem] tracking-[0.12em] text-foam uppercase transition-colors hover:border-crema hover:bg-crema/15"
          >
            Got it
          </button>
        </div>
      </div>
    </dialog>
  )
}
