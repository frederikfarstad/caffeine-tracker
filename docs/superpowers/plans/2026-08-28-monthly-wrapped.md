# Monthly Wrapped Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-person summary of the month just gone, arriving once and then staying put.

**Architecture:** Month arithmetic is pure, in `lib/wrapped.ts`. The summary is
assembled in `server/wrapped.ts` from `daily_totals` for the totals and a
month-bounded read of `drink_logs` for the favourite drink and the peak hour,
plus badges earned in the window. It reaches people through a dialog that
mirrors `PatchNotesDialog` exactly — a `last_seen_wrapped` marker on `members`,
decided on the server — and lives permanently at `/wrapped`.

**Tech Stack:** Drizzle ORM over libSQL, Vitest against real database files,
Next.js server components with a small client dialog.

**Spec:** `docs/superpowers/specs/2026-08-28-ticker-badges-wrapped-design.md`, section 3.

## Global Constraints

- **One new nullable column, nothing else.** `members.last_seen_wrapped`, a
  `YYYY-MM` string. Additive, so it is safe against the revision currently
  deployed.
- **Totals come from `daily_totals`.** That is what the rollup is for. Only the
  favourite drink and the peak hour need `drink_logs`, and both are bounded to
  one month by `local_date`.
- **The dialog never fires on an empty month.** Somebody who joined last week
  does not get an empty celebration of a month they were not here for.
- **No nav pill.** The layout carries a comment explaining that a fifth pill
  wraps the bar to two rows on a phone. Linked from the dashboard and the
  dialog instead.
- **String comparison is the month comparison.** `YYYY-MM` sorts
  chronologically, exactly as `lib/patch-notes.ts` relies on for `YYYY-MM-DD`.

---

### Task 1: Month arithmetic

**Files:**
- Create: `src/lib/wrapped.ts`
- Test: `src/lib/wrapped.test.ts`

**Interfaces:**
- Consumes: `LocalDate` from `@/lib/time`.
- Produces:
  ```ts
  type MonthKey = string // `YYYY-MM`

  function monthOf(date: LocalDate): MonthKey
  function previousMonth(month: MonthKey): MonthKey
  function monthRange(month: MonthKey): { from: LocalDate; to: LocalDate }
  function formatMonth(month: MonthKey): string
  function isValidMonth(value: string): boolean
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/wrapped.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMonth, isValidMonth, monthOf, monthRange, previousMonth } from './wrapped'

describe('monthOf', () => {
  it('takes the month off a local date', () => {
    expect(monthOf('2026-08-26')).toBe('2026-08')
  })
})

describe('previousMonth', () => {
  it('steps back one month', () => {
    expect(previousMonth('2026-08')).toBe('2026-07')
  })

  it('steps back across a year boundary', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
  })
})

describe('monthRange', () => {
  it('spans the whole month', () => {
    expect(monthRange('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('knows a thirty-day month', () => {
    expect(monthRange('2026-06').to).toBe('2026-06-30')
  })

  it('knows February in a leap year', () => {
    expect(monthRange('2024-02').to).toBe('2024-02-29')
  })

  it('knows February in a common year', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28')
  })
})

describe('formatMonth', () => {
  it('names the month and the year', () => {
    expect(formatMonth('2026-08')).toBe('August 2026')
  })
})

describe('isValidMonth', () => {
  it('accepts a well-formed month', () => {
    expect(isValidMonth('2026-08')).toBe(true)
  })

  it('rejects rubbish, a bare year, and an impossible month', () => {
    expect(isValidMonth('nonsense')).toBe(false)
    expect(isValidMonth('2026')).toBe(false)
    expect(isValidMonth('2026-13')).toBe(false)
    expect(isValidMonth('2026-00')).toBe(false)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/wrapped.test.ts`
Expected: `Cannot find module './wrapped'`.

- [ ] **Step 3: Implement `src/lib/wrapped.ts`**

