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
          How your caffeine is modelled
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-oat">
          Everything else in Buzz counts milligrams, which is the same for everyone. These three
          numbers are the ones that aren&apos;t — they shape the curve on your dashboard and the
          last-call estimate, and nothing else.
        </p>
      </div>

      <SettingsForm
        halfLifeHours={member.profile.eliminationHalfLifeMs / 3_600_000}
        sleepThresholdMg={member.profile.sleepThresholdMg}
        bedtimeLocal={member.bedtimeLocal}
      />
    </>
  )
}
