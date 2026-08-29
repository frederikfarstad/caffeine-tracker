# Live ticker, achievements, monthly wrapped

Three features, built in that order. They are independent enough to ship
separately and are specified together because the third one reads the second.

## Why this order

Nothing here has a deadline, so the order is smallest-first: the ticker changes
no schema and adds no concepts, achievements add a table and the rules that
govern it, and wrapped goes last because it is the only one with a dependency.
Built after badges exist, it gets them for free.

## Constraints that apply to all three

**Migrations must be safe against the currently deployed code.** Vercel and
GitHub Actions do not wait for each other, so for a minute around a merge the
old revision runs against the new schema. Every change here is additive — one
new table and one nullable column — and neither is read by code that predates
it.

**Derived data is rebuildable or it does not exist.** `daily_totals` earns its
place by being reconstructible from `drink_logs` at any time, with a script that
reports drift. `earned_badges` is held to the same standard, and that constraint
shapes what a badge is allowed to be.

**Alcohol stays a parallel path.** Nothing here reads `alcohol_logs`, and the
one place it is tempting — the ticker — is where it is most firmly excluded.
See below.

**Every new pure function is tested; every new server module gets an
integration test against a real libSQL file**, matching what is already here.

---

## 1. Live ticker

### The point

The team page charts what the office is carrying. It does not say who just did
what. A short feed of recent drinks is presence rather than analysis, and it is
one query.

### Scope: caffeine only

The ticker reads `drink_logs` and never `alcohol_logs`. Party mode is opt-in
and per-member, and a viewer having it switched on is not the same as the
subject having agreed to appear in a feed. Caffeine is already team-visible on
the leaderboard, so a caffeine ticker discloses nothing new; an alcohol ticker
would disclose something a member entered only for themselves.

This belongs in a comment in the query, next to the schema's existing argument
for why alcohol is a parallel path.

### Data

No schema change. `getTeamActivity(db, { now, limit })` in `server/stats.ts`,
joining `drink_logs` to `members` and `drink_types`, ordered by `consumed_at`
descending.

Bounded by `local_date IN (today, yesterday)` so `drink_logs_date_idx` serves it
and the scan does not grow with history, then filtered to the last twelve hours
and limited to fifteen rows. Two local dates rather than one because midnight
should not empty the feed.

Undone drinks are deleted rows, so they leave the ticker by themselves.

### Display

On `/team`: display name, what they logged, and how long ago. Relative times are
computed on the server from the page's single `now` and refreshed by the
existing `LiveRefresh`, which avoids both a hydration mismatch and a clock that
only moves when you reload.

`formatAgo` joins `lib/format.ts`, with tests.

### Files

| File | What |
|---|---|
| `src/server/stats.ts` | `getTeamActivity`, `TeamActivityEvent` |
| `src/server/stats.test.ts` | Ordering, the two-date bound, the twelve-hour filter |
| `src/lib/format.ts` | `formatAgo` |
| `src/lib/format.test.ts` | Boundaries: just now, a minute, an hour |
| `src/components/TeamTicker.tsx` | The feed |
| `src/app/(app)/team/page.tsx` | Wiring |

---

## 2. Achievements

### The point

Badges give the leaderboard something to argue about that is not a milligram
total, and they reward shapes of behaviour a single number cannot show — being
early, being consistent, being adventurous.

### The invariant that shapes everything

**Every badge must be a pure function of the log tables.** Not of when the code
happened to run, not of a counter incremented at the time. This is what makes
`earned_badges` rebuildable, which is the same standard `daily_totals` is held
to, and it rules out any badge of the form "was online when X happened".

### Data

```
earned_badges
  user_id    text     FK -> user.id, cascade
  badge_id   text     the slug from lib/badges.ts
  earned_at  integer  timestamp_ms
  PRIMARY KEY (user_id, badge_id)
  INDEX (badge_id)   -- "who has this one"
```

Derived data. `npm run db:rebuild-badges` replays the predicates over the logs,
reports drift and rewrites the table, mirroring `db:rebuild-rollup`.

### Awarding

Evaluated inside the same transaction as the rollup update in
`server/drinks.ts`, from a `BadgeContext` assembled once per write: the member's
lifetime totals and streak from `daily_totals`, today's logs, and their distinct
drink types. One extra query on the logging path.

That cost is real and worth naming, because one-tap logging is the thing this
app is proudest of. The alternative — evaluating lazily when a dashboard renders
— is cheaper on write but makes "earned" mean "next time you happened to look",
and it gives the drift check nothing to check against.

`pioneer` is the exception, and the only badge awarded to somebody other than
the member who triggered the evaluation: it goes to the drink type's author when
a *different* member logs it. No extra query — `drink_types.created_by` arrives
on the row already being read to snapshot the caffeine figure — but the award
step takes a target user id rather than assuming the logger, and the tests say
so.

### The badges

