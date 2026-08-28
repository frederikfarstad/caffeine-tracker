# Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team-visible badges, earned by shapes of behaviour a milligram total cannot show.

**Architecture:** Badge definitions are pure predicates over a `BadgeContext` in
`lib/badges.ts`. `earned_badges` is derived data maintained inside the same
transaction that writes a drink, and rebuildable by replaying the logs in write
order. The context is assembled from `daily_totals` — one row per day rather
than one per drink — so the cost of evaluating badges does not grow with how
much anyone has drunk.

**Tech Stack:** Drizzle ORM over libSQL, Vitest against real database files,
Next.js server components.

**Spec:** `docs/superpowers/specs/2026-08-28-ticker-badges-wrapped-design.md`, section 2.

## Global Constraints

- **A badge is a pure function of the log tables.** Not of when the code ran,
  not of a counter incremented at the time. This is what makes `earned_badges`
  rebuildable, and it rules out any badge of the form "was online when X
  happened".
- **`earned_at` is the `created_at` of the log that qualified them.** Write
  time, not drink time — a drink backdated to breakfast is still earned now, and
  replaying in `created_at` order reproduces it exactly.
- **The context comes from `daily_totals`, not `drink_logs`.** One row per
  member per day. The single exception is `connoisseur`, which needs a distinct
  count over the logs — and that query is skipped entirely once the badge is
  earned, so an established member never pays for it.
- **Evaluate only unearned badges.** Already-earned badges are never
  re-evaluated, which is both cheaper and what makes the previous point work.
- **No badge for a large dose or a day over 400 mg.** The README commits to
  warning copy that is factual rather than nagging, and a prize is the opposite.
- **Migrations must be additive.** For a minute around a merge the old revision
  runs against the new schema.

---

### Task 1: Badge definitions

Pure predicates and the context they read. No database.

**Files:**
- Create: `src/lib/badges.ts`
- Test: `src/lib/badges.test.ts`

**Interfaces:**
- Consumes: `addLocalDays` and `LocalDate` from `@/lib/time`.
- Produces:
  ```ts
  type BadgeId =
    | 'first-drop' | 'century' | 'half-k' | 'dawn-patrol' | 'night-shift'
    | 'week-straight' | 'month-straight' | 'connoisseur' | 'four-shots'
    | 'clean-sweep' | 'pioneer'

  type DayCount = { localDate: LocalDate; count: number }

  type BadgeContext = {
    localHour: number | null
    days: DayCount[]
    distinctTypeCount: number | null
    today: LocalDate
  }

  type Badge = {
    id: BadgeId
    name: string
    description: string
    needsDistinctTypes: boolean
    earned(context: BadgeContext): boolean
    progress(context: BadgeContext): { have: number; need: number } | null
  }

  const BADGES: Badge[]
  function badgeById(id: BadgeId): Badge
  function earnedBadgeIds(context: BadgeContext): BadgeId[]
  function totalDrinks(days: DayCount[]): number
  function longestStreakEndingToday(days: DayCount[], today: LocalDate): number
  function hasCleanMonth(days: DayCount[]): boolean
  ```

`pioneer` is in `BADGES` for its name and description, but its `earned` always
returns `false`: it is awarded to a different member than the one being
evaluated, by `server/badges.ts`, and has no predicate over that member's own
context.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/badges.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BADGES,
  badgeById,
  earnedBadgeIds,
  hasCleanMonth,
  longestStreakEndingToday,
  totalDrinks,
  type BadgeContext,
  type DayCount,
} from './badges'

const TODAY = '2026-08-26'

function context(over: Partial<BadgeContext> = {}): BadgeContext {
  return { localHour: 10, days: [], distinctTypeCount: null, today: TODAY, ...over }
}

/** `count` drinks a day on each of the `n` days ending on `to`. */
function run(n: number, to: string, count = 1): DayCount[] {
  const days: DayCount[] = []
  const end = new Date(`${to}T12:00:00Z`)
  for (let i = 0; i < n; i++) {
    const day = new Date(end.getTime() - i * 86_400_000)
    days.push({ localDate: day.toISOString().slice(0, 10), count })
  }
  return days
}

describe('totalDrinks', () => {
  it('sums the day counts', () => {
    expect(
      totalDrinks([
        { localDate: '2026-08-26', count: 3 },
        { localDate: '2026-08-25', count: 2 },
      ]),
    ).toBe(5)
  })

  it('is zero for a member who has logged nothing', () => {
    expect(totalDrinks([])).toBe(0)
  })
})

describe('longestStreakEndingToday', () => {
  it('counts consecutive days back from today', () => {
    expect(longestStreakEndingToday(run(3, TODAY), TODAY)).toBe(3)
  })

  it('counts back from yesterday when today is empty, so a streak is not lost mid-morning', () => {
    expect(longestStreakEndingToday(run(3, '2026-08-25'), TODAY)).toBe(3)
  })

  it('is zero when the most recent day is two days ago', () => {
    expect(longestStreakEndingToday(run(3, '2026-08-24'), TODAY)).toBe(0)
  })

  it('stops at a gap', () => {
    const days = [...run(2, TODAY), { localDate: '2026-08-22', count: 1 }]
    expect(longestStreakEndingToday(days, TODAY)).toBe(2)
  })
})

