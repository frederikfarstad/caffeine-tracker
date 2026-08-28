import { redirect } from 'next/navigation'
import { currentUser, signIn } from '@/server/auth'

export const metadata = { title: 'Sign in — Buzz' }

export default async function SignInPage() {
  if (await currentUser()) redirect('/')

  async function signInWithGoogle() {
    'use server'
    await signIn('google', { redirectTo: '/' })
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-10 px-6 py-16">
      <div className="space-y-3">
        <p className="legend">Fleks · caffeine tracker</p>
        <h1 className="display text-6xl leading-none tracking-tight text-foam">
          buzz<span className="text-crema">.</span>
        </h1>
        <p className="max-w-xs text-sm leading-relaxed text-oat">
          Every cup. Every can. One leaderboard. Settle who is actually running Fleks.
        </p>
      </div>

      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="keycap w-full rounded-xl border border-crema bg-crema px-5 py-3.5 display text-base font-semibold text-roast hover:bg-crema/90"
        >
          Continue with Google
        </button>
      </form>

      <p className="text-xs leading-relaxed text-oat">
        Any Google account works — a personal one is fine. You&apos;ll enter the team code once
        after signing in.
      </p>
    </main>
  )
}