```ts
import type { LocalDate } from './time'

/**
 * A calendar month, `YYYY-MM`.
 *
 * A string rather than a pair of numbers, for the reason `lib/patch-notes.ts`
 * uses one: ordering and comparison become the same operation, and "is this
 * month later than the one they last saw" needs no parsing.
 */
export type MonthKey = string

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidMonth(value: string): boolean {
  return MONTH_PATTERN.test(value)
}

export function monthOf(date: LocalDate): MonthKey {
  return date.slice(0, 7)
}

export function previousMonth(month: MonthKey): MonthKey {
  const [year, monthNumber] = month.split('-').map(Number)
  return monthNumber === 1
    ? `${year - 1}-12`
    : `${year}-${String(monthNumber - 1).padStart(2, '0')}`
}

/**
 * The first and last local dates of a month.
 *
 * `Date.UTC(year, month, 0)` is the last day of the month before `month`, which
 * for a one-based month number is the last day of the one asked for. Leap years
 * come free, which is why this is arithmetic rather than a table.
 */
export function monthRange(month: MonthKey): { from: LocalDate; to: LocalDate } {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function formatMonth(month: MonthKey): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${MONTH_NAMES[monthNumber - 1]} ${year}`
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/wrapped.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wrapped.ts src/lib/wrapped.test.ts
git commit -m "Add month arithmetic for the monthly wrapped"
```

---

### Task 2: The `last_seen_wrapped` column

**Files:**
- Modify: `src/db/schema.ts`, `src/server/auth.ts`, `src/server/membership.ts`
- Create: `src/db/migrations/0008_*.sql` (generated)

- [ ] **Step 1: Add the column**

In `src/db/schema.ts`, directly after `lastSeenPatchNote` in the `members`
table:

```ts
  /**
   * The newest monthly wrapped this person has seen, `YYYY-MM`, or null.
   *
   * Exactly the arrangement `lastSeenPatchNote` uses, and for the same reason:
   * server-side so the summary follows the account across devices instead of
   * firing once per browser.
   */
  lastSeenWrapped: text('last_seen_wrapped'),
```

- [ ] **Step 2: Carry it onto the `Member` type**

In `src/server/auth.ts`, add to the `Member` type beside `lastSeenPatchNote`:

```ts
  lastSeenWrapped: string | null
```

and to `toMember`:

```ts
    lastSeenWrapped: row.lastSeenWrapped,
```

- [ ] **Step 3: Stamp new members as caught up**

In `src/server/membership.ts`, where `joinTeam` inserts a member with
`lastSeenPatchNote: LATEST_PATCH_NOTE`, there is nothing to add: a new member's
`lastSeenWrapped` is null, and Task 4's firing rule requires the previous month
to have data for them — which a member who joined today does not have. Confirm
this by reading `joinTeam` and leave it alone.

- [ ] **Step 4: Generate the migration and verify**

Run: `npm run db:generate`
Expected: `0008_*.sql` containing a single `ALTER TABLE ... ADD ...`. Read it and
confirm the column is nullable with no default — additive and safe against the
deployed revision.

Run: `npm run db:generate` again.
Expected: "No schema changes, nothing to migrate".

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations src/server/auth.ts
git commit -m "Add members.last_seen_wrapped, mirroring last_seen_patch_note"
```

---

### Task 3: Assembling the summary

**Files:**
- Create: `src/server/wrapped.ts`
- Test: `src/server/wrapped.test.ts`

**Interfaces:**
- Consumes: `MonthKey`, `monthRange` from Task 1; `getBadgesFor` from the
  achievements work.
- Produces:
  ```ts
  type WrappedFavourite = { name: string; count: number }

  type Wrapped = {
    month: MonthKey
    totalMg: number
    drinkCount: number
    coffeeCount: number
    energyCount: number
    activeDays: number
    longestStreak: number
    rank: number
    memberCount: number
    biggestDay: { localDate: LocalDate; mg: number } | null
    favourite: WrappedFavourite | null
    peakHour: number | null
    badgeIds: BadgeId[]
    teamMg: number
  }

  function getWrapped(db: AnyDb, userId: string, month: MonthKey): Promise<Wrapped | null>
  function markWrappedSeen(db: AnyDb, userId: string, month: MonthKey): Promise<void>
  ```

