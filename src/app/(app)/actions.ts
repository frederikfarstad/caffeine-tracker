'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { requireMember } from '@/server/auth'
import { logDrink, undoLastDrink } from '@/server/drinks'

const logSchema = z.object({ slug: z.string().min(1).max(64) })

export type ActionResult = { ok: boolean; message: string | null }

/**
 * Log one drink for the signed-in member.
 *
 * Returns a result rather than throwing so the button can show an inline
 * message and roll its optimistic update back.
 */
export async function logDrinkAction(slug: string): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = logSchema.safeParse({ slug })
  if (!parsed.success) {
    return { ok: false, message: "That drink isn't available." }
  }

  const result = await logDrink(db, { userId: member.userId, slug: parsed.data.slug })

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
