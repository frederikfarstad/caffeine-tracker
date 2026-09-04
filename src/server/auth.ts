import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { eq } from 'drizzle-orm'
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { db } from '@/db'
import { accounts, members, sessions, users, verificationTokens } from '@/db/schema'
import { bodyProfileFrom, type BodyProfile } from '@/lib/blood-alcohol'
import type { Profile } from '@/lib/blood-caffeine'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // JWT sessions rather than database sessions: a signed cookie avoids a
  // session-table read on every single request, which keeps Turso row-reads
  // proportional to actual work rather than to page views.
  session: { strategy: 'jwt' },
  providers: [Google],
  pages: { signIn: '/signin' },
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on the request that establishes the session.
      if (user?.id) token.sub = user.id
      return token
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      return session
    },
  },
})

export type SignedInUser = {
  id: string
  name: string | null
  email: string | null
  image: string | null
}

/** The signed-in user, or null. Does not consider team membership. */
export async function currentUser(): Promise<SignedInUser | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const { id, name, email, image } = session.user
  return { id, name: name ?? null, email: email ?? null, image: image ?? null }
}

export async function requireSignedIn(): Promise<SignedInUser> {
  const user = await currentUser()
  if (!user) redirect('/signin')
  return user
}

export type Member = {
  userId: string
  displayName: string
  isAdmin: boolean
  image: string | null
  email: string | null
  /** How this person's own physiology is modelled. */
  profile: Profile
  /** `HH:MM` in Oslo. */
  bedtimeLocal: string
  lastSeenPatchNote: string | null
  lastSeenWrapped: string | null
  /** Whether the alcohol section and the party page are switched on. */
  partyMode: boolean
  /**
   * How the alcohol model sees this person: their own figures if they gave any,
   * population ones otherwise. `personal` says which, and the UI must too.
   */
  bodyProfile: BodyProfile
  /** The raw settings, for the form to render back. */
  bodyWeightKg: number | null
  sex: 'male' | 'female' | null
}

/**
 * Build a `Member` from the row and the session user.
 *
 * Extracted because `currentMember` and `requireMember` differ only in what
 * they do when there is no row, and settings arriving here meant the narrowing
 * was about to be duplicated twice over.
 */
function toMember(
  row: typeof members.$inferSelect,
  user: Pick<SignedInUser, 'image' | 'email'>,
): Member {
  return {
    userId: row.userId,
    displayName: row.displayName,
    isAdmin: row.isAdmin,
    image: user.image,
    email: user.email,
    profile: {
      eliminationHalfLifeMs: row.eliminationHalfLifeMinutes * 60_000,
      sleepThresholdMg: row.sleepThresholdMg,
    },
    bedtimeLocal: row.bedtimeLocal,
    lastSeenPatchNote: row.lastSeenPatchNote,
    lastSeenWrapped: row.lastSeenWrapped,
    partyMode: row.partyMode,
    bodyProfile: bodyProfileFrom({ bodyWeightKg: row.bodyWeightKg, sex: row.sex }),
    bodyWeightKg: row.bodyWeightKg,
    sex: row.sex,
  }
}

/**
 * The signed-in user's membership, or null if they haven't joined.
 *
 * Membership is read fresh rather than cached in the JWT so that removing
 * someone takes effect immediately instead of whenever their token expires.
 * That costs one indexed row read per request — and since the whole row comes
 * back anyway, the member's personal settings ride along for free.
 *
 * `cache()` only dedupes calls within this one request (the layout and the
 * page both need it), not across requests — a removed member is still locked
 * out on their very next request, which is the guarantee the paragraph above
 * is protecting.
 */
export const currentMember = cache(async function currentMember(): Promise<Member | null> {
  const user = await currentUser()
  if (!user) return null

  const [member] = await db.select().from(members).where(eq(members.userId, user.id))
  if (!member) return null

  return toMember(member, user)
})

/**
 * The single gate protecting the app.
 *
 * Not signed in at all goes to sign-in; signed in but without a membership row
 * goes to the join-code form.
 */
export const requireMember = cache(async function requireMember(): Promise<Member> {
  const user = await requireSignedIn()

  const [member] = await db.select().from(members).where(eq(members.userId, user.id))
  if (!member) redirect('/join')

  return toMember(member, user)
})

export async function requireAdmin(): Promise<Member> {
  const member = await requireMember()
  if (!member.isAdmin) redirect('/')
  return member
}