`getWrapped` returns `null` when the member logged nothing that month — which
is what stops the dialog firing at somebody who was not here.

- [ ] **Step 1: Write the failing tests**

Create `src/server/wrapped.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '@/db/test-db'
import { drinkTypes, members, users } from '@/db/schema'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import { logDrink } from './drinks'
import { getWrapped, markWrappedSeen } from './wrapped'

let db: TestDb

function oslo(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour - 2).padStart(2, '0')}:00:00Z`)
}

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(users).values([
    { id: 'ada', name: 'Ada', email: 'ada@example.com' },
    { id: 'bo', name: 'Bo', email: 'bo@example.com' },
  ])
  await db.insert(members).values([
    { userId: 'ada', displayName: 'Ada', joinedAt: oslo('2026-07-01', 9) },
    { userId: 'bo', displayName: 'Bo', joinedAt: oslo('2026-07-01', 9) },
  ])
  await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)

  // Ada, through July: three coffees and one energy drink, spread over days.
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-07-02', 9) }) // 95
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-07-03', 9) }) // 95
  await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-07-04', 9) }) // 95
  await logDrink(db, { userId: 'ada', slug: 'energy_050', now: oslo('2026-07-04', 14) }) // 160

  // Bo, quieter, and one drink in August that must not leak into July.
  await logDrink(db, { userId: 'bo', slug: 'espresso', now: oslo('2026-07-02', 9) }) // 63
  await logDrink(db, { userId: 'bo', slug: 'coffee', now: oslo('2026-08-02', 9) }) // 95
})

describe('getWrapped', () => {
  it('totals the month and nothing outside it', async () => {
    const wrapped = await getWrapped(db, 'ada', '2026-07')

    expect(wrapped).toMatchObject({
      month: '2026-07',
      totalMg: 445,
      drinkCount: 4,
      coffeeCount: 3,
      energyCount: 1,
      activeDays: 3,
    })
  })

  it('excludes a drink from the following month', async () => {
    expect((await getWrapped(db, 'bo', '2026-07'))?.totalMg).toBe(63)
  })

  it('names the biggest day', async () => {
    // The 4th: a coffee and an energy drink, 255 mg.
    expect((await getWrapped(db, 'ada', '2026-07'))?.biggestDay).toEqual({
      localDate: '2026-07-04',
      mg: 255,
    })
  })

  it('names the most-logged drink', async () => {
    expect((await getWrapped(db, 'ada', '2026-07'))?.favourite).toEqual({
      name: 'Coffee',
      count: 3,
    })
  })

  it('finds the hour with the most drinks', async () => {
    expect((await getWrapped(db, 'ada', '2026-07'))?.peakHour).toBe(9)
  })

  it('ranks within the month', async () => {
    expect((await getWrapped(db, 'ada', '2026-07'))?.rank).toBe(1)
    expect((await getWrapped(db, 'bo', '2026-07'))?.rank).toBe(2)
  })

  it('counts the longest streak inside the month', async () => {
    // The 2nd, 3rd and 4th.
    expect((await getWrapped(db, 'ada', '2026-07'))?.longestStreak).toBe(3)
  })

  it('reports the team total alongside the personal one', async () => {
    expect((await getWrapped(db, 'ada', '2026-07'))?.teamMg).toBe(508)
  })

  it('is null for a member who logged nothing that month', async () => {
    expect(await getWrapped(db, 'bo', '2026-06')).toBeNull()
  })

  it('is null for a month nobody was here for', async () => {
    expect(await getWrapped(db, 'ada', '2025-01')).toBeNull()
  })
})

describe('markWrappedSeen', () => {
  it('records the month', async () => {
    await markWrappedSeen(db, 'ada', '2026-07')

    const [row] = await db.select().from(members).where(eq(members.userId, 'ada'))
    expect(row.lastSeenWrapped).toBe('2026-07')
  })

  it('never moves the marker backwards', async () => {
    await markWrappedSeen(db, 'ada', '2026-07')
    await markWrappedSeen(db, 'ada', '2026-06')

    const [row] = await db.select().from(members).where(eq(members.userId, 'ada'))
    expect(row.lastSeenWrapped).toBe('2026-07')
  })
})
```

Add `import { eq } from 'drizzle-orm'` at the top of the file.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/server/wrapped.test.ts`
Expected: `Cannot find module './wrapped'`.

