import Link from 'next/link'
import { PatchNotesDialog } from '@/components/PatchNotesDialog'
import { unseenPatchNotes } from '@/lib/patch-notes'
import { requireMember, signOut } from '@/server/auth'

const NAV = [
  { href: '/', label: 'Me' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/team', label: 'Everyone' },
]

const ADMIN_NAV = { href: '/admin', label: 'Drinks' }

/**
 * The shell around every signed-in page.
 *
 * `requireMember()` runs here so the join gate is enforced once, for the whole
 * group, rather than repeated per route.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember()

  // Decided on the server, so the dialog is either in the markup or it isn't —
  // no mounting one and then closing it on the client.
  const unseen = unseenPatchNotes(member.lastSeenPatchNote)

  async function signOutAction() {
    'use server'
    await signOut({ redirectTo: '/signin' })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        {/*
         * The wordmark carries one name, so the two teams sit above it as an
         * eyebrow rather than inside it — "oviobuzz" cannot be made to include
         * Teoria without reading as a third team.
         */}
        <Link href="/" className="block">
          <span className="legend block text-[0.5625rem] leading-none">Ovio · Teoria</span>
          <span className="display text-2xl leading-none tracking-tight text-foam">
            buzz<span className="text-crema">.</span>
          </span>
        </Link>

        <nav aria-label="Sections" className="order-3 flex w-full gap-1 sm:order-2 sm:w-auto">
          {(member.isAdmin ? [...NAV, ADMIN_NAV] : NAV).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md border border-hairline px-3 py-1.5 font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase transition-colors hover:border-oat hover:text-foam"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="order-2 flex items-center gap-3 sm:order-3">
          <span className="font-gauge text-[0.6875rem] tracking-[0.1em] text-oat uppercase">
            {member.displayName}
          </span>
          {/*
           * Named plainly rather than hidden behind the display name, and here
           * rather than in the nav: settings is a place you visit once and then
           * forget, and a fifth nav pill would push the bar to two rows on a
           * phone.
           */}
          <Link
            href="/settings"
            className="font-gauge text-[0.6875rem] tracking-[0.1em] text-oat uppercase transition-colors hover:text-foam"
          >
            Settings
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className="font-gauge text-[0.6875rem] tracking-[0.1em] text-oat uppercase transition-colors hover:text-foam"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 space-y-4">{children}</main>

      {unseen.length > 0 && (
        <PatchNotesDialog notes={unseen} seen={member.lastSeenPatchNote} />
      )}
    </div>
  )
}
