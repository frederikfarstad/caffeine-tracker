import { redirect } from 'next/navigation'
import { JoinForm } from '@/components/JoinForm'
import { currentMember, requireSignedIn } from '@/server/auth'

export const metadata = { title: 'Join — Buzz' }

export default async function JoinPage() {
  const user = await requireSignedIn()
  if (await currentMember()) redirect('/')

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="legend">One step left</p>
        <h1 className="display text-4xl leading-tight tracking-tight text-foam">
          What&apos;s the team code?
        </h1>
        <p className="text-sm leading-relaxed text-oat">
          You&apos;re signed in as {user.email}. The code keeps the leaderboard to the team — ask in
          Slack if you don&apos;t have it.
        </p>
      </div>

      <JoinForm />
    </main>
  )
}