- [ ] **Step 3: Implement `src/server/wrapped.ts`**

```ts
import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, drinkTypes, members } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import type { BadgeId } from '@/lib/badges'
import { monthRange, type MonthKey } from '@/lib/wrapped'
import { addLocalDays, type LocalDate } from '@/lib/time'
import { getBadgesFor } from './badges'

type AnyDb = Db | TestDb

export type WrappedFavourite = { name: string; count: number }

/** One person's month. */
export type Wrapped = {
  month: MonthKey
  totalMg: number
  drinkCount: number
  coffeeCount: number
  energyCount: number
  activeDays: number
  longestStreak: number
  rank: number
  memberCount: number
  biggestDay: { localDate: LocalDate; mg: number } | null
  favourite: WrappedFavourite | null
  peakHour: number | null
  badgeIds: BadgeId[]
  teamMg: number
}

/** The longest run of consecutive dates in a set. */
function longestRun(dates: LocalDate[]): number {
  const present = new Set(dates)
  let longest = 0

  for (const date of present) {
    // Only start counting from the beginning of a run, so each is walked once.
    if (present.has(addLocalDays(date, -1))) continue

    let length = 0
    let cursor = date
    while (present.has(cursor)) {
      length += 1
      cursor = addLocalDays(cursor, 1)
    }
    longest = Math.max(longest, length)
  }

  return longest
}

/**
 * One person's month, or null if they did not have one.
 *
 * Null rather than a zeroed summary: the dialog's firing rule is "is there a
 * wrapped for last month", and a member who joined a week ago should not be
 * shown an empty celebration of a month they were not here for.
 *
 * Totals come from `daily_totals` — a month is thirty-odd rows there against
 * however many drinks it took. Only the favourite drink and the peak hour need
 * `drink_logs`, and both are bounded to the month by `local_date`.
 */
export async function getWrapped(
  db: AnyDb,
  userId: string,
  month: MonthKey,
): Promise<Wrapped | null> {
  const { from, to } = monthRange(month)
  const withinMonth = and(gte(dailyTotals.localDate, from), lte(dailyTotals.localDate, to))

  const days = await db
    .select({
      localDate: dailyTotals.localDate,
      totalMg: dailyTotals.totalMg,
      coffeeCount: dailyTotals.coffeeCount,
      energyCount: dailyTotals.energyCount,
      otherCount: dailyTotals.otherCount,
    })
    .from(dailyTotals)
    .where(and(eq(dailyTotals.userId, userId), withinMonth))

  if (days.length === 0) return null

  const totalMg = days.reduce((sum, day) => sum + day.totalMg, 0)
  const coffeeCount = days.reduce((sum, day) => sum + day.coffeeCount, 0)
  const energyCount = days.reduce((sum, day) => sum + day.energyCount, 0)
  const otherCount = days.reduce((sum, day) => sum + day.otherCount, 0)

  const biggest = days.reduce((best, day) => (day.totalMg > best.totalMg ? day : best), days[0])

  // Everyone's month, for the rank and the team line. One row per member per
  // day, so this stays a month-sized read however long the team has existed.
  const perMember = await db
    .select({
      userId: dailyTotals.userId,
      totalMg: sql<number>`coalesce(sum(${dailyTotals.totalMg}), 0)`,
    })
    .from(dailyTotals)
    .where(withinMonth)
    .groupBy(dailyTotals.userId)

  const sorted = [...perMember].sort((a, b) => b.totalMg - a.totalMg)
  const rank = sorted.findIndex((row) => row.totalMg <= totalMg) + 1

  const [favouriteRow] = await db
    .select({ name: drinkTypes.name, drinks: count(drinkLogs.id) })
    .from(drinkLogs)
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .where(
      and(
        eq(drinkLogs.userId, userId),
        gte(drinkLogs.localDate, from),
        lte(drinkLogs.localDate, to),
      ),
    )
    .groupBy(drinkTypes.id)
    .orderBy(desc(count(drinkLogs.id)), asc(drinkTypes.name))
    .limit(1)

  const [hourRow] = await db
    .select({ hour: drinkLogs.localHour, drinks: count(drinkLogs.id) })
    .from(drinkLogs)
    .where(
      and(
        eq(drinkLogs.userId, userId),
        gte(drinkLogs.localDate, from),
        lte(drinkLogs.localDate, to),
      ),
    )
    .groupBy(drinkLogs.localHour)
    .orderBy(desc(count(drinkLogs.id)), asc(drinkLogs.localHour))
    .limit(1)

  const badges = await getBadgesFor(db, userId)
  const monthStart = new Date(`${from}T00:00:00Z`)
  const monthEnd = new Date(`${to}T23:59:59Z`)

  return {
    month,
    totalMg,
    drinkCount: coffeeCount + energyCount + otherCount,
    coffeeCount,
    energyCount,
    activeDays: days.filter((day) => day.totalMg > 0).length,
    longestStreak: longestRun(days.filter((day) => day.totalMg > 0).map((day) => day.localDate)),
    rank,
    memberCount: sorted.length,
    biggestDay: { localDate: biggest.localDate, mg: biggest.totalMg },
    favourite: favouriteRow ? { name: favouriteRow.name, count: favouriteRow.drinks } : null,
    peakHour: hourRow?.hour ?? null,
    badgeIds: badges
      .filter((badge) => badge.earnedAt >= monthStart && badge.earnedAt <= monthEnd)
      .map((badge) => badge.badgeId),
    teamMg: perMember.reduce((sum, row) => sum + row.totalMg, 0),
  }
}

/**
 * Record that this member has seen a month's wrapped.
 *
 * Never moves backwards: the page can be used to read an older month, and
 * doing so must not re-arm the dialog for one already dismissed.
 */
export async function markWrappedSeen(
  db: AnyDb,
  userId: string,
  month: MonthKey,
): Promise<void> {
  await db
    .update(members)
    .set({ lastSeenWrapped: month })
    .where(
      and(
        eq(members.userId, userId),
        sql`(${members.lastSeenWrapped} IS NULL OR ${members.lastSeenWrapped} < ${month})`,
      ),
    )
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/server/wrapped.test.ts && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/server/wrapped.ts src/server/wrapped.test.ts
git commit -m "Assemble a member's month from the rollup"
```

