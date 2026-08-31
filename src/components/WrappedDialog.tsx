'use client'

import Link from 'next/link'
import { useEffect, useRef, useTransition } from 'react'
import { dismissWrapped } from '@/app/(app)/actions'
import { WrappedSummary } from '@/components/WrappedSummary'
import { formatMonth } from '@/lib/wrapped'
import type { Wrapped } from '@/server/wrapped'

/**
 * Last month, once.
 *
 * The same arrangement as `PatchNotesDialog`, deliberately: a native `<dialog>`
 * so the focus trap, the backdrop and Escape-to-close come for free, rendered
 * by the server only when there is something to show, and marked seen from
 * `close` so that however it was dismissed counts.
 *
 * Fire-and-forget for the same reason too. The summary has been read by the
 * time this runs, so the only failure left is the mark never landing, which at
 * worst shows it once more.
 */
export function WrappedDialog({ wrapped }: { wrapped: Wrapped }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="wrapped-heading"
      onClose={() => {
        startTransition(() => {
          void dismissWrapped(wrapped.month)
        })
      }}
      className="panel m-auto w-[min(32rem,calc(100vw-2rem))] p-0 text-foam backdrop:bg-roast/80"
    >
      <div className="space-y-4 p-5">
        <div className="space-y-1">
          <p className="legend">Your month</p>
          <h2
            id="wrapped-heading"
            className="display text-2xl leading-tight tracking-tight text-foam"
          >
            {formatMonth(wrapped.month)}
          </h2>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <WrappedSummary wrapped={wrapped} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
          {/*
           * A way out that is not dismissal. Closing marks it seen, so without
           * this the only route to a second look would be knowing the URL.
           */}
          <Link
            href={`/wrapped?month=${wrapped.month}`}
            className="text-sm text-oat underline decoration-hairline underline-offset-2"
          >
            Keep it open
          </Link>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="keycap rounded-xl border border-crema-dim bg-crema/10 px-4 py-2.5 font-gauge text-[0.6875rem] tracking-[0.12em] text-foam uppercase transition-colors hover:border-crema hover:bg-crema/15"
          >
            Got it
          </button>
        </div>
      </div>
    </dialog>
  )
}
