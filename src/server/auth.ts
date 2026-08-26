import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { eq } from 'drizzle-orm'
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { accounts, members, sessions, users, verificationTokens } from '@/db/schema'

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
}

/**
 * The signed-in user's membership, or null if they haven't joined.
 *
 * Membership is read fresh rather than cached in the JWT so that removing
 * someone takes effect immediately instead of whenever their token expires.
 * That costs one indexed row read per request.
 */
export async function currentMember(): Promise<Member | null> {
  const user = await currentUser()
  if (!user) return null

  const [member] = await db.select().from(members).where(eq(members.userId, user.id))
  if (!member) return null

  return {
    userId: member.userId,
    displayName: member.displayName,
    isAdmin: member.isAdmin,
    image: user.image,
    email: user.email,
  }
}

/**
 * The single gate protecting the app.
 *
 * Not signed in at all goes to sign-in; signed in but without a membership row
 * goes to the join-code form.
 */
export async function requireMember(): Promise<Member> {
  const user = await requireSignedIn()

  const [member] = await db.select().from(members).where(eq(members.userId, user.id))
  if (!member) redirect('/join')

  return {
    userId: member.userId,
    displayName: member.displayName,
    isAdmin: member.isAdmin,
    image: user.image,
    email: user.email,
  }
}

export async function requireAdmin(): Promise<Member> {
  const member = await requireMember()
  if (!member.isAdmin) redirect('/')
  return member
}