describe('hasCleanMonth', () => {
  it('is true when every day of a month was logged', () => {
    expect(hasCleanMonth(run(30, '2026-06-30'))).toBe(true)
  })

  it('is false when one day of the month is missing', () => {
    expect(hasCleanMonth(run(29, '2026-06-30'))).toBe(false)
  })

  it('is false for a month still in progress', () => {
    // August has 31 days; 26 of them is not a clean sweep yet.
    expect(hasCleanMonth(run(26, '2026-08-26'))).toBe(false)
  })
})

describe('badge predicates', () => {
  it('awards first-drop on the very first drink', () => {
    expect(earnedBadgeIds(context({ days: run(1, TODAY) }))).toContain('first-drop')
  })

  it('awards century at exactly 100 drinks and not at 99', () => {
    expect(badgeById('century').earned(context({ days: run(1, TODAY, 100) }))).toBe(true)
    expect(badgeById('century').earned(context({ days: run(1, TODAY, 99) }))).toBe(false)
  })

  it('awards dawn-patrol before seven and not at seven', () => {
    expect(badgeById('dawn-patrol').earned(context({ localHour: 6 }))).toBe(true)
    expect(badgeById('dawn-patrol').earned(context({ localHour: 7 }))).toBe(false)
  })

  it('awards night-shift at twenty-two and not at twenty-one', () => {
    expect(badgeById('night-shift').earned(context({ localHour: 22 }))).toBe(true)
    expect(badgeById('night-shift').earned(context({ localHour: 21 }))).toBe(false)
  })

  it('does not award an hour badge when there is no drink in hand', () => {
    expect(badgeById('dawn-patrol').earned(context({ localHour: null }))).toBe(false)
  })

  it('awards four-shots on a four-drink day', () => {
    expect(badgeById('four-shots').earned(context({ days: run(1, TODAY, 4) }))).toBe(true)
    expect(badgeById('four-shots').earned(context({ days: run(1, TODAY, 3) }))).toBe(false)
  })

  it('awards connoisseur at ten distinct types, and never without the count loaded', () => {
    expect(badgeById('connoisseur').earned(context({ distinctTypeCount: 10 }))).toBe(true)
    expect(badgeById('connoisseur').earned(context({ distinctTypeCount: 9 }))).toBe(false)
    expect(badgeById('connoisseur').earned(context({ distinctTypeCount: null }))).toBe(false)
  })

  it('never awards pioneer from a member context — the server grants it', () => {
    expect(badgeById('pioneer').earned(context({ days: run(500, TODAY, 10) }))).toBe(false)
  })

  it('is the only badge that needs the distinct-type count', () => {
    expect(BADGES.filter((badge) => badge.needsDistinctTypes).map((b) => b.id)).toEqual([
      'connoisseur',
    ])
  })

  it('reports progress towards counting badges', () => {
    expect(badgeById('century').progress(context({ days: run(1, TODAY, 40) }))).toEqual({
      have: 40,
      need: 100,
    })
  })

  it('reports no progress for a badge that is not a count', () => {
    expect(badgeById('dawn-patrol').progress(context())).toBeNull()
  })

  it('has no badge celebrating a large dose', () => {
    const wording = BADGES.map((b) => `${b.name} ${b.description}`.toLowerCase()).join(' ')
    expect(wording).not.toContain('400')
    expect(wording).not.toContain('limit')
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/badges.test.ts`
Expected: the whole file fails to import — `Cannot find module './badges'`.

- [ ] **Step 3: Implement `src/lib/badges.ts`**

```ts
import { addLocalDays, type LocalDate } from './time'

/**
 * What the team can earn.
 *
 * Every badge here is a pure function of the log tables, which is the one
 * constraint that makes `earned_badges` rebuildable — see `db/rebuild-badges.ts`.
 * A badge that depended on when the code happened to run could never be
 * reproduced, and derived data that cannot be rebuilt is not derived data, it
 * is a second source of truth.
 *
 * Deliberately absent: anything celebrating a large dose or a day over the
 * 400 mg reference. The app's warning copy is factual rather than nagging, and
 * turning the one number it gives health guidance about into a prize would
 * undo that.
 */
export type BadgeId =
  | 'first-drop'
  | 'century'
  | 'half-k'
  | 'dawn-patrol'
  | 'night-shift'
  | 'week-straight'
  | 'month-straight'
  | 'connoisseur'
  | 'four-shots'
  | 'clean-sweep'
  | 'pioneer'

/** One member's drinks on one local date. */
export type DayCount = { localDate: LocalDate; count: number }

/**
 * Everything a predicate is allowed to read.
 *
 * `days` comes from `daily_totals` rather than `drink_logs`: one row per day
 * instead of one per drink, so evaluating badges costs the same for someone on
 * their thousandth coffee as on their first.
 *
 * `localHour` is the drink being logged right now, or null when badges are
 * being read rather than awarded. `distinctTypeCount` is null unless it was
 * worth loading — see `needsDistinctTypes`.
 */
export type BadgeContext = {
  localHour: number | null
  days: DayCount[]
  distinctTypeCount: number | null
  today: LocalDate
}

export type Badge = {
  id: BadgeId
  name: string
  description: string
  /** Whether this badge's predicate reads `distinctTypeCount`. */
  needsDistinctTypes: boolean
  earned(context: BadgeContext): boolean
  /** `have / need` for counting badges, null for the rest. */
  progress(context: BadgeContext): { have: number; need: number } | null
}

export function totalDrinks(days: DayCount[]): number {
  return days.reduce((sum, day) => sum + day.count, 0)
}

/**
 * Consecutive days logged, counting back from today.
 *
 * Starts from yesterday when today is empty, so a streak is not reported as
 * broken every morning before the first coffee. Mirrors `getUserStreak` in
 * `server/stats.ts`, which makes the same allowance for the same reason.
 */
export function longestStreakEndingToday(days: DayCount[], today: LocalDate): number {
  const logged = new Set(days.filter((day) => day.count > 0).map((day) => day.localDate))

  let cursor = logged.has(today) ? today : addLocalDays(today, -1)
  let streak = 0

  while (logged.has(cursor)) {
    streak += 1
    cursor = addLocalDays(cursor, -1)
  }

  return streak
}

/** Days in a `YYYY-MM` month, by the calendar rather than by a rule of thumb. */
function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
}

/** True when some calendar month has every one of its days logged. */
export function hasCleanMonth(days: DayCount[]): boolean {
  const byMonth = new Map<string, Set<LocalDate>>()

  for (const day of days) {
    if (day.count === 0) continue
    const month = day.localDate.slice(0, 7)
    const dates = byMonth.get(month) ?? new Set<LocalDate>()
    dates.add(day.localDate)
    byMonth.set(month, dates)
  }

  for (const [month, dates] of byMonth) {
    if (dates.size >= daysInMonth(month)) return true
  }

  return false
}

/** A badge earned by logging `need` drinks in total. */
function counting(id: BadgeId, name: string, description: string, need: number): Badge {
  return {
    id,
    name,
    description,
    needsDistinctTypes: false,
    earned: (context) => totalDrinks(context.days) >= need,
    progress: (context) => ({ have: Math.min(totalDrinks(context.days), need), need }),
  }
}

/** A badge earned by a drink at a particular hour. */
function atHour(
  id: BadgeId,
  name: string,
  description: string,
  matches: (hour: number) => boolean,
): Badge {
  return {
    id,
    name,
    description,
    needsDistinctTypes: false,
    earned: (context) => context.localHour !== null && matches(context.localHour),
    progress: () => null,
  }
}

/** A badge earned by a streak of `need` days. */
function streak(id: BadgeId, name: string, description: string, need: number): Badge {
  return {
    id,
    name,
    description,
    needsDistinctTypes: false,
    earned: (context) => longestStreakEndingToday(context.days, context.today) >= need,
    progress: (context) => ({
      have: Math.min(longestStreakEndingToday(context.days, context.today), need),
      need,
    }),
  }
}

export const BADGES: Badge[] = [
  counting('first-drop', 'First drop', 'Logged your first drink.', 1),
  counting('century', 'Century', 'Logged a hundred drinks.', 100),
  counting('half-k', 'Five hundred', 'Logged five hundred drinks.', 500),
  atHour(
    'dawn-patrol',
    'Dawn patrol',
    'Logged a drink before seven in the morning.',
    (hour) => hour < 7,
  ),
  atHour('night-shift', 'Night shift', 'Logged a drink after ten at night.', (hour) => hour >= 22),
  streak('week-straight', 'Seven straight', 'Logged something every day for a week.', 7),
  streak('month-straight', 'Thirty straight', 'Logged something every day for a month.', 30),
  {
    id: 'connoisseur',
    name: 'Connoisseur',
    description: 'Logged ten different drinks.',
    needsDistinctTypes: true,
    earned: (context) => (context.distinctTypeCount ?? 0) >= 10,
    progress: (context) =>
      context.distinctTypeCount === null
        ? null
        : { have: Math.min(context.distinctTypeCount, 10), need: 10 },
  },
  {
    id: 'four-shots',
    name: 'Four in a day',
    description: 'Logged four drinks in one day.',
    needsDistinctTypes: false,
    earned: (context) => context.days.some((day) => day.count >= 4),
    progress: () => null,
  },
  {
    id: 'clean-sweep',
    name: 'Clean sweep',
    description: 'Logged something on every day of a calendar month.',
    needsDistinctTypes: false,
    earned: (context) => hasCleanMonth(context.days),
    progress: () => null,
  },
  {
    /*
     * The one badge nobody earns from their own context: it is granted to the
     * author of a drink type when somebody else logs it, by `server/badges.ts`.
     * It lives here for its name and description, and its predicate is
     * permanently false so that a member evaluation can never award it.
     */
    id: 'pioneer',
    name: 'Pioneer',
    description: 'Added a drink that somebody else went on to log.',
    needsDistinctTypes: false,
    earned: () => false,
    progress: () => null,
  },
]

const BY_ID = new Map(BADGES.map((badge) => [badge.id, badge]))

export function badgeById(id: BadgeId): Badge {
  const badge = BY_ID.get(id)
  if (!badge) throw new Error(`Unknown badge: ${id}`)
  return badge
}

/** Every badge this context satisfies right now. */
export function earnedBadgeIds(context: BadgeContext): BadgeId[] {
  return BADGES.filter((badge) => badge.earned(context)).map((badge) => badge.id)
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib/badges.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/badges.ts src/lib/badges.test.ts
git commit -m "Add badge definitions as pure predicates"
```

---

### Task 2: The `earned_badges` table

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0007_*.sql` (generated)

**Interfaces:**
- Consumes: `BadgeId` from Task 1.
- Produces: the `earnedBadges` Drizzle table.

- [ ] **Step 1: Add the table**

In `src/db/schema.ts`, after `dailyTotals` and before the party-mode banner
comment, add:

```ts
/**
 * Which badges each member has, and when they got them.
 *
 * Derived data, like `daily_totals`: `drink_logs` remains authoritative and
 * this table can be rebuilt from it at any time by `db/rebuild-badges.ts`.
 * That is only possible because every predicate in `lib/badges.ts` is a pure
 * function of the logs — a badge that depended on when the code ran could
 * never be reproduced, and would quietly become a second source of truth.
 *
 * `earned_at` is the `created_at` of the log that qualified them, not the
 * `consumed_at`. A drink backdated to breakfast is still earned at the moment
 * it was logged, which is what makes replaying in write order exact.
 */
export const earnedBadges = sqliteTable(
  'earned_badges',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badgeId: text('badge_id').$type<BadgeId>().notNull(),
    earnedAt: integer('earned_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.badgeId] }),
    // "Who else has this one", for the leaderboard.
    index('earned_badges_badge_idx').on(table.badgeId),
  ],
)
```

Add the type import at the top of the file, beside the existing
`AlcoholCategory` and `DrinkCategory` imports:

```ts
import type { BadgeId } from '@/lib/badges'
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0007_*.sql` creating `earned_badges` and its
index, plus an updated `meta/_journal.json`. Read the generated SQL and confirm
it is `CREATE TABLE` only — additive, and safe against the currently deployed
code.

- [ ] **Step 3: Verify the schema check passes**

Run: `npm run db:generate && git diff --exit-code src/db/schema.ts`
Expected: exit 0, and the second generate reports nothing to migrate. This is
what CI's `schema` job asserts.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`
Expected: green. Every test builds its database by migrating, so a broken
migration fails here loudly.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "Add earned_badges, derived from the logs like daily_totals"
```

---

### Task 3: Awarding and reading badges

**Files:**
- Create: `src/server/badges.ts`
- Test: `src/server/badges.test.ts`
- Modify: `src/server/drinks.ts`

**Interfaces:**
- Consumes: `BADGES`, `BadgeContext`, `BadgeId`, `earnedBadgeIds` from Task 1;
  `earnedBadges` from Task 2.
- Produces:
  ```ts
  type EarnedBadge = { badgeId: BadgeId; earnedAt: Date }

  function getEarnedBadgeIds(db: AnyDb, userId: string): Promise<BadgeId[]>
  function buildContext(db: AnyDb, userId: string, opts: {
    today: LocalDate; localHour: number | null; needDistinctTypes: boolean
  }): Promise<BadgeContext>
  function awardBadges(db: AnyDb, opts: {
    userId: string; localHour: number | null; today: LocalDate; now: Date
  }): Promise<BadgeId[]>
  function grantBadge(db: AnyDb, opts: {
    userId: string; badgeId: BadgeId; now: Date
  }): Promise<boolean>
  function getBadgesFor(db: AnyDb, userId: string): Promise<EarnedBadge[]>
  function getBadgesForMany(db: AnyDb, userIds: string[]): Promise<Map<string, EarnedBadge[]>>
  ```

`awardBadges` and `grantBadge` take `AnyDb`, which a Drizzle transaction object
also satisfies — that is how `logDrink` calls them inside its existing
transaction.

- [ ] **Step 1: Write the failing tests**

Create `src/server/badges.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '@/db/test-db'
import { drinkTypes, members, users } from '@/db/schema'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import { logDrink } from './drinks'
import { getBadgesFor, getBadgesForMany, getEarnedBadgeIds } from './badges'

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
    { userId: 'ada', displayName: 'Ada', joinedAt: oslo('2026-08-01', 9) },
    { userId: 'bo', displayName: 'Bo', joinedAt: oslo('2026-08-01', 9) },
  ])
  await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)
})

