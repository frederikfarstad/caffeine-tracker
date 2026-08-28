import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '@/db/test-db'
import { joinAttempts, members, users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { LATEST_PATCH_NOTE, unseenPatchNotes } from '@/lib/patch-notes'
import { markPatchNoteSeen } from './settings'
import {
  JOIN_ATTEMPT_LIMIT,
  JOIN_ATTEMPT_WINDOW_MS,
  codesMatch,
  isAdminEmail,
  joinTeam,
} from './membership'

// The fixture is deliberately nonsense. A real join code in the test suite is a
// real join code in the repository, and this one grants access to everything.
const FIXTURE_CODE = 'decaf-nonsense'

describe('codesMatch', () => {
  it('accepts the exact code', () => {
    expect(codesMatch(FIXTURE_CODE, FIXTURE_CODE)).toBe(true)
  })

  it('ignores surrounding whitespace, which pasting tends to add', () => {
    expect(codesMatch(`  ${FIXTURE_CODE} \n`, FIXTURE_CODE)).toBe(true)
  })

  it('is case sensitive', () => {
    expect(codesMatch('Decaf-Nonsense', FIXTURE_CODE)).toBe(false)
  })

  it('rejects a wrong code', () => {
    expect(codesMatch('latte-nonsense', FIXTURE_CODE)).toBe(false)
  })

  it('rejects a code that is merely a prefix', () => {
    expect(codesMatch('decaf', FIXTURE_CODE)).toBe(false)
  })

  it('rejects empty input', () => {
    expect(codesMatch('', FIXTURE_CODE)).toBe(false)
    expect(codesMatch('   ', FIXTURE_CODE)).toBe(false)
  })

  // A misconfigured deployment must fail closed rather than admit everyone.
  it('rejects everything when no code is configured', () => {
    expect(codesMatch('anything', undefined)).toBe(false)
    expect(codesMatch('', undefined)).toBe(false)
    expect(codesMatch('anything', '')).toBe(false)
  })
})

describe('isAdminEmail', () => {
  it('matches an email in the list', () => {
    expect(isAdminEmail('ada@example.com', 'ada@example.com,linn@example.com')).toBe(true)
  })

  it('ignores whitespace and case in the list', () => {
    expect(isAdminEmail('ada@example.com', ' Ada@Example.com , linn@example.com ')).toBe(true)
  })

  it('rejects an email not in the list', () => {
    expect(isAdminEmail('mallory@example.com', 'ada@example.com')).toBe(false)
  })

  it('grants nobody when the list is unset or empty', () => {
    expect(isAdminEmail('ada@example.com', undefined)).toBe(false)
    expect(isAdminEmail('ada@example.com', '')).toBe(false)
    expect(isAdminEmail('ada@example.com', '  ,  ')).toBe(false)
  })

  it('never treats a null email as an admin', () => {
    expect(isAdminEmail(null, 'ada@example.com')).toBe(false)
  })
})

describe('joinTeam', () => {
  const CODE = FIXTURE_CODE
  const now = new Date('2026-08-26T10:00:00Z')
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
    await db.insert(users).values({ id: 'u1', name: 'Ada', email: 'ada@example.com' })
  })

  it('creates a membership for the correct code', async () => {
    const result = await joinTeam(db, {
      userId: 'u1',
      submittedCode: CODE,
      expectedCode: CODE,
      now,
    })

    expect(result).toEqual({ ok: true })
    const [member] = await db.select().from(members).where(eq(members.userId, 'u1'))
    expect(member).toMatchObject({ userId: 'u1', displayName: 'Ada', isAdmin: false })
  })

  it('falls back to the email local part when the account has no name', async () => {
    await db.insert(users).values({ id: 'u2', name: null, email: 'linn@example.com' })
    await joinTeam(db, { userId: 'u2', submittedCode: CODE, expectedCode: CODE, now })

    const [member] = await db.select().from(members).where(eq(members.userId, 'u2'))
    expect(member.displayName).toBe('linn')
  })

  it('grants admin to a configured email', async () => {
    await joinTeam(db, {
      userId: 'u1',
      submittedCode: CODE,
      expectedCode: CODE,
      adminEmails: 'ada@example.com',
      now,
    })

    const [member] = await db.select().from(members).where(eq(members.userId, 'u1'))
    expect(member.isAdmin).toBe(true)
  })

  it('rejects a wrong code without creating a membership', async () => {
    const result = await joinTeam(db, {
      userId: 'u1',
      submittedCode: 'nope',
      expectedCode: CODE,
      now,
    })

    expect(result.ok).toBe(false)
    expect(await db.select().from(members)).toEqual([])
  })

  it('reports the attempts remaining after a failure', async () => {
    const result = await joinTeam(db, {
      userId: 'u1',
      submittedCode: 'nope',
      expectedCode: CODE,
      now,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'wrong-code',
      attemptsRemaining: JOIN_ATTEMPT_LIMIT - 1,
    })
  })

  it('locks out after the attempt limit', async () => {
    for (let i = 0; i < JOIN_ATTEMPT_LIMIT; i++) {
      await joinTeam(db, { userId: 'u1', submittedCode: 'nope', expectedCode: CODE, now })
    }

    const result = await joinTeam(db, {
      userId: 'u1',
      submittedCode: 'nope',
      expectedCode: CODE,
      now,
    })
    expect(result).toMatchObject({ ok: false, reason: 'locked-out' })
  })

  // Otherwise brute force is only slowed down, not stopped.
  it('refuses even the correct code while locked out', async () => {
    for (let i = 0; i < JOIN_ATTEMPT_LIMIT; i++) {
      await joinTeam(db, { userId: 'u1', submittedCode: 'nope', expectedCode: CODE, now })
    }

    const result = await joinTeam(db, {
      userId: 'u1',
      submittedCode: CODE,
      expectedCode: CODE,
      now,
    })
    expect(result).toMatchObject({ ok: false, reason: 'locked-out' })
    expect(await db.select().from(members)).toEqual([])
  })

  it('allows attempts again once the window has passed', async () => {
    for (let i = 0; i < JOIN_ATTEMPT_LIMIT; i++) {
      await joinTeam(db, { userId: 'u1', submittedCode: 'nope', expectedCode: CODE, now })
    }

    const later = new Date(now.getTime() + JOIN_ATTEMPT_WINDOW_MS + 1)
    const result = await joinTeam(db, {
      userId: 'u1',
      submittedCode: CODE,
      expectedCode: CODE,
      now: later,
    })

    expect(result).toEqual({ ok: true })
  })

  it('clears the attempt record on success', async () => {
    await joinTeam(db, { userId: 'u1', submittedCode: 'nope', expectedCode: CODE, now })
    await joinTeam(db, { userId: 'u1', submittedCode: CODE, expectedCode: CODE, now })

    expect(await db.select().from(joinAttempts)).toEqual([])
  })

  it('is idempotent when someone is already a member', async () => {
    await joinTeam(db, { userId: 'u1', submittedCode: CODE, expectedCode: CODE, now })
    const result = await joinTeam(db, {
      userId: 'u1',
      submittedCode: CODE,
      expectedCode: CODE,
      now,
    })

    expect(result).toEqual({ ok: true })
    expect(await db.select().from(members)).toHaveLength(1)
  })

  it('fails closed when no code is configured', async () => {
    const result = await joinTeam(db, {
      userId: 'u1',
      submittedCode: 'anything',
      expectedCode: undefined,
      now,
    })

    expect(result.ok).toBe(false)
    expect(await db.select().from(members)).toEqual([])
  })
})

