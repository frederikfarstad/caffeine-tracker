'use server'

import { refresh } from 'next/cache'
import { db } from '@/db'
import { requireMember } from '@/server/auth'
import { setPartyMode } from '@/server/settings'

/**
 * Switch the alcohol section on or off for the signed-in member.
 *
 * Scoped to `requireMember()`, so there is no id in the call and therefore no
 * way to aim this at somebody else's row.
 *
 * Its own file rather than an addition to `actions.ts`: that module is the
 * drink-logging surface, and this is the one action that decides whether party
 * mode exists for a person at all.
 */
export async function togglePartyModeAction(on: boolean): Promise<void> {
  const member = await requireMember()
  await setPartyMode(db, member.userId, on)
  refresh()
}
