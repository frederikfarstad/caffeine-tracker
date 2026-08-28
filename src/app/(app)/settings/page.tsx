import { SettingsForm } from '@/components/SettingsForm'
import { requireMember } from '@/server/auth'

export const metadata = { title: 'Settings — Buzz' }

export default async function SettingsPage() {
  const member = await requireMember()

  return (
    <>
      <div className="space-y-1 pt-2">
        <p className="legend">Your settings</p>
        <h1 className="display text-2xl leading-tight tracking-tight text-foam">
          How you are modelled
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-oat">
          Everything else in Buzz counts milligrams, which is the same for everyone. These are the
          numbers that aren&apos;t — the first three shape the caffeine curve on your dashboard and
          the last-call estimate, and the last two the blood alcohol estimate, if you switch party
          mode on. Nothing else reads any of them.
        </p>
      </div>

      <SettingsForm
        halfLifeHours={member.profile.eliminationHalfLifeMs / 3_600_000}
        sleepThresholdMg={member.profile.sleepThresholdMg}
        bedtimeLocal={member.bedtimeLocal}
        bodyWeightKg={member.bodyWeightKg}
        sex={member.sex}
      />
    </>
  )
}
