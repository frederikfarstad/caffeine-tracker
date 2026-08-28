import Link from 'next/link'

export const metadata = { title: 'Privacy — Buzz' }

/*
 * Deliberately outside the (app) route group, so it renders without a session.
 * Google requires this URL to be publicly reachable before it will let the
 * OAuth app switch to production.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="legend">Buzz</p>
        <h1 className="display text-4xl leading-tight tracking-tight text-foam">Privacy</h1>
        <p className="text-sm leading-relaxed text-oat">
          Buzz is an internal caffeine leaderboard for the Fleks team. It is not a commercial
          product and there is nothing clever going on with your data.
        </p>
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-oat">
        <section className="space-y-2">
          <h2 className="display text-base font-semibold text-foam">What we store</h2>
          <p>
            When you sign in with Google we receive and store your name, email address and
            profile picture. Nothing else from your Google account is requested or accessible —
            not your contacts, calendar, files or anything otherwise.
          </p>
          <p>
            Beyond that, we store the drinks you log: the type, the amount and the time. That is
            the whole database.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="display text-base font-semibold text-foam">Who can see it</h2>
          <p>
            Other people who have entered the team code. Your name, picture and drink totals
            appear on the leaderboard — that is the point of the app. Your email is visible only
            to admins.
          </p>
          <p>
            Nothing is sold, shared with advertisers, or sent anywhere beyond the two services
            that run the app: Vercel, which hosts it, and Turso, which stores the database.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="display text-base font-semibold text-foam">Getting your data removed</h2>
          <p>
            Ask an admin and your account and every drink you have logged are deleted outright.
            There is no archive or backup copy to worry about.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="display text-base font-semibold text-foam">Cookies</h2>
          <p>
            One, holding your sign-in session. No analytics, no tracking, no third-party
            scripts.
          </p>
        </section>
      </div>

      <Link href="/" className="text-xs text-crema underline underline-offset-4">
        Back to Buzz
      </Link>
    </main>
  )
}
