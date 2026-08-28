# Buzz

A caffeine tracker for the Fleks team. Log every coffee and energy drink in one
tap, then argue about the leaderboard.

Getting it running takes about 25 minutes and costs nothing — see
**[SETUP.md](SETUP.md)**.

## What it does

- **One-tap logging.** A button per drink, an undo for mistaps, optimistic
  updates so the number moves the instant you press it.
- **A buzz meter.** Today's caffeine on an espresso-machine pressure gauge. The
  needle's tremor scales with how close you are to the 400 mg daily reference,
  so the shake is a second reading of the same number.
- **Personal stats.** Caffeine, drinks, rank and streak, by day / week / month /
  all time, with a chart of your intake over time.
- **A leaderboard.** Who's running the place, per period, with ties sharing a rank.
- **Team charts.** Combined intake over time, which hour the office
  actually peaks, and coffee against energy drinks.
- **Editable drink types.** Admins can tune caffeine estimates or add drinks.
  Edits apply to new logs only — history never moves.
- **Party mode.** Off by default, and a button on the dashboard switches it on.
  Alcohol then gets the same treatment caffeine does — one-tap logging, a gauge,
  a curve, an editable list and its own leaderboard — modelled with Widmark
  rather than a half-life, because alcohol clears at a constant rate rather than
  an exponential one. It never enters a caffeine statistic.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Auth.js with Google ·
Drizzle ORM · Turso (libSQL) · Recharts · Vitest. Deploys to Vercel.

## Commands

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 (the Google redirect URI depends on it) |
| `npm test` | Unit and integration tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Insert the starting drink types (idempotent) |
| `npm run db:studio` | Browse the database |
| `npm run db:rebuild-rollup` | Check `daily_totals` against `drink_logs`, then rebuild |

## How it's put together

```
src/
  lib/time.ts        Europe/Oslo bucketing, periods, DST handling
  lib/caffeine.ts    EFSA reference values and limit states
  lib/alcohol.ts     Grams from volume and ABV, units, the 0.2‰ limit
  lib/blood-alcohol.ts  Widmark, simulated: zero-order elimination
  db/schema.ts       Drizzle tables and migrations
  db/rollup.ts       daily_totals rebuild and drift check
  server/auth.ts     Auth.js config, requireMember / requireAdmin
  server/membership.ts  Join-code verification and rate limiting
  server/drinks.ts   Logging and undo
  server/stats.ts    Every statistic the UI reads
  server/alcohol.ts  Party mode, deliberately without a rollup
  app/(app)/         The signed-in pages
  components/        UI, including the buzz meter and charts
```

Five decisions worth knowing before you change anything:

**Membership is the access grant.** A signed-in Google account with no row in
`members` hasn't entered the team code yet, so "is this person allowed in?" is
one predicate in `requireMember()` rather than a check scattered across routes.

**`drink_logs.caffeine_mg` is a snapshot, not a join.** Drink types are
editable. Joining to get caffeine would silently rewrite history the moment
someone tuned coffee from 95 mg to 100 mg.

**Local dates are computed at write time.** SQLite has no timezone database, so
every log stores `local_date` and `local_hour` resolved in Europe/Oslo by
`lib/time.ts`. Daylight saving is decided once, in a tested pure function,
instead of in every aggregate query. Both Oslo transitions have tests.

**`daily_totals` is a rollup, and `stats.ts` hides it.** Turso bills rows
scanned, so day-or-coarser questions read one row per person per day instead of
every drink ever logged. `drink_logs` stays authoritative;
`npm run db:rebuild-rollup` regenerates the rollup and reports any drift.

**Alcohol is a parallel path, not a drink category.** Sharing `drink_logs` would
put a beer into every aggregate in `stats.ts` as a zero-milligram row — the
drink count, the rank, the streak, the category split. Two tables that never
meet is cheaper than a filter on every query. There is no `daily_totals`
equivalent either, and the price of that is paid in the UI rather than hidden:
**party mode has no all-time period**, because an open-ended range without a
rollup is the one query that would grow without bound. `PartyPeriod` excludes it
at the type level.

## Tests

```bash
npm test
```

430 tests. The ones that matter most:

- `lib/time.test.ts` — both Oslo DST transitions, and the nightly window where
  the UTC date and the Oslo date disagree.
- `server/stats.test.ts` — every aggregate against seeded fixtures.
- `server/drinks.test.ts` — the caffeine snapshot, undo authorization, and that
  the rollup never drifts from the logs.
- `lib/blood-alcohol.test.ts` — that elimination is linear and stops at exactly
  zero, that superposition therefore does *not* hold, and that the curve reads
  the same at an instant however early its window starts.
- `server/alcohol.test.ts` — that logging, editing, undoing and deleting a drink
  leave `drink_logs` and `daily_totals` byte-for-byte unchanged.

Integration tests run against real libSQL database files, so they exercise the
same engine as production with no container and no network. They use files
rather than `:memory:` deliberately: `@libsql/client` opens a separate
connection for a transaction, and a second connection to `:memory:` is a
different, empty database.

## A note on the 400 mg figure

400 mg per day and 200 mg in a single dose come from
[EFSA's 2015 opinion on caffeine](https://www.efsa.europa.eu/en/efsajournal/pub/4102).
They're population guidelines for healthy adults, not personal medical advice,
and the per-drink milligram values are estimates rather than measurements. The
app says so where it shows them, and the warning copy is deliberately factual
rather than nagging.