describe('awarding on log', () => {
  it('grants first-drop on the very first drink', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('first-drop')
  })

  it('grants dawn-patrol only for an early drink', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('dawn-patrol')

    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-27', 6) })
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('dawn-patrol')
  })

  it('is idempotent — logging again does not duplicate a badge', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 11) })

    const badges = await getBadgesFor(db, 'ada')
    expect(badges.filter((badge) => badge.badgeId === 'first-drop')).toHaveLength(1)
  })

  it('keeps the original earned_at when the badge is already held', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    const first = (await getBadgesFor(db, 'ada')).find((b) => b.badgeId === 'first-drop')

    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-27', 10) })
    const after = (await getBadgesFor(db, 'ada')).find((b) => b.badgeId === 'first-drop')

    expect(after?.earnedAt.getTime()).toBe(first?.earnedAt.getTime())
  })

  it('grants four-shots on the fourth drink of a day, not the third', async () => {
    for (const hour of [9, 10, 11]) {
      await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', hour) })
    }
    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('four-shots')

    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 12) })
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('four-shots')
  })

  it('grants week-straight on the seventh consecutive day', async () => {
    for (let day = 20; day <= 25; day++) {
      await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo(`2026-08-${day}`, 9) })
    }
    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('week-straight')

    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 9) })
    expect(await getEarnedBadgeIds(db, 'ada')).toContain('week-straight')
  })
})

