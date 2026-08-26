import { createHash, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '@/db'
import { joinAttempts, members, users } from '@/db/schema'
import type { TestDb } from '@/db/test-db'

type AnyDb = Db | TestDb

/** Failed attempts allowed per user per {@link JOIN_ATTEMPT_WINDOW_MS}. */
export const JOIN_ATTEMPT_LIMIT = 5
export const JOIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000

/**
 * Compare a submitted join code against the configured one.
 *
 * Hashing both sides first gives `timingSafeEqual` the equal-length inputs it
 * requires, so a wrong code of the wrong length can't be distinguished from a
 * wrong code of the right length by timing.
 *
 * Fails closed: an unset or empty expected code rejects everything, so a
 * misconfigured deployment locks people out rather than letting everyone in.
 */
export function codesMatch(submitted: string, expected: string | undefined): boolean {
  const candidate = submitted.trim()
  const secret = expected?.trim()

  if (!candidate || !secret) return false

  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digest(candidate), digest(secret))
}

/** Whether an email appears in the comma-separated admin allowlist. */
export function isAdminEmail(email: string | null, adminEmails: string | undefined): boolean {
  if (!email || !adminEmails) return false

  const allowed = adminEmails
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  return allowed.includes(email.trim().toLowerCase())
}

export type JoinFailure =
  | { ok: false; reason: 'locked-out'; retryAfterMs: number }
  | { ok: false; reason: 'wrong-code'; attemptsRemaining: number }

export type JoinResult = { ok: true } | JoinFailure

type JoinOptions = {
  userId: string
  submittedCode: string
  expectedCode: string | undefined
  adminEmails?: string
  now?: Date
}

/**
 * Exchange a join code for team membership.
 *
 * The expected code and admin list are passed in rather than read from the
 * environment here, so the whole flow — including lockout — is testable without
 * mutating `process.env`.
 */
export async function joinTeam(db: AnyDb, options: JoinOptions): Promise<JoinResult> {
  const { userId, submittedCode, expectedCode, adminEmails, now = new Date() } = options

  const [existing] = await db.select().from(members).where(eq(members.userId, userId))
  if (existing) return { ok: true }

  const attempt = await currentAttemptWindow(db, userId, now)

  if (attempt.attempts >= JOIN_ATTEMPT_LIMIT) {
    return {
      ok: false,
      reason: 'locked-out',
      retryAfterMs: attempt.windowStartedAt.getTime() + JOIN_ATTEMPT_WINDOW_MS - now.getTime(),
    }
  }

  if (!codesMatch(submittedCode, expectedCode)) {
    const attempts = attempt.attempts + 1
    await db
      .insert(joinAttempts)
      .values({ userId, attempts, windowStartedAt: attempt.windowStartedAt })
      .onConflictDoUpdate({
        target: joinAttempts.userId,
        set: { attempts, windowStartedAt: attempt.windowStartedAt },
      })

    return {
      ok: false,
      reason: 'wrong-code',
      attemptsRemaining: Math.max(0, JOIN_ATTEMPT_LIMIT - attempts),
    }
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId))

  await db.insert(members).values({
    userId,
    displayName: displayNameFor(user?.name ?? null, user?.email ?? null),
    isAdmin: isAdminEmail(user?.email ?? null, adminEmails),
    joinedAt: now,
  })

  await db.delete(joinAttempts).where(eq(joinAttempts.userId, userId))

  return { ok: true }
}

/**
 * The live attempt window, treating an expired one as a fresh start.
 *
 * Expired windows are reported as zero attempts rather than deleted, so a
 * read-only check never writes.
 */
async function currentAttemptWindow(db: AnyDb, userId: string, now: Date) {
  const [record] = await db.select().from(joinAttempts).where(eq(joinAttempts.userId, userId))

  const expired =
    !record || now.getTime() - record.windowStartedAt.getTime() >= JOIN_ATTEMPT_WINDOW_MS

  return expired
    ? { attempts: 0, windowStartedAt: now }
    : { attempts: record.attempts, windowStartedAt: record.windowStartedAt }
}

/** Google usually gives a name; fall back to the email local part if it didn't. */
function displayNameFor(name: string | null, email: string | null): string {
  return name?.trim() || email?.split('@')[0] || 'Anonymous'
}
