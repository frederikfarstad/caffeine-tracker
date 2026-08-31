import Link from 'next/link'
import { ContributeFooter } from '@/components/ContributeFooter'
import { PatchNotesDialog } from '@/components/PatchNotesDialog'
import { WrappedDialog } from '@/components/WrappedDialog'
import { db } from '@/db'
import { unseenPatchNotes } from '@/lib/patch-notes'
import { localDateOf } from '@/lib/time'
import { monthOf, previousMonth } from '@/lib/wrapped'
import { requireMember, signOut } from '@/server/auth'
import { getWrapped } from '@/server/wrapped'

const NAV = [
  { href: '/', label: 'Me' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/team', label: 'Everyone' },
]

const ADMIN_NAV = { href: '/admin', label: 'Drinks' }

/**
 * Shown only to members with party mode on.
 *
 * The page checks the same flag itself — a link that is not rendered is not an
 * access control — but keeping it out of the nav is what stops party mode being
 * a permanent advertisement to everyone who never asked for it.
 */
const PARTY_NAV = { href: '/party', label: 'Party' }

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

  /*
   * Last month's wrapped, if they have not seen it. Decided here rather than on
   * the client, like the patch notes, so the dialog is either in the markup or
   * it is not — no mounting one and then closing it on the client.
   *
   * `getWrapped` returns null for a member who logged nothing that month, which
   * is what stops somebody who joined last week being shown an empty
   * celebration of a month they were not here for. The marker check comes first
   * so that a caught-up member costs no query at all.
   */
  const lastMonth = previousMonth(monthOf(localDateOf(new Date())))
  const wrapped =
    member.lastSeenWrapped === null || member.lastSeenWrapped < lastMonth
      ? await getWrapped(db, member.userId, lastMonth)
      : null

  async function signOutAction() {
    'use server'
    await signOut({ redirectTo: '/signin' })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <Link href="/" className="block">
          <span className="legend block text-[0.5625rem] leading-none">Fleks</span>
          <span className="display text-2xl leading-none tracking-tight text-foam">
            buzz<span className="text-crema">.</span>
          </span>
        </Link>

        <nav aria-label="Sections" className="order-3 flex w-full gap-1 sm:order-2 sm:w-auto">
          {[
            ...NAV,
            ...(member.partyMode ? [PARTY_NAV] : []),
            ...(member.isAdmin ? [ADMIN_NAV] : []),
          ].map((item) => (
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

      <ContributeFooter />

      {unseen.length > 0 && (
        <PatchNotesDialog notes={unseen} seen={member.lastSeenPatchNote} />
      )}

      {/*
       * Never both at once. Two modals stacked on arrival is a poor greeting,
       * and the wrapped keeps: it stays unseen and appears on the next visit.
       */}
      {unseen.length === 0 && wrapped && <WrappedDialog wrapped={wrapped} />}
    </div>
  )
}