---

### Task 4: The page and the dialog

**Files:**
- Create: `src/app/(app)/wrapped/page.tsx`, `src/components/WrappedDialog.tsx`,
  `src/components/WrappedSummary.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/app/(app)/actions.ts`,
  `src/app/(app)/page.tsx`, `src/lib/patch-notes.ts`, `README.md`

- [ ] **Step 1: Write the shared summary component**

Create `src/components/WrappedSummary.tsx` — the body of both the page and the
dialog, so the two cannot drift:

```tsx
import { BadgeRow } from '@/components/BadgeList'
import { StatTile } from '@/components/StatTile'
import { formatMg } from '@/lib/caffeine'
import { formatDayTick } from '@/lib/format'
import { formatMonth } from '@/lib/wrapped'
import type { Wrapped } from '@/server/wrapped'

/** The month, told in tiles and one closing sentence. */
export function WrappedSummary({ wrapped }: { wrapped: Wrapped }) {
  const share = wrapped.teamMg > 0 ? Math.round((wrapped.totalMg / wrapped.teamMg) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile legend="Caffeine" value={formatMg(wrapped.totalMg)} tone="crema" />
        <StatTile
          legend="Drinks"
          value={String(wrapped.drinkCount)}
          detail={`${wrapped.coffeeCount} coffee · ${wrapped.energyCount} energy`}
        />
        <StatTile legend="Rank" value={`${wrapped.rank} of ${wrapped.memberCount}`} />
        <StatTile
          legend="Longest streak"
          value={String(wrapped.longestStreak)}
          detail={`${wrapped.activeDays} days logged`}
          tone="zap"
        />
      </div>

      <dl className="space-y-2 text-sm">
        {wrapped.favourite && (
          <div className="flex justify-between gap-3">
            <dt className="text-oat">Your drink</dt>
            <dd className="text-foam">
              {wrapped.favourite.name} · {wrapped.favourite.count} of them
            </dd>
          </div>
        )}
        {wrapped.biggestDay && (
          <div className="flex justify-between gap-3">
            <dt className="text-oat">Biggest day</dt>
            <dd className="text-foam">
              {formatDayTick(wrapped.biggestDay.localDate)} · {formatMg(wrapped.biggestDay.mg)}
            </dd>
          </div>
        )}
        {wrapped.peakHour !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-oat">Your hour</dt>
            <dd className="text-foam">{String(wrapped.peakHour).padStart(2, '0')}:00</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-oat">Share of the office</dt>
          <dd className="text-foam">{share}%</dd>
        </div>
      </dl>

      {wrapped.badgeIds.length > 0 && (
        <div className="space-y-2 border-t border-hairline pt-3">
          <p className="legend">Earned in {formatMonth(wrapped.month)}</p>
          <BadgeRow badgeIds={wrapped.badgeIds} max={6} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write the page**

Create `src/app/(app)/wrapped/page.tsx`:

```tsx
import Link from 'next/link'
import { WrappedSummary } from '@/components/WrappedSummary'
import { db } from '@/db'
import { formatMonth, isValidMonth, monthOf, previousMonth } from '@/lib/wrapped'
import { localDateOf } from '@/lib/time'
import { requireMember } from '@/server/auth'
import { getWrapped } from '@/server/wrapped'

