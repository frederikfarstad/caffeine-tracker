'use server'

import { refresh, updateTag } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { requireMember } from '@/server/auth'
import { recomputeBadgesFor } from '@/server/badges'
import { caffeineHistoryTag } from '@/server/caffeine-history-cache'
import {
  deleteDrinkLog,
  logDrink,
  resolveConsumedAt,
  undoLastDrink,
  updateDrinkLog,
} from '@/server/drinks'
import {
  deleteAlcoholLog,
  logAlcoholDrink,
  undoLastAlcoholDrink,
  updateAlcoholLog,
} from '@/server/alcohol'
import { addDrinkType } from '@/server/drink-types'
import { markWrappedSeen } from '@/server/wrapped'
import { LATEST_PATCH_NOTE } from '@/lib/patch-notes'
import { markPatchNoteSeen } from '@/server/settings'

const logSchema = z.object({
  slug: z.string().min(1).max(64),
  /** `HH:MM` from the form's time input, or absent for "right now". */
  time: z.string().max(5).optional(),
  /** A serving other than the standard one, in millilitres. */
  volumeMl: z.number().int().min(1).max(5000).nullable().optional(),
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
export async function logDrinkAction(
  slug: string,
  time?: string,
  volumeMl?: number | null,
): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = logSchema.safeParse({ slug, time, volumeMl })
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
    volumeMl: parsed.data.volumeMl ?? null,
  })

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === 'no-base-volume'
          ? "That drink has no serving size to scale from."
          : "That drink isn't available any more.",
    }
  }

  for (const id of result.affectedUserIds) updateTag(caffeineHistoryTag(id))
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

  // Badges are a full-team replay (`pioneer` depends on other members' logs),
  // so it runs after the response goes out rather than inside it. Correct
  // again by the very next load; this response might still show a badge the
  // undone drink is about to cost.
  after(() => recomputeBadgesFor(db, result.affectedUserIds))
  for (const id of result.affectedUserIds) updateTag(caffeineHistoryTag(id))

  refresh()
  return { ok: true, message: null }
}

/**
 * Record that the signed-in member has read the newest patch note.
 *
 * Takes the value they were on so the update can be conditional, which stops
 * two tabs racing from walking the marker backwards to an older note.
 *
 * No `refresh()`: the dialog has already closed itself on the client, and
 * re-rendering the page underneath it would be a visible flicker for nothing.
 */
export async function dismissPatchNotes(previousNoteId: string | null): Promise<void> {
  const member = await requireMember()
  await markPatchNoteSeen(db, member.userId, LATEST_PATCH_NOTE, previousNoteId)
}

/**
 * Mark a monthly wrapped as seen.
 *
 * Fire-and-forget from the dialog, like `dismissPatchNotes`: nothing on screen
 * depends on the result. Takes the month from the client, which is safe because
 * `markWrappedSeen` only ever moves the marker forwards — the worst a bad value
 * can do is fail to advance it.
 */
export async function dismissWrapped(month: string): Promise<void> {
  const member = await requireMember()
  await markWrappedSeen(db, member.userId, month)
}

/* -------------------------------------------------------------------------- */
/* Editing history                                                           */
/* -------------------------------------------------------------------------- */

const editSchema = z.object({
  logId: z.number().int().positive(),
  time: z.string().max(5).optional(),
  volumeMl: z.number().int().min(1).max(5000).nullable().optional(),
})

/**
 * Change one of the member's own logged drinks.
 *
 * The log id comes from the client, so `updateDrinkLog` scopes every query by
 * user as well — that scope, not this action, is what stops one member reaching
 * another's rows.
 */
export async function updateDrinkLogAction(
  logId: number,
  { time, volumeMl }: { time?: string; volumeMl?: number | null } = {},
): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = editSchema.safeParse({ logId, time, volumeMl })
  if (!parsed.success) {
    return { ok: false, message: "That edit doesn't look right." }
  }

  let consumedAt: Date | undefined
  if (parsed.data.time) {
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
    consumedAt = when.consumedAt
  }

  const result = await updateDrinkLog(db, {
    userId: member.userId,
    logId: parsed.data.logId,
    consumedAt,
    volumeMl: parsed.data.volumeMl,
  })

  if (!result.ok) {
    return {
      ok: false,
      message: {
        'not-found': "That drink isn't there any more.",
        'unknown-drink': "That drink isn't available any more.",
        'no-base-volume': 'That drink has no serving size to scale from.',
      }[result.reason],
    }
  }

  // Single-user operation — an edit never touches badges (see drinks.ts) or
  // another member's row, so the caller's own tag is the whole story.
  updateTag(caffeineHistoryTag(member.userId))
  refresh()
  return { ok: true, message: null }
}

/** Delete one of the member's own logged drinks, however old. */
export async function deleteDrinkLogAction(logId: number): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = z.number().int().positive().safeParse(logId)
  if (!parsed.success) {
    return { ok: false, message: "That drink isn't there any more." }
  }

  const result = await deleteDrinkLog(db, { userId: member.userId, logId: parsed.data })
  if (!result.ok) {
    return { ok: false, message: "That drink isn't there any more." }
  }

  // Badges are a full-team replay (`pioneer` depends on other members' logs),
  // so it runs after the response goes out rather than inside it. Correct
  // again by the very next load; this response might still show a badge the
  // deleted drink is about to cost.
  after(() => recomputeBadgesFor(db, result.affectedUserIds))
  for (const id of result.affectedUserIds) updateTag(caffeineHistoryTag(id))

  refresh()
  return { ok: true, message: null }
}

