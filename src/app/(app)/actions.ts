'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { requireMember } from '@/server/auth'
import { logDrink, resolveConsumedAt, undoLastDrink } from '@/server/drinks'

const logSchema = z.object({
  slug: z.string().min(1).max(64),
  /** `HH:MM` from the form's time input, or absent for "right now". */
  time: z.string().max(5).optional(),
})

export type ActionResult = { ok: boolean; message: string | null }

/**
 * Log one drink for the signed-in member, optionally at an earlier time today.
 *
 * Returns a result rather than throwing so the button can show an inline
 * message and roll its optimistic update back.
 *
 * The time is re-resolved here rather than trusted from the client: the form
 * sends `HH:MM`, and which instant that names depends on the Oslo calendar,
 * which is server knowledge.
 */
export async function logDrinkAction(slug: string, time?: string): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = logSchema.safeParse({ slug, time })
  if (!parsed.success) {
    return { ok: false, message: "That drink isn't available." }
  }

  const when = resolveConsumedAt({ time: parsed.data.time })
  if (!when.ok) {
    return {
      ok: false,
      message:
        when.reason === 'future-time'
          ? "That time hasn't happened yet."
          : 'Use a time like 07:15.',
    }
  }

  const result = await logDrink(db, {
    userId: member.userId,
    slug: parsed.data.slug,
    consumedAt: when.consumedAt,
  })

  if (!result.ok) {
    return { ok: false, message: "That drink isn't available any more." }
  }

  refresh()
  return { ok: true, message: null }
}

/** Take back the member's most recent drink, if it's still within the window. */
export async function undoLastDrinkAction(): Promise<ActionResult> {
  const member = await requireMember()
  const result = await undoLastDrink(db, { userId: member.userId })

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === 'nothing-to-undo'
          ? 'Nothing to undo yet.'
          : 'That drink is too old to undo.',
    }
  }

  refresh()
  return { ok: true, message: null }
}