describe('pioneer', () => {
  it('goes to the author when somebody else logs their drink', async () => {
    await db.insert(drinkTypes).values({
      slug: 'ada_special',
      name: "Ada's special",
      category: 'other',
      caffeineMg: 80,
      createdBy: 'ada',
    })

    await logDrink(db, { userId: 'bo', slug: 'ada_special', now: oslo('2026-08-26', 10) })

    expect(await getEarnedBadgeIds(db, 'ada')).toContain('pioneer')
    expect(await getEarnedBadgeIds(db, 'bo')).not.toContain('pioneer')
  })

  it('does not go to the author for logging their own drink', async () => {
    await db.insert(drinkTypes).values({
      slug: 'ada_other',
      name: "Ada's other",
      category: 'other',
      caffeineMg: 80,
      createdBy: 'ada',
    })

    await logDrink(db, { userId: 'ada', slug: 'ada_other', now: oslo('2026-08-26', 10) })

    expect(await getEarnedBadgeIds(db, 'ada')).not.toContain('pioneer')
  })
})

describe('getBadgesForMany', () => {
  it('groups by member and leaves nobody out', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })

    const byMember = await getBadgesForMany(db, ['ada', 'bo'])

    expect(byMember.get('ada')?.map((b) => b.badgeId)).toContain('first-drop')
    expect(byMember.get('bo')).toEqual([])
  })

  it('asks nothing of the database for an empty list', async () => {
    expect(await getBadgesForMany(db, [])).toEqual(new Map())
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/server/badges.test.ts`
Expected: `Cannot find module './badges'`.

- [ ] **Step 3: Implement `src/server/badges.ts`**

```ts
import { countDistinct, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/db'
import { dailyTotals, drinkLogs, earnedBadges } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import { BADGES, earnedBadgeIds, type BadgeContext, type BadgeId } from '@/lib/badges'
import type { LocalDate } from '@/lib/time'

type AnyDb = Db | TestDb

export type EarnedBadge = { badgeId: BadgeId; earnedAt: Date }

/** The badges this member already holds. */
export async function getEarnedBadgeIds(db: AnyDb, userId: string): Promise<BadgeId[]> {
  const rows = await db
    .select({ badgeId: earnedBadges.badgeId })
    .from(earnedBadges)
    .where(eq(earnedBadges.userId, userId))

  return rows.map((row) => row.badgeId)
}

/**
 * Assemble what the predicates read.
 *
 * `days` comes from `daily_totals` — one row per day rather than one per drink
 * — so this costs the same for someone on their thousandth coffee as on their
 * first. The distinct-type count is the one figure that has to touch
 * `drink_logs`, and it is loaded only when a badge that reads it is still
 * unearned.
 */
export async function buildContext(
  db: AnyDb,
  userId: string,
  {
    today,
    localHour,
    needDistinctTypes,
  }: { today: LocalDate; localHour: number | null; needDistinctTypes: boolean },
): Promise<BadgeContext> {
  const days = await db
    .select({
      localDate: dailyTotals.localDate,
      coffee: dailyTotals.coffeeCount,
      energy: dailyTotals.energyCount,
      other: dailyTotals.otherCount,
    })
    .from(dailyTotals)
    .where(eq(dailyTotals.userId, userId))

  let distinctTypeCount: number | null = null
  if (needDistinctTypes) {
    const [row] = await db
      .select({ types: countDistinct(drinkLogs.drinkTypeId) })
      .from(drinkLogs)
      .where(eq(drinkLogs.userId, userId))
    distinctTypeCount = row?.types ?? 0
  }

  return {
    localHour,
    today,
    distinctTypeCount,
    days: days.map((day) => ({
      localDate: day.localDate,
      count: day.coffee + day.energy + day.other,
    })),
  }
}

/**
 * Give a member a badge they do not already have.
 *
 * Returns whether it was new. `onConflictDoNothing` rather than an upsert: a
 * badge is earned once, and re-awarding it must not move `earned_at` to today.
 */
export async function grantBadge(
  db: AnyDb,
  { userId, badgeId, now }: { userId: string; badgeId: BadgeId; now: Date },
): Promise<boolean> {
  const inserted = await db
    .insert(earnedBadges)
    .values({ userId, badgeId, earnedAt: now })
    .onConflictDoNothing()
    .returning({ badgeId: earnedBadges.badgeId })

  return inserted.length > 0
}

/**
 * Evaluate and award, for the member who just logged a drink.
 *
 * Only unearned badges are evaluated, which is what lets the distinct-type
 * query be skipped for anyone who already has `connoisseur` — and once every
 * badge is theirs, the evaluation stops after a single indexed lookup.
 *
 * Called inside `logDrink`'s transaction, so a badge and the drink that earned
 * it commit together or not at all.
 */
export async function awardBadges(
  db: AnyDb,
  {
    userId,
    localHour,
    today,
    now,
  }: { userId: string; localHour: number | null; today: LocalDate; now: Date },
): Promise<BadgeId[]> {
  const held = new Set(await getEarnedBadgeIds(db, userId))
  const candidates = BADGES.filter((badge) => !held.has(badge.id))
  if (candidates.length === 0) return []

  const context = await buildContext(db, userId, {
    today,
    localHour,
    needDistinctTypes: candidates.some((badge) => badge.needsDistinctTypes),
  })

  const newlyEarned = earnedBadgeIds(context).filter((id) => !held.has(id))
  for (const badgeId of newlyEarned) {
    await grantBadge(db, { userId, badgeId, now })
  }

  return newlyEarned
}

export async function getBadgesFor(db: AnyDb, userId: string): Promise<EarnedBadge[]> {
  return db
    .select({ badgeId: earnedBadges.badgeId, earnedAt: earnedBadges.earnedAt })
    .from(earnedBadges)
    .where(eq(earnedBadges.userId, userId))
}

/**
 * Badges for a set of members, for the leaderboard.
 *
 * Every requested member gets an entry, empty if they have none — a caller
 * rendering a row should not have to tell "no badges" from "not asked about".
 */
export async function getBadgesForMany(
  db: AnyDb,
  userIds: string[],
): Promise<Map<string, EarnedBadge[]>> {
  const byMember = new Map<string, EarnedBadge[]>(userIds.map((id) => [id, []]))
  if (userIds.length === 0) return byMember

  const rows = await db
    .select({
      userId: earnedBadges.userId,
      badgeId: earnedBadges.badgeId,
      earnedAt: earnedBadges.earnedAt,
    })
    .from(earnedBadges)
    .where(inArray(earnedBadges.userId, userIds))

  for (const row of rows) {
    byMember.get(row.userId)?.push({ badgeId: row.badgeId, earnedAt: row.earnedAt })
  }

  return byMember
}
```

- [ ] **Step 4: Wire it into `logDrink`**

In `src/server/drinks.ts`, add the import:

```ts
import { awardBadges, grantBadge } from './badges'
```

Inside `logDrink`'s transaction, after the `addToRollup` call and before
`return log.id`, add:

```ts
    /*
     * Badges commit with the drink that earned them, or not at all. Only
     * unearned badges are evaluated, so an established member pays for one
     * indexed lookup against `earned_badges` — not a scan of everything they
     * have ever drunk.
     */
    await awardBadges(tx, { userId, localHour, today: localDate, now })

    /*
     * The one badge that goes to somebody else: whoever added this drink, when
     * a different member logs it. `created_by` is already on the row read above
     * to snapshot the caffeine figure, so this costs no extra query.
     */
    if (type.createdBy && type.createdBy !== userId) {
      await grantBadge(tx, { userId: type.createdBy, badgeId: 'pioneer', now })
    }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/server/badges.test.ts && npm test`
Expected: the new file passes and the existing tests still do. `drinks.test.ts`
asserts the rollup never drifts; badges must not disturb that.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/server/badges.ts src/server/badges.test.ts src/server/drinks.ts
git commit -m "Award badges inside the transaction that logs the drink"
```

---

### Task 4: The rebuild script

Proves the invariant rather than asserting it.

**Files:**
- Modify: `src/server/badges.ts`
- Modify: `src/server/badges.test.ts`
- Create: `src/db/rebuild-badges.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces:
  ```ts
  type BadgeDrift = { userId: string; badgeId: BadgeId; stored: boolean }
  function rebuildBadges(db: AnyDb): Promise<number>
  function findBadgeDrift(db: AnyDb): Promise<BadgeDrift[]>
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/server/badges.test.ts`, and add `earnedBadges` to the
`@/db/schema` import and `findBadgeDrift, rebuildBadges` to the `./badges`
import at the top of the file:

```ts
describe('rebuilding', () => {
  it('reproduces exactly what awarding produced', async () => {
    for (let day = 20; day <= 26; day++) {
      await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo(`2026-08-${day}`, 6) })
    }
    await logDrink(db, { userId: 'bo', slug: 'espresso', now: oslo('2026-08-26', 23) })

    const before = (await getEarnedBadgeIds(db, 'ada')).sort()
    expect(before.length).toBeGreaterThan(0)

    await rebuildBadges(db)

    expect((await getEarnedBadgeIds(db, 'ada')).sort()).toEqual(before)
    expect(await getEarnedBadgeIds(db, 'bo')).toContain('night-shift')
  })

  it('reports no drift on a healthy database', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    expect(await findBadgeDrift(db)).toEqual([])
  })

  it('reports a badge that was never earned', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    await db.insert(earnedBadges).values({
      userId: 'ada',
      badgeId: 'half-k',
      earnedAt: oslo('2026-08-26', 10),
    })

    expect(await findBadgeDrift(db)).toEqual([
      { userId: 'ada', badgeId: 'half-k', stored: true },
    ])
  })

  it('reports a badge that should have been earned but is missing', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now: oslo('2026-08-26', 10) })
    await db.delete(earnedBadges).where(eq(earnedBadges.userId, 'ada'))

    expect(await findBadgeDrift(db)).toContainEqual({
      userId: 'ada',
      badgeId: 'first-drop',
      stored: false,
    })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/server/badges.test.ts -t rebuilding`
Expected: `rebuildBadges is not a function`.

- [ ] **Step 3: Implement the replay**

Add `asc` to the drizzle import and `drinkTypes` to the schema import at the top
of `src/server/badges.ts`:

```ts
import { asc, countDistinct, eq, inArray } from 'drizzle-orm'
import { dailyTotals, drinkLogs, drinkTypes, earnedBadges } from '@/db/schema'
```

Then append:

```ts
/**
 * What every member's badges *should* be, by replaying the logs in write order.
 *
 * A fold rather than a set of queries: predicates read accumulated state — how
 * many days in a row, how many drinks in a day — and replaying in `created_at`
 * order is the only thing that reproduces the order they were actually earned
 * in. `earned_at` therefore comes out identical to what awarding produced,
 * which is what makes the drift check meaningful.
 *
 * Shared by {@link rebuildBadges} and {@link findBadgeDrift} so the two can
 * never disagree about what "correct" means — the arrangement `db/rollup.ts`
 * uses for the same reason.
 */
