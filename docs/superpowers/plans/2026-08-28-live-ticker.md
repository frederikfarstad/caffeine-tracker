# Live Ticker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A short feed on `/team` showing who logged what in the last twelve hours.

**Architecture:** One read-only query in the existing `server/stats.ts`, one pure
formatting helper in `lib/format.ts`, one server component rendering a list. No
schema change, no new table, no client state — freshness comes from the
`LiveRefresh` component the team page already mounts.

**Tech Stack:** Next.js App Router (server components), Drizzle ORM over libSQL,
Vitest against real database files, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-28-ticker-badges-wrapped-design.md`, section 1.

## Global Constraints

- **Caffeine only.** The query reads `drink_logs` and must never read
  `alcohol_logs`. Party mode is opt-in per member, and a viewer having it on is
  not the subject agreeing to appear in a feed.
- **Bounded by `local_date`.** Every query is restricted to
  `local_date IN (yesterday, today)` so `drink_logs_date_idx` serves it and the
  scan does not grow with history. Turso bills rows scanned.
- **One `now` per render.** The page already creates a single `new Date()` and
  passes it down. Nothing here may call `new Date()` during render.
- **No schema change.** If `src/db/schema.ts` is touched, the `schema` CI check
  fails without a committed migration. This feature needs neither.
- Tests are Vitest. Pure functions get unit tests in `src/lib/*.test.ts`; server
  functions get integration tests against `createTestDb()`.

---

### Task 1: `formatAgo`

A pure helper turning an instant and a reference time into "just now",
"4 min ago" or "3 h ago". Lives beside the app's other formatters.

**Files:**
- Modify: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatAgo(instant: Date | number, now: Date | number): string`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/format.test.ts`. Match the import style already at the top of
that file — add `formatAgo` to the existing `@/lib/format` import rather than
adding a second import statement.

```ts
describe('formatAgo', () => {
  const now = new Date('2026-08-26T13:00:00Z')

  function ago(ms: number) {
    return formatAgo(new Date(now.getTime() - ms), now)
  }

  it('calls anything under a minute "just now"', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59_000)).toBe('just now')
  })

  it('counts whole minutes up to an hour', () => {
    expect(ago(60_000)).toBe('1 min ago')
    expect(ago(4 * 60_000 + 30_000)).toBe('4 min ago')
    expect(ago(59 * 60_000)).toBe('59 min ago')
  })

  it('switches to whole hours at sixty minutes', () => {
    expect(ago(60 * 60_000)).toBe('1 h ago')
    expect(ago(90 * 60_000)).toBe('1 h ago')
    expect(ago(3 * 60 * 60_000)).toBe('3 h ago')
  })

  it('treats an instant in the future as now, rather than counting backwards', () => {
    expect(formatAgo(new Date(now.getTime() + 5_000), now)).toBe('just now')
  })

  it('accepts epoch milliseconds, like the other formatters here', () => {
    expect(formatAgo(now.getTime() - 120_000, now.getTime())).toBe('2 min ago')
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run src/lib/format.test.ts
```

Expected: failures reading roughly `formatAgo is not a function` — or a
TypeScript error that `formatAgo` is not exported from `@/lib/format`.

- [ ] **Step 3: Implement it**

Append to `src/lib/format.ts`:

```ts
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/**
 * How long ago an instant was, in the shortest form that is still true.
 *
 * Takes `now` as an argument rather than reading the clock, so a server render
 * can label a whole list against the single instant the rest of the page was
 * built from. A helper that called `Date.now()` itself would give two rows in
 * the same list two different presents.
 *
 * Clamps the future to "just now": a clock a few seconds out should not produce
 * a negative count.
 */