export const metadata = { title: 'Your month — Buzz' }

export default async function WrappedPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const member = await requireMember()
  const params = await searchParams

  // Defaults to the last completed month: this one is not over, and a summary
  // of a month still running would change every time you looked at it.
  const thisMonth = monthOf(localDateOf(new Date()))
  const month =
    params.month && isValidMonth(params.month) ? params.month : previousMonth(thisMonth)

  const wrapped = await getWrapped(db, member.userId, month)

  return (
    <>
      <div className="space-y-1">
        <p className="legend">Your month</p>
        <h1 className="display text-3xl leading-tight tracking-tight text-foam">
          {formatMonth(month)}
        </h1>
      </div>

      {wrapped ? (
        <div className="panel space-y-4 p-4">
          <WrappedSummary wrapped={wrapped} />
        </div>
      ) : (
        <p className="panel px-4 py-8 text-center text-sm text-oat">
          Nothing logged in {formatMonth(month)}.
        </p>
      )}

      <p className="text-sm text-oat">
        <Link
          href={`/wrapped?month=${previousMonth(month)}`}
          className="underline decoration-hairline underline-offset-2"
        >
          The month before
        </Link>
      </p>
    </>
  )
}
```

- [ ] **Step 3: Write the dialog**

Create `src/components/WrappedDialog.tsx`, mirroring `PatchNotesDialog`
including its reasoning about `onClose`:

```tsx
'use client'

import Link from 'next/link'
import { useEffect, useRef, useTransition } from 'react'
import { dismissWrapped } from '@/app/(app)/actions'
import { WrappedSummary } from '@/components/WrappedSummary'
import { formatMonth } from '@/lib/wrapped'
import type { Wrapped } from '@/server/wrapped'

/**
 * Last month, once.
 *
 * The same arrangement as `PatchNotesDialog`: a native `<dialog>` for the focus
 * trap and Escape handling, rendered by the server only when there is something
 * to show, and marked seen from `close` so that however it was dismissed counts.
 *
 * Fire-and-forget, for the same reason: the summary has been read by the time
 * this runs, and the worst failure left is seeing it once more.
 */