async function computeBadges(db: AnyDb): Promise<Map<string, Map<BadgeId, Date>>> {
  const logs = await db
    .select({
      userId: drinkLogs.userId,
      drinkTypeId: drinkLogs.drinkTypeId,
      localDate: drinkLogs.localDate,
      localHour: drinkLogs.localHour,
      createdAt: drinkLogs.createdAt,
      createdBy: drinkTypes.createdBy,
    })
    .from(drinkLogs)
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .orderBy(asc(drinkLogs.createdAt), asc(drinkLogs.id))

  const earned = new Map<string, Map<BadgeId, Date>>()
  const dayCounts = new Map<string, Map<string, number>>()
  const typeIds = new Map<string, Set<number>>()

  const badgesOf = (userId: string) => {
    const existing = earned.get(userId)
    if (existing) return existing
    const fresh = new Map<BadgeId, Date>()
    earned.set(userId, fresh)
    return fresh
  }

  for (const log of logs) {
    const days = dayCounts.get(log.userId) ?? new Map<string, number>()
    days.set(log.localDate, (days.get(log.localDate) ?? 0) + 1)
    dayCounts.set(log.userId, days)

    const types = typeIds.get(log.userId) ?? new Set<number>()
    types.add(log.drinkTypeId)
    typeIds.set(log.userId, types)

    const held = badgesOf(log.userId)
    const context: BadgeContext = {
      localHour: log.localHour,
      today: log.localDate,
      distinctTypeCount: types.size,
      days: [...days].map(([localDate, count]) => ({ localDate, count })),
    }

    for (const badgeId of earnedBadgeIds(context)) {
      if (!held.has(badgeId)) held.set(badgeId, log.createdAt)
    }

    if (log.createdBy && log.createdBy !== log.userId) {
      const authorBadges = badgesOf(log.createdBy)
      if (!authorBadges.has('pioneer')) authorBadges.set('pioneer', log.createdAt)
    }
  }

  return earned
}