| Slug | Earned by |
|---|---|
| `first-drop` | Your first drink |
| `century` | 100 drinks |
| `half-k` | 500 drinks |
| `dawn-patrol` | A drink before 07:00 |
| `night-shift` | A drink after 22:00 |
| `week-straight` | A 7-day streak |
| `month-straight` | A 30-day streak |
| `connoisseur` | 10 distinct drink types |
| `four-shots` | Four or more drinks in one day |
| `pioneer` | A drink type you added, logged by somebody else |
| `clean-sweep` | Every day of a calendar month |

**Deliberately absent: any badge for a large dose or a day over the 400 mg
reference.** The README commits to warning copy that is factual rather than
nagging; a badge is the opposite of that, and turning the one number the app
gives health guidance about into a prize would undo it.

### Display

Team-visible. On the leaderboard, up to three badges beside each name with a
count for the rest. On the dashboard, a section listing what you have earned,
with unearned count-based badges showing `have / need` — that fraction is free
for counting badges and is the part that makes them worth chasing.

### Files

| File | What |
|---|---|
| `src/lib/badges.ts` | `BADGES`, `BadgeContext`, predicates, `progressOf` — pure |
| `src/lib/badges.test.ts` | Each predicate at its boundary |
| `src/db/schema.ts` | `earnedBadges` |
| `src/db/migrations/0007_*.sql` | Generated |
| `src/server/badges.ts` | `contextFor`, `awardNewBadges`, `getBadgesFor`, `getBadgesForMany` |
| `src/server/badges.test.ts` | That awarding is idempotent and that a rebuild reproduces it exactly |
| `src/db/rebuild-badges.ts` | Drift check and rebuild |
| `src/server/drinks.ts` | Awarding inside the existing transaction |
| `src/components/BadgeList.tsx` | Earned and unearned |
| `src/app/(app)/leaderboard/page.tsx` | Badges beside names |

---

## 3. Monthly wrapped

### The point

A month is long enough to have a shape and short enough to still remember. The
leaderboard says who won; a wrapped says what your month was like.

### Data

No new table. It reads `daily_totals` for the month — which is what the rollup
is for — plus `drink_logs` bounded to the month for hour-of-day and favourite
drink, plus badges earned in the month.

One new column, mirroring `last_seen_patch_note` exactly:

```
members.last_seen_wrapped  text  nullable  -- 'YYYY-MM'
```

### How it reaches people

**A dialog on the first visit of a new month, and a permanent page.** The dialog
reuses the `PatchNotesDialog` pattern: decided on the server so it is either in
the markup or it is not, shown once, dismissal writes the marker.

It fires when the current month is later than `last_seen_wrapped` **and the
previous month has data for that member**. Somebody who joined last week does
not get an empty celebration of a month they were not here for.

`/wrapped` shows the last completed month; `/wrapped?month=2026-07` shows a
named one, so a dismissed wrapped is still there to settle an argument with.

**No nav pill.** The layout already carries a comment explaining that a fifth
pill wraps the bar to two rows on a phone, and that reasoning has not changed.
It is linked from the dashboard and from the dialog.

### What it says

Your total, your drinks, your rank for the month. Your most-logged drink. Your
biggest day. The hour you are most predictable. Your longest streak inside the
month. Badges earned. One team line — the office total, and your share of it.

Nothing per-colleague beyond what the leaderboard already shows.

### Files

| File | What |
|---|---|
| `src/lib/wrapped.ts` | `MonthKey` helpers, `previousMonth`, shaping — pure |
| `src/lib/wrapped.test.ts` | Month arithmetic across a year boundary |
| `src/db/schema.ts` | `members.lastSeenWrapped` |
| `src/db/migrations/0008_*.sql` | Generated |
| `src/server/wrapped.ts` | `getWrapped(db, userId, month)`, `markWrappedSeen` |
| `src/server/wrapped.test.ts` | The mid-month joiner, and a month with no data |
| `src/app/(app)/wrapped/page.tsx` | The permanent page |
| `src/components/WrappedDialog.tsx` | The once-a-month dialog |
| `src/app/(app)/layout.tsx` | Firing it, beside the patch notes dialog |

---

## Shipping

Each feature ships with a `PATCH_NOTES` entry in `lib/patch-notes.ts`, in the
same commit as the code, written for the people using Buzz rather than for the
commit log — the file's own instruction.

The README's "How it's put together" list gains `lib/badges.ts` and
`lib/wrapped.ts`, and its decisions section gains one entry: that a badge is a
pure function of the logs, which is what keeps `earned_badges` rebuildable.

All four checks stay green: `lint`, `typecheck`, `test`, and the `schema` check
that refuses a change to `schema.ts` without a committed migration.

Three features means three implementation plans, not one. Each is a separate
branch and a separate pull request, in the order at the top of this document —
a single plan spanning a new table and a new column would be a diff nobody can
review, and the repository's own contribution rules assume a reviewable one.
