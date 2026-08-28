import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '@/db'
import { members } from '@/db/schema'
import type { TestDb } from '@/db/test-db'

type AnyDb = Db | TestDb

/**
 * The bounds on what a member can tell us about themselves.
 *
 * 2.5-10 hours is the range the literature reports for adult caffeine
 * elimination; 2-12 gives that a little slack without letting the curve stop
 * describing a person. A zero would divide by zero in the model, so the floor is
 * load-bearing rather than cosmetic.
 */
export const MIN_HALF_LIFE_HOURS = 2
export const MAX_HALF_LIFE_HOURS = 12
export const MIN_THRESHOLD_MG = 10
export const MAX_THRESHOLD_MG = 200

/**
 * The range a body weight can sensibly take, for the alcohol model.
 *
 * Wide on purpose. This is a divisor in the Widmark denominator, so the floor
 * is there to stop a typo producing an alarming permille figure — not to
 * police anyone's weight.
 */
export const MIN_WEIGHT_KG = 35
export const MAX_WEIGHT_KG = 250

/** `HH:MM` on a 24-hour clock, which is what `input[type=time]` submits. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

const settingsSchema = z.object({
  halfLifeHours: z.coerce
    .number({ message: `Give a half-life in hours, between ${MIN_HALF_LIFE_HOURS} and ${MAX_HALF_LIFE_HOURS}.` })
    .min(MIN_HALF_LIFE_HOURS, `A half-life under ${MIN_HALF_LIFE_HOURS} hours isn't a human one.`)
    .max(MAX_HALF_LIFE_HOURS, `A half-life over ${MAX_HALF_LIFE_HOURS} hours isn't a human one.`),
  sleepThresholdMg: z.coerce
    .number({ message: 'Give a sleep threshold in milligrams.' })
    .int('Use a whole number of milligrams.')
    .min(MIN_THRESHOLD_MG, `Use at least ${MIN_THRESHOLD_MG} mg — below that the answer is always "now".`)
    .max(MAX_THRESHOLD_MG, `Over ${MAX_THRESHOLD_MG} mg the threshold stops meaning anything.`),
  bedtimeLocal: z.string().regex(TIME_PATTERN, 'Use a bedtime like 23:00.'),
  /*
   * Both party-mode fields accept an empty string, which means "not given" and
   * is a valid answer: the alcohol model has a defensible population fallback,
   * and `bodyProfileFrom` reports which one it used. The caffeine numbers above
   * have no such fallback, which is why they are required and these are not.
   */
  bodyWeightKg: z
    .union([
      z.literal(''),
      z.coerce
        .number({ message: 'Give a weight in kilograms.' })
        .min(MIN_WEIGHT_KG, `Use at least ${MIN_WEIGHT_KG} kg.`)
        .max(MAX_WEIGHT_KG, `Over ${MAX_WEIGHT_KG} kg is not a weight this can model.`),
    ])
    .transform((value) => (value === '' ? null : Math.round(value))),
  sex: z
    .union([z.literal(''), z.enum(['male', 'female'])])
    .transform((value) => (value === '' ? null : value)),
})

export type MemberSettings = {
  eliminationHalfLifeMinutes: number
  sleepThresholdMg: number
  bedtimeLocal: string
  /** Both null unless the member chose to give them. See `blood-alcohol.ts`. */
  bodyWeightKg: number | null
  sex: 'male' | 'female' | null
}

export type ParsedSettings =
  | { ok: true; settings: MemberSettings }
  | { ok: false; message: string }

/**
 * Validate the settings form.
 *
 * Kept apart from the server action so the rules are testable without a session
 * or a request, the way `resolveConsumedAt` is in `drinks.ts`.
 *
 * Hours in, minutes out: the form has to accept 5.5 because that is how
 * half-lives are quoted, while the column stays an integer.
 */
export function parseSettings(input: {
  halfLifeHours: string
  sleepThresholdMg: string
  bedtimeLocal: string
  bodyWeightKg?: string
  sex?: string
}): ParsedSettings {
  // Empty strings coerce to 0, which then fails the range check with a message
  // about range rather than about emptiness — so reject them up front.
  if (!input.halfLifeHours.trim() || !input.sleepThresholdMg.trim()) {
    return { ok: false, message: 'Fill in both numbers.' }
  }

  const parsed = settingsSchema.safeParse({
    ...input,
    // Everyone here types on a Norwegian keyboard. `input[type=number]` is
    // supposed to hand us a normalised value, but only when the browser accepted
    // what was typed, and a rejected "5,5" would arrive as a confusing range
    // error rather than as the number the person meant.
    halfLifeHours: input.halfLifeHours.replace(',', '.'),
    bodyWeightKg: (input.bodyWeightKg ?? '').replace(',', '.'),
    sex: input.sex ?? '',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message }
  }

  return {
    ok: true,
    settings: {
      eliminationHalfLifeMinutes: Math.round(parsed.data.halfLifeHours * 60),
      sleepThresholdMg: parsed.data.sleepThresholdMg,
      bedtimeLocal: parsed.data.bedtimeLocal,
      bodyWeightKg: parsed.data.bodyWeightKg,
      sex: parsed.data.sex,
    },
  }
}

/** Persist one member's settings. Scoped by user id, so it can't reach anyone else. */
export async function saveMemberSettings(
  db: AnyDb,
  userId: string,
  settings: MemberSettings,
): Promise<void> {
  await db.update(members).set(settings).where(eq(members.userId, userId))
}

/**
 * Record that this member has seen the newest patch note.
 *
 * Guarded on the current value so two tabs racing cannot walk the marker
 * backwards to an older note.
 */
export async function markPatchNoteSeen(
  db: AnyDb,
  userId: string,
  noteId: string,
  previousNoteId: string | null,
): Promise<void> {
  await db
    .update(members)
    .set({ lastSeenPatchNote: noteId })
    .where(
      previousNoteId === null
        ? eq(members.userId, userId)
        : and(eq(members.userId, userId), eq(members.lastSeenPatchNote, previousNoteId)),
    )
}

/**
 * Switch party mode on or off for one member.
 *
 * Separate from {@link saveMemberSettings} because it is a button, not a form:
 * the settings page saves five fields at once, and this saves one from a
 * different page entirely.
 */
export async function setPartyMode(db: AnyDb, userId: string, on: boolean): Promise<void> {
  await db.update(members).set({ partyMode: on }).where(eq(members.userId, userId))
}