/**
 * Rebuild `earned_badges` from `drink_logs`.
 *
 * The escape hatch that makes "derived data" a true claim rather than a hope.
 * Safe to run at any time.
 */
export async function rebuildBadges(db: AnyDb): Promise<number> {
  const computed = await computeBadges(db)

  const rows = [...computed].flatMap(([userId, badges]) =>
    [...badges].map(([badgeId, earnedAt]) => ({ userId, badgeId, earnedAt })),
  )

  await db.delete(earnedBadges)
  if (rows.length > 0) await db.insert(earnedBadges).values(rows)

  return rows.length
}

export type BadgeDrift = { userId: string; badgeId: BadgeId; stored: boolean }

/**
 * Badges the table and the logs disagree about.
 *
 * `stored: true` means the table holds one the logs do not justify; `false`
 * means the logs earned one the table is missing. An empty result is the
 * invariant the whole design rests on, so it is asserted in tests and reported
 * by the CLI rather than merely assumed.
 *
 * Compares which badges exist, not when they were earned: a timestamp adrift by
 * a millisecond is not a correctness problem, and reporting it would bury the
 * ones that are.
 */
export async function findBadgeDrift(db: AnyDb): Promise<BadgeDrift[]> {
  const computed = await computeBadges(db)
  const stored = await db
    .select({ userId: earnedBadges.userId, badgeId: earnedBadges.badgeId })
    .from(earnedBadges)

  const drift: BadgeDrift[] = []
  const storedKeys = new Set(stored.map((row) => `${row.userId} ${row.badgeId}`))

  for (const row of stored) {
    if (!computed.get(row.userId)?.has(row.badgeId)) {
      drift.push({ userId: row.userId, badgeId: row.badgeId, stored: true })
    }
  }

  for (const [userId, badges] of computed) {
    for (const badgeId of badges.keys()) {
      if (!storedKeys.has(`${userId} ${badgeId}`)) {
        drift.push({ userId, badgeId, stored: false })
      }
    }
  }

  return drift
}
```

- [ ] **Step 4: Create the CLI**

Create `src/db/rebuild-badges.ts`, mirroring `rebuild-rollup.ts`:

```ts
import { db } from './index'
import { findBadgeDrift, rebuildBadges } from '@/server/badges'