/* -------------------------------------------------------------------------- */
/* Adding to the catalogue                                                   */
/* -------------------------------------------------------------------------- */

export type NewDrinkState = { error: string | null; notice: string | null }

const newDrinkSchema = z.object({
  name: z.string().trim().min(1, 'Give the drink a name.').max(60),
  category: z.enum(['coffee', 'energy', 'other']),
  caffeineMg: z.coerce
    .number({ message: 'Give the caffeine in milligrams.' })
    .int('Use a whole number of milligrams.')
    .min(0, 'Caffeine cannot be negative.')
    .max(1000, 'That is more caffeine than any single drink contains.'),
  volumeMl: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(5000)])
    .transform((value) => (value === '' ? null : value)),
})

/**
 * Add a drink to the shared catalogue — open to every member, not just admins.
 *
 * The slug is derived from the name inside `addDrinkType`, so there is no id
 * field here: inventing one is not a thing to ask a person standing at a coffee
 * machine.
 */
export async function addDrinkTypeAction(
  _previous: NewDrinkState,
  formData: FormData,
): Promise<NewDrinkState> {
  const member = await requireMember()

  const parsed = newDrinkSchema.safeParse({
    name: formData.get('name'),
    category: formData.get('category'),
    caffeineMg: formData.get('caffeineMg'),
    volumeMl: formData.get('volumeMl') ?? '',
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, notice: null }
  }

  const result = await addDrinkType(db, { ...parsed.data, createdBy: member.userId })

  if (!result.ok) {
    return {
      error:
        result.reason === 'duplicate-name'
          ? `${parsed.data.name} is already on the list.`
          : "That drink doesn't look right.",
      notice: null,
    }
  }

  refresh()
  return { error: null, notice: `Added ${parsed.data.name}. It's there for everyone now.` }
}

/* -------------------------------------------------------------------------- */
/* Party mode                                                                */
/*                                                                           */
/* Siblings of the caffeine actions rather than a `kind` parameter on them.   */
/* They write to different tables and mean different things, and a flag would */
/* put a branch inside the one action that must never write a beer into       */
/* `drink_logs`.                                                              */
/* -------------------------------------------------------------------------- */

const logAlcoholSchema = z.object({
  slug: z.string().min(1).max(64),
  /** `HH:MM` from the form's time input, or absent for "right now". */
  time: z.string().max(5).optional(),
})

/** Log one alcoholic drink, optionally at an earlier time today. */
export async function logAlcoholAction(slug: string, time?: string): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = logAlcoholSchema.safeParse({ slug, time })
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
          : 'Use a time like 21:15.',
    }
  }

  const result = await logAlcoholDrink(db, {
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

/** Take back the most recent alcoholic drink, if it is still in the window. */
export async function undoLastAlcoholAction(): Promise<ActionResult> {
  const member = await requireMember()
  const result = await undoLastAlcoholDrink(db, { userId: member.userId })

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

const editAlcoholSchema = z.object({
  logId: z.number().int().positive(),
  time: z.string().max(5),
})

/**
 * Move one of the member's own alcohol logs to a different time.
 *
 * The time is passed through as `HH:MM` rather than resolved here, which is the
 * opposite of `updateDrinkLogAction`. `updateAlcoholLog` anchors it to the
 * drink's own local date, and only the row knows what that is: the alcohol list
 * spans two dates so that an evening survives midnight, and `resolveConsumedAt`
 * would anchor last night's 22:30 to today and refuse it as still to come.
 *
 * The log id comes from the client, so `updateAlcoholLog` scopes its queries by
 * user as well — that scope, not this action, is what stops one member reaching
 * another's rows.
 */
export async function updateAlcoholLogAction(logId: number, time: string): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = editAlcoholSchema.safeParse({ logId, time })
  if (!parsed.success) {
    return { ok: false, message: "That edit doesn't look right." }
  }

  const result = await updateAlcoholLog(db, {
    userId: member.userId,
    logId: parsed.data.logId,
    time: parsed.data.time,
  })

  if (!result.ok) {
    return {
      ok: false,
      message: {
        'not-found': "That drink isn't there any more.",
        'malformed-time': 'Use a time like 21:15.',
        'future-time': "That time hasn't happened yet.",
      }[result.reason],
    }
  }

  refresh()
  return { ok: true, message: null }
}

/** Delete one of the member's own alcohol logs, however old. */
export async function deleteAlcoholLogAction(logId: number): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = z.number().int().positive().safeParse(logId)
  if (!parsed.success) {
    return { ok: false, message: "That drink isn't there any more." }
  }

  const result = await deleteAlcoholLog(db, { userId: member.userId, logId: parsed.data })
  if (!result.ok) {
    return { ok: false, message: "That drink isn't there any more." }
  }

  refresh()
  return { ok: true, message: null }
}