export function formatAgo(instant: Date | number, now: Date | number): string {
  const elapsed = Number(now) - Number(instant)
  if (elapsed < MINUTE_MS) return 'just now'

  const minutes = Math.floor(elapsed / MINUTE_MS)
  if (minutes < 60) return `${minutes} min ago`

  return `${Math.floor(elapsed / HOUR_MS)} h ago`
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run src/lib/format.test.ts
```

Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "Add formatAgo, for relative times in the team ticker"
```

---

### Task 2: `getTeamActivity`

The query behind the feed.

**Files:**
- Modify: `src/server/stats.ts`
- Test: `src/server/stats.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```ts
  type TeamActivityEvent = {
    id: number
    userId: string
    displayName: string
    drinkName: string
    caffeineMg: number
    volumeMl: number | null
    consumedAt: Date
  }

  function getTeamActivity(
    db: AnyDb,
    options?: { now?: Date; limit?: number },
  ): Promise<TeamActivityEvent[]>
  ```

- [ ] **Step 1: Write the failing tests**

Add `getTeamActivity` to the existing `./stats` import at the top of
`src/server/stats.test.ts`, add `logAlcoholDrink` and the alcohol fixtures to
the imports as shown, then append the describe block.

The imports to add at the top of the file:

```ts
import { alcoholDrinkTypes } from '@/db/schema'
import { ALCOHOL_TYPE_SEEDS } from '@/db/alcohol-seed-data'
import { logAlcoholDrink } from './alcohol'
```

The tests:

```ts
describe('getTeamActivity', () => {
  it('returns the most recent drink first, naming the person and the drink', async () => {
    const feed = await getTeamActivity(db, { now: NOW })

    expect(feed[0]).toMatchObject({
      displayName: 'Ada',
      drinkName: 'Energy 0.5L',
      caffeineMg: 160,
    })
    expect(feed.map((event) => event.consumedAt.getTime())).toEqual(
      [...feed].map((event) => event.consumedAt.getTime()).sort((a, b) => b - a),
    )
  })

  it('leaves out anything older than twelve hours', async () => {
    // Ada drank at 09:00 and 10:00 and 14:00 Oslo; NOW is 15:00, so the
    // twelve-hour window holds all of today and none of the 25th.
    const feed = await getTeamActivity(db, { now: NOW })

    expect(feed.every((event) => event.consumedAt >= new Date(NOW.getTime() - 12 * 3_600_000))).toBe(
      true,
    )
    expect(feed).toHaveLength(3)
  })

  it('still shows last night after midnight, when the local date has rolled over', async () => {
    // 02:30 Oslo on the 26th. A drink at 23:00 Oslo on the 25th is three and a
    // half hours ago but sits on yesterday's local_date, which is the whole
    // reason the query spans two dates.
    const afterMidnight = new Date('2026-08-26T00:30:00Z')
    await logDrink(db, {
      userId: 'bo',
      slug: 'coffee',
      now: new Date('2026-08-25T21:00:00Z'),
    })

    const feed = await getTeamActivity(db, { now: afterMidnight })

    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ displayName: 'Bo', drinkName: 'Coffee' })
  })

  it('never shows a drink from the future, so a backdated now cannot leak ahead', async () => {
    const feed = await getTeamActivity(db, { now: new Date('2026-08-26T00:30:00Z') })

    expect(feed.every((event) => event.consumedAt <= new Date('2026-08-26T00:30:00Z'))).toBe(true)
  })

  it('respects the limit', async () => {
    expect(await getTeamActivity(db, { now: NOW, limit: 2 })).toHaveLength(2)
  })

  it('never shows alcohol, whoever is asking', async () => {
    await db.insert(alcoholDrinkTypes).values(ALCOHOL_TYPE_SEEDS)
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: oslo('2026-08-26', 14) })

    const feed = await getTeamActivity(db, { now: NOW })

    expect(feed).toHaveLength(3)
    expect(feed.some((event) => event.drinkName.toLowerCase().includes('beer'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run src/server/stats.test.ts -t getTeamActivity
```

Expected: FAIL — `getTeamActivity is not a function`.

- [ ] **Step 3: Add `desc` to the drizzle imports**

The first line of `src/server/stats.ts` currently reads:

```ts
import { and, asc, count, eq, gte, lte, min, sql } from 'drizzle-orm'
```

Change it to:

```ts
import { and, asc, count, desc, eq, gte, lte, min, sql } from 'drizzle-orm'
```

- [ ] **Step 4: Implement the query**

Append to `src/server/stats.ts`, after `getTeamIntakeEvents`:

```ts
/** One drink, as the ticker shows it: who, what, and when. */
export type TeamActivityEvent = {
  id: number
  userId: string
  displayName: string
  drinkName: string
  caffeineMg: number
  volumeMl: number | null
  consumedAt: Date
}

/** How far back the feed looks. Long enough to cover a working day. */
const ACTIVITY_WINDOW_MS = 12 * 60 * 60 * 1000

/**
 * The team's most recent drinks.
 *
 * Deliberately reads `drink_logs` and never `alcohol_logs`. Party mode is
 * opt-in and per member, and the viewer having it switched on is not the same
 * as the person in the feed having agreed to appear in one. Caffeine is already
 * team-visible on the leaderboard, so this discloses nothing new; alcohol would
 * disclose something a member entered only for themselves.
 *
 * Bounded by `local_date` across two days rather than by `consumed_at` alone,
 * so `drink_logs_date_idx` serves it and the scan stays flat as history grows.
 * Two dates because midnight should not empty the feed: a drink at eleven last
 * night is still recent at half past midnight, and it carries yesterday's date.
 *
 * The upper bound on `consumed_at` matters as much as the lower one. A drink
 * can be logged for an earlier time, and without it a fixture — or a clock
 * skew — could put something in the feed that has not happened yet.
 */
export async function getTeamActivity(
  db: AnyDb,
  { now = new Date(), limit = 15 }: { now?: Date; limit?: number } = {},
): Promise<TeamActivityEvent[]> {
  const today = localDateOf(now)
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_MS)

  return db
    .select({
      id: drinkLogs.id,
      userId: drinkLogs.userId,
      displayName: members.displayName,
      drinkName: drinkTypes.name,
      caffeineMg: drinkLogs.caffeineMg,
      volumeMl: drinkLogs.volumeMl,
      consumedAt: drinkLogs.consumedAt,
    })
    .from(drinkLogs)
    .innerJoin(members, eq(members.userId, drinkLogs.userId))
    .innerJoin(drinkTypes, eq(drinkTypes.id, drinkLogs.drinkTypeId))
    .where(
      and(
        gte(drinkLogs.localDate, addLocalDays(today, -1)),
        lte(drinkLogs.localDate, today),
        gte(drinkLogs.consumedAt, since),
        lte(drinkLogs.consumedAt, now),
      ),
    )
    .orderBy(desc(drinkLogs.consumedAt))
    .limit(limit)
}
```

`addLocalDays`, `localDateOf`, `members` and `drinkTypes` are all already
imported at the top of this file — check before adding anything. The feed shows
names, not avatars, so there is no join to `users` and no `image` column.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
npx vitest run src/server/stats.test.ts
```

Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 6: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/stats.ts src/server/stats.test.ts
git commit -m "Add getTeamActivity, bounded to two local dates and twelve hours"
```

---

### Task 3: The ticker on the team page

**Files:**
- Create: `src/components/TeamTicker.tsx`
- Modify: `src/app/(app)/team/page.tsx`
- Modify: `src/lib/patch-notes.ts`

**Interfaces:**
- Consumes: `formatAgo` from Task 1; `getTeamActivity` and `TeamActivityEvent`
  from Task 2.
- Produces: `<TeamTicker events={...} now={...} />`

- [ ] **Step 1: Write the component**

Create `src/components/TeamTicker.tsx`. A server component — it takes `now` as a
prop rather than reading the clock, so every row is labelled against the same
instant the rest of the page was built from.

```tsx
import { formatAgo } from '@/lib/format'
import type { TeamActivityEvent } from '@/server/stats'

/**
 * Who logged what, recently.
 *
 * A server component with no state: freshness comes from `LiveRefresh`, which
 * the team page already mounts and which re-renders this along with everything
 * else. A client-side ticking clock would cost a timer per row to say the same
 * thing thirty seconds sooner.
 *
 * Caffeine only, by construction — `getTeamActivity` does not read the alcohol
 * table, and that is a privacy decision rather than an oversight.
 */
export function TeamTicker({ events, now }: { events: TeamActivityEvent[]; now: Date }) {
  if (events.length === 0) return null

  return (
    <section className="panel space-y-3 p-4" aria-labelledby="ticker-heading">
      <p className="legend" id="ticker-heading">
        Just now
      </p>

      <ul className="divide-y divide-hairline">
        {events.map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5">
            <span className="min-w-0 flex-1 text-sm text-foam">
              <span className="text-oat">{event.displayName}</span> · {event.drinkName}
              {event.volumeMl && <span className="text-oat"> · {event.volumeMl} ml</span>}
            </span>
            <span className="font-gauge text-xs whitespace-nowrap text-oat">
              {formatAgo(event.consumedAt, now)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Wire it into the team page**

In `src/app/(app)/team/page.tsx`:

Add to the imports:

```tsx
import { TeamTicker } from '@/components/TeamTicker'
```

Add `getTeamActivity` to the existing `@/server/stats` import.

Change the `Promise.all` block from:

```tsx
  const [series, hours, split, intake] = await Promise.all([
    getTeamTimeSeries(db, period),
    getTeamHourHistogram(db, period),
    getTeamSplit(db, period),
    getTeamIntakeEvents(db, { from: lookback, now }),
  ])
```

to:

```tsx
  const [series, hours, split, intake, activity] = await Promise.all([
    getTeamTimeSeries(db, period),
    getTeamHourHistogram(db, period),
    getTeamSplit(db, period),
    getTeamIntakeEvents(db, { from: lookback, now }),
    // Ignores the period tabs, like the bloodstream chart below: "who just had
    // a coffee" is a right-now question and there is no such thing as the
    // office's recent activity "this month".
    getTeamActivity(db, { now }),
  ])
```

Render it directly below the three `StatTile`s — after the closing `</div>` of
the `grid grid-cols-2 gap-3 sm:grid-cols-3` block and before the
`{hasData ? (` line:

```tsx
      <TeamTicker events={activity} now={now} />
```

It goes above the charts because it is the part of the page that changes
minute to minute, and outside the `hasData` branch because it has its own empty
check — the period could be empty while the last twelve hours are not.

- [ ] **Step 3: Add the patch note**

In `src/lib/patch-notes.ts`, add a new entry at the top of the `PATCH_NOTES`
array, above the `2026-08-28` one. Written for the people using Buzz, which is
what the file's own doc comment asks for:

```ts
  {
    id: '2026-08-29',
    title: 'Who just had a coffee',
    items: [
      'The Everyone page now shows what the office has been drinking in the last twelve hours, newest first. It keeps showing last night after midnight, because the working day and the calendar day are not the same thing.',
      'It is caffeine only. Party mode is yours, and switching it on does not put your Friday into a feed everyone reads.',
    ],
  },
```

- [ ] **Step 4: Run the whole suite, typecheck, lint and build**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all green. The build runs on placeholder credentials, as CI does.

- [ ] **Step 5: Check it in the browser**

```bash
npm run dev
```

Open `http://localhost:3000/team`. Log a drink from the dashboard, come back,
and confirm it is at the top of the feed with "just now" beside it. Then confirm
the section is absent entirely against a database with nothing logged in the
last twelve hours — the quickest way is to move the fixture clock rather than to
wait, so check that `TeamTicker` returns `null` for an empty `events` array.

- [ ] **Step 6: Commit**

```bash
git add src/components/TeamTicker.tsx "src/app/(app)/team/page.tsx" src/lib/patch-notes.ts
git commit -m "Show recent team drinks on the Everyone page"
```

---

## Done when

- `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` are green.
- `/team` shows a feed of recent drinks that updates as `LiveRefresh` fires.
- `git diff main --stat` shows no change to `src/db/schema.ts`, so the `schema`
  CI check passes without a migration.
- A beer logged in party mode does not appear in the feed.