/**
 * Report any drift between `earned_badges` and `drink_logs`, then rebuild.
 *
 * On a healthy database this reports no drift — which is the point of running
 * it as a check.
 */
async function main() {
  const drift = await findBadgeDrift(db)

  if (drift.length === 0) {
    console.log('No drift: earned_badges matches drink_logs.')
  } else {
    console.warn(`Found ${drift.length} drifted badge(s):`)
    for (const row of drift) {
      console.warn(
        `  ${row.userId} ${row.badgeId}: ${row.stored ? 'stored but not earned' : 'earned but not stored'}`,
      )
    }
  }

  const rows = await rebuildBadges(db)
  console.log(`Rebuilt earned_badges: ${rows} row(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
```

Add the script to `package.json`, beside `db:rebuild-rollup`:

```json
    "db:rebuild-badges": "dotenv -e .env.local -- tsx src/db/rebuild-badges.ts",
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/db/rebuild-badges.ts src/server/badges.ts src/server/badges.test.ts package.json
git commit -m "Rebuild earned_badges by replaying the logs in write order"
```

---

### Task 5: Showing them

**Files:**
- Create: `src/components/BadgeList.tsx`
- Modify: `src/app/(app)/leaderboard/page.tsx`, `src/components/LeaderboardTable.tsx`
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/lib/patch-notes.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `BADGES`, `badgeById`, `BadgeContext`, `BadgeId` from Task 1;
  `buildContext`, `getBadgesFor`, `getBadgesForMany` from Task 3.

- [ ] **Step 1: Write the component**

Create `src/components/BadgeList.tsx`:

```tsx
import { BADGES, badgeById, type BadgeContext, type BadgeId } from '@/lib/badges'

/**
 * A row of badges beside a name, capped so that one decorated member does not
 * push every other row onto a second line.
 */
export function BadgeRow({ badgeIds, max = 3 }: { badgeIds: BadgeId[]; max?: number }) {
  if (badgeIds.length === 0) return null

  const shown = badgeIds.slice(0, max)
  const rest = badgeIds.length - shown.length

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((id) => (
        <span key={id} className="chip" title={badgeById(id).description}>
          {badgeById(id).name}
        </span>
      ))}
      {rest > 0 && <span className="font-gauge text-xs text-oat">+{rest}</span>}
    </span>
  )
}

/**
 * Everything there is to earn, earned first.
 *
 * Unearned badges show progress only where the badge is a count, because a
 * fraction is the part that makes one worth chasing. The rest simply say what
 * they are: "log a drink before seven" needs no progress bar.
 */
export function BadgeList({ earned, context }: { earned: BadgeId[]; context: BadgeContext }) {
  const held = new Set(earned)
  const ordered = [...BADGES].sort((a, b) => Number(held.has(b.id)) - Number(held.has(a.id)))

  return (
    <section className="panel space-y-3 p-4" aria-labelledby="badges-heading">
      <p className="legend" id="badges-heading">
        Badges · {earned.length} of {BADGES.length}
      </p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {ordered.map((badge) => {
          const has = held.has(badge.id)
          const progress = has ? null : badge.progress(context)

          return (
            <li
              key={badge.id}
              className={`flex items-baseline justify-between gap-2 rounded-md border border-hairline px-3 py-2 ${
                has ? 'text-foam' : 'text-oat opacity-60'
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm">{badge.name}</span>
                <span className="block text-xs text-oat">{badge.description}</span>
              </span>
              {progress && (
                <span className="font-gauge text-xs whitespace-nowrap text-oat">
                  {progress.have}/{progress.need}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Add badges to the leaderboard**

Read `src/app/(app)/leaderboard/page.tsx` and `src/components/LeaderboardTable.tsx`
first — the row markup lives in the table component. In the page, after the rows
are fetched:

```tsx
const badgesByMember = await getBadgesForMany(
  db,
  rows.map((row) => row.userId),
)
```

Pass a `badgeIds` array through to each row and render `<BadgeRow badgeIds={...} />`
beside the display name. Put the badges *inside* the existing name cell so that
no column is added and the table still fits a phone.

- [ ] **Step 3: Add the badge list to the dashboard**

In `src/app/(app)/page.tsx`, add to the existing `Promise.all`:

```tsx
    getBadgesFor(db, member.userId),
```

Then build the read-time context. Note `localHour: null` — no drink is being
logged, so the hour badges must not fire:

```tsx
  const badgeContext = await buildContext(db, member.userId, {
    today: localDateOf(now),
    localHour: null,
    needDistinctTypes: true,
  })
```

`localDateOf` is already imported from `@/lib/time` on this page; check before
adding it. Render at the end of `caffeineBlock`, after the intake chart:

```tsx
      <BadgeList earned={badges.map((badge) => badge.badgeId)} context={badgeContext} />
```

- [ ] **Step 4: Add the patch note**

At the top of `PATCH_NOTES` in `src/lib/patch-notes.ts`:

```ts
  {
    id: '2026-08-30',
    title: 'Badges',
    items: [
      'There are eleven badges now, for the things a milligram total cannot show — being early, being consistent, being adventurous. They are on your dashboard and beside your name on the leaderboard.',
      'None of them is for drinking a lot. The 400 mg figure is health guidance, and handing out a prize for passing it would be a strange thing to do.',
      'Add a drink that somebody else goes on to log and you get one for that too.',
    ],
  },
```

- [ ] **Step 5: Update the README**

Add to the `src/` tree listing under "How it's put together":

```
  lib/badges.ts      Badge predicates, all pure functions of the logs
  server/badges.ts   Awarding, reading, and the replay that rebuilds them
```

The README says "Five decisions worth knowing before you change anything".
Change it to six and add:

```markdown
**A badge is a pure function of the logs.** `earned_badges` is derived data,
like `daily_totals`, and `npm run db:rebuild-badges` replays `drink_logs` in
write order to reproduce it exactly. That is only possible because no predicate
reads anything but the logs — a badge for "was online when X happened" could
never be rebuilt, and would quietly become a second source of truth.
```

Add to the command table:

```
| `npm run db:rebuild-badges` | Check `earned_badges` against `drink_logs`, then rebuild |
```

Update the test count in the Tests section to whatever `npm test` now reports.

- [ ] **Step 6: Run the full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Show badges on the dashboard and the leaderboard"
```

---

## Done when

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` are green.
- `npm run db:generate` produces no new migration — the committed one matches
  the schema, which is what CI's `schema` job asserts.
- `findBadgeDrift` returns empty after a run of ordinary logging, and
  `rebuildBadges` reproduces the same badge set.
- No badge celebrates exceeding the 400 mg reference.