describe('joinTeam and patch notes', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
    await db.insert(users).values({ id: 'new', name: 'New', email: 'new@example.com' })
  })

  // A changelog for an app you have never opened is a strange first screen.
  it('marks a brand-new member as caught up on the notes', async () => {
    await joinTeam(db, { userId: 'new', submittedCode: 'code', expectedCode: 'code' })

    const [member] = await db.select().from(members).where(eq(members.userId, 'new'))
    expect(member.lastSeenPatchNote).toBe(LATEST_PATCH_NOTE)
    expect(unseenPatchNotes(member.lastSeenPatchNote)).toEqual([])
  })

  it('starts a new member on the default physiology', async () => {
    await joinTeam(db, { userId: 'new', submittedCode: 'code', expectedCode: 'code' })

    const [member] = await db.select().from(members).where(eq(members.userId, 'new'))
    expect(member).toMatchObject({
      eliminationHalfLifeMinutes: 300,
      sleepThresholdMg: 50,
      bedtimeLocal: '23:00',
    })
  })
})

describe('markPatchNoteSeen', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
    await db.insert(users).values({ id: 'ada', name: 'Ada', email: 'ada@example.com' })
    await db.insert(members).values({
      userId: 'ada',
      displayName: 'Ada',
      joinedAt: new Date('2026-08-01T00:00:00Z'),
      lastSeenPatchNote: null,
    })
  })

  async function seenNote() {
    const [member] = await db.select().from(members).where(eq(members.userId, 'ada'))
    return member.lastSeenPatchNote
  }

  it('stamps the newest note for someone who had seen none', async () => {
    await markPatchNoteSeen(db, 'ada', '2026-09-01', null)
    expect(await seenNote()).toBe('2026-09-01')
  })

  it('advances the marker from a known previous note', async () => {
    await markPatchNoteSeen(db, 'ada', '2026-09-01', null)
    await markPatchNoteSeen(db, 'ada', '2026-10-01', '2026-09-01')
    expect(await seenNote()).toBe('2026-10-01')
  })

  // Two tabs dismissing at once must not walk the marker back to an older note.
  it('ignores an update whose expected previous note is stale', async () => {
    await markPatchNoteSeen(db, 'ada', '2026-10-01', null)
    await markPatchNoteSeen(db, 'ada', '2026-09-01', '2026-08-01')

    expect(await seenNote()).toBe('2026-10-01')
  })

  it('never touches another member', async () => {
    await db.insert(users).values({ id: 'linn', name: 'Linn', email: 'linn@example.com' })
    await db.insert(members).values({
      userId: 'linn',
      displayName: 'Linn',
      joinedAt: new Date('2026-08-01T00:00:00Z'),
      lastSeenPatchNote: null,
    })

    await markPatchNoteSeen(db, 'ada', '2026-09-01', null)

    const [linn] = await db.select().from(members).where(eq(members.userId, 'linn'))
    expect(linn.lastSeenPatchNote).toBeNull()
  })
})
