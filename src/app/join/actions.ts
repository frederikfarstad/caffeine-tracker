'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/db'
import { requireSignedIn } from '@/server/auth'
import { joinTeam } from '@/server/membership'

const schema = z.object({
  code: z.string().min(1, 'Enter the team code.').max(200),
})

export type JoinFormState = { error: string | null }

/**
 * Exchange the team code for membership.
 *
 * Returns errors rather than throwing so the form can render them inline; the
 * only thing that leaves this action on success is a redirect.
 */
export async function submitJoinCode(
  _previous: JoinFormState,
  formData: FormData,
): Promise<JoinFormState> {
  const user = await requireSignedIn()

  const parsed = schema.safeParse({ code: formData.get('code') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const result = await joinTeam(db, {
    userId: user.id,
    submittedCode: parsed.data.code,
    expectedCode: process.env.TEAM_JOIN_CODE,
    adminEmails: process.env.ADMIN_EMAILS,
  })

  if (result.ok) redirect('/')

  if (result.reason === 'locked-out') {
    const minutes = Math.max(1, Math.ceil(result.retryAfterMs / 60_000))
    return { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }
  }

  return {
    error:
      result.attemptsRemaining > 0
        ? `That code doesn't match. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left.`
        : "That code doesn't match. No attempts left for now.",
  }
}
