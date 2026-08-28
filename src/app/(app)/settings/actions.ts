'use server'

import { refresh } from 'next/cache'
import { db } from '@/db'
import { requireMember } from '@/server/auth'
import { parseSettings, saveMemberSettings } from '@/server/settings'

export type SettingsFormState = { error: string | null; notice: string | null }

/**
 * Save the signed-in member's own settings.
 *
 * Scoped to `requireMember()`, so there is no id in the form and therefore no
 * way to aim this at somebody else's row.
 */
export async function saveSettings(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const member = await requireMember()

  const parsed = parseSettings({
    halfLifeHours: String(formData.get('halfLifeHours') ?? ''),
    sleepThresholdMg: String(formData.get('sleepThresholdMg') ?? ''),
    bedtimeLocal: String(formData.get('bedtimeLocal') ?? ''),
    bodyWeightKg: String(formData.get('bodyWeightKg') ?? ''),
    sex: String(formData.get('sex') ?? ''),
  })

  if (!parsed.ok) {
    return { error: parsed.message, notice: null }
  }

  await saveMemberSettings(db, member.userId, parsed.settings)

  refresh()
  return { error: null, notice: 'Saved. Your curve and last call now use these.' }
}