export function WrappedDialog({ wrapped }: { wrapped: Wrapped }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="wrapped-heading"
      onClose={() => {
        startTransition(() => {
          void dismissWrapped(wrapped.month)
        })
      }}
      className="panel m-auto w-[min(32rem,calc(100vw-2rem))] p-0 text-foam backdrop:bg-roast/80"
    >
      <div className="space-y-4 p-5">
        <div className="space-y-1">
          <p className="legend">Your month</p>
          <h2
            id="wrapped-heading"
            className="display text-2xl leading-tight tracking-tight text-foam"
          >
            {formatMonth(wrapped.month)}
          </h2>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <WrappedSummary wrapped={wrapped} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
          <Link
            href={`/wrapped?month=${wrapped.month}`}
            className="text-sm text-oat underline decoration-hairline underline-offset-2"
          >
            Keep it open
          </Link>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="keycap rounded-xl border border-crema-dim bg-crema/10 px-4 py-2.5 font-gauge text-[0.6875rem] tracking-[0.12em] text-foam uppercase transition-colors hover:border-crema hover:bg-crema/15"
          >
            Got it
          </button>
        </div>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 4: Add the server action**

In `src/app/(app)/actions.ts`, beside `dismissPatchNotes`:

```ts
/**
 * Mark a monthly wrapped as seen.
 *
 * Fire-and-forget from the dialog, like `dismissPatchNotes`: nothing on screen
 * depends on the result.
 */
export async function dismissWrapped(month: string) {
  const member = await requireMember()
  await markWrappedSeen(db, member.userId, month)
}
```

Import `markWrappedSeen` from `@/server/wrapped`. Match whatever `revalidate`
or return-shape convention `dismissPatchNotes` already uses — read it first.

- [ ] **Step 5: Fire it from the layout**

In `src/app/(app)/layout.tsx`, beside the patch-notes decision:

```tsx
  /*
   * Last month's wrapped, if they have not seen it. Decided on the server, like
   * the patch notes, so the dialog is either in the markup or it is not.
   *
   * `getWrapped` returns null for a member who logged nothing that month, which
   * is what stops somebody who joined last week being shown an empty
   * celebration of a month they were not here for.
   */
  const lastMonth = previousMonth(monthOf(localDateOf(new Date())))
  const wrapped =
    member.lastSeenWrapped === null || member.lastSeenWrapped < lastMonth
      ? await getWrapped(db, member.userId, lastMonth)
      : null
```

and render, after the patch-notes dialog:

```tsx
      {wrapped && <WrappedDialog wrapped={wrapped} />}
```

Note the ordering: patch notes render first. Two modal dialogs at once is a poor
experience, so if `unseen.length > 0` prefer showing only the patch notes and
leave the wrapped for the next visit — guard the wrapped render with
`{unseen.length === 0 && wrapped && <WrappedDialog wrapped={wrapped} />}`.

- [ ] **Step 6: Link it from the dashboard**

In `src/app/(app)/page.tsx`, inside `caffeineBlock` near the period tabs, add a
quiet link — no nav pill, per the constraint:

```tsx
        <Link href="/wrapped" className="text-sm text-oat underline decoration-hairline underline-offset-2">
          Last month
        </Link>
```

- [ ] **Step 7: Patch note and README**

At the top of `PATCH_NOTES`:

```ts
  {
    id: '2026-08-31',
    title: 'Your month',
    items: [
      'On the first of each month you get a summary of the last one: what you drank, your biggest day, the hour you are most predictable, and where you came in.',
      'It shows up once and then gets out of the way. It also lives at a page of its own, so a wrapped you dismissed is still there to settle an argument with.',
      'Months you were not here for are not celebrated at you.',
    ],
  },
```

In `README.md`, add `lib/wrapped.ts` and `server/wrapped.ts` to the tree
listing, and update the test count to whatever `npm test` reports.

- [ ] **Step 8: Full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green, and `/wrapped` appears in the build's route list.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add the monthly wrapped, as a dialog and a page"
```

---

## Done when

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` are green.
- `npm run db:generate` reports nothing to migrate.
- `/wrapped` renders last month, and `?month=` renders a named one.
- The dialog does not fire for a member with no data in the previous month.
- No nav pill was added.
