# Contributing to Buzz

Buzz is written by agents. Humans decide what gets built; machines do the
building. If you are a human reading this, your job is to point and to veto —
not to type.

## The rule

**Everything here is vibe-coded, to the highest degree — and it has to be
good.**

Those halves only sound like they're in tension. Vibe-coding to the highest
degree means you describe the outcome and let the agent write the code: no
hand-typed diffs, no "I'll just fix this one line myself", no patch assembled by
a human who got impatient. Quality means the result is indistinguishable from
code someone would defend in a review — because the checks that would have
caught a sloppy human catch a sloppy agent just the same, and because nothing
about generating code quickly excuses generating it badly.

Where the two genuinely pull against each other, quality wins. An agent that
cannot produce a change that passes the gates has not produced the change.

### To the highest degree

- **Specify, don't type.** State the behaviour you want, the constraint it has
  to respect, and how you'll know it works. Let the agent get there.
- **Read the source of truth, not your training data.** `AGENTS.md` is not
  decoration: this is not the Next.js you know. The relevant guide under
  `node_modules/next/dist/docs/` is authoritative and your priors are not.
  Read it before writing code that touches the framework.
- **Iterate against the checks, not against a hunch.** `npm test` runs 439
  tests in under two seconds. There is no excuse for guessing.
- **One concern per pull request.** A pull request that does two things cannot
  be reverted for one of them.

### With quality

- **Every behavioural change ships with a test that fails without it.** Not a
  test that passes; a test that would have caught the bug.
- **Match the code around you.** Same naming, same comment density, same
  register. Comments explain *why* — the code already says what. Read a
  neighbouring file before you write a new one.
- **Leave the five decisions in the README alone unless you're changing one on
  purpose.** They are load-bearing, each has a stated reason, and each is the
  kind of thing an agent will cheerfully "simplify" into a bug. Membership as
  the access grant. `caffeine_mg` as a snapshot rather than a join. Local dates
  resolved at write time. `daily_totals` as a rollup that `stats.ts` hides.
  Alcohol as a parallel path that never enters a caffeine statistic. If you are
  changing one, say so in the pull request and say why.
- **No new dependency without a reason in the pull request body.**
- **Don't commit generated noise.** One exception, and it's in `AGENTS.md`: the
  block `next dev` writes into that file belongs in your commit, because
  removing it only re-creates the change.

## Nobody is going to read your pull request

Do not write the description for a human reviewer. There isn't one, and there
isn't going to be one. Write it for the next agent that opens this file in six
months trying to work out why the code does what it does.

What reads your pull request instead:

- **CI**, on every push. Five required checks, all of which have to be green.
  They are the review. They do not get tired, they do not skim, and they do not
  approve something because it's Friday.
- **An agent reviewer**, if the repository has an `ANTHROPIC_API_KEY` secret. It
  reads the diff against this file, `AGENTS.md` and the README's decisions, and
  leaves line comments. Its verdict is advisory; the checks are the gate.

The corollary is that the gates have to be strict enough to stand in for
judgement, so they are. If you think a check is wrong, change the check in its
own pull request and argue the case there. Do not route around it.

## Humans still dictate

We are meatproxies to the agents in this repository. We are also the ones
holding the levers, and the levers are real:

- **Direction, scope and taste are ours.** What gets built, what doesn't, and
  what "good" means here are not up for agentic negotiation. This file is one
  of those decisions.
- **A human presses Merge.** Always. Auto-merge is disabled, so a pull request
  with five green checks sits there until someone decides it should exist.
  Passing the checks earns you the right to be considered, nothing more.
- **An unresolved comment thread blocks the merge.** That is the veto. One
  human comment on one line stops a pull request dead, no matter how green it
  is. Agents are expected to answer the comment and resolve the thread, not
  wait it out.
- **Admins can bypass the protections.** Deliberately. When the building is on
  fire, a human gets to push.
- **`main` is protected and stays protected.** No direct pushes, no force
  pushes, no deletion, linear history only.

## Opening a pull request

```bash
git switch -c feat/the-thing
```

Do the work. Then, before you push:

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

If you touched `src/db/schema.ts`:

```bash
npm run db:generate
```

Commit the generated migration alongside the schema change. CI fails if the two
disagree, because the test suite migrates from `src/db/migrations` and would
otherwise pass on a schema that production has never seen.

Then push and open the pull request:

```bash
gh pr create --fill
```

Then stop. Do not merge it, and do not turn on auto-merge — it is disabled on
this repository. Green checks make a pull request *mergeable*; they do not make
it *merged*. A human reads the title, decides the change should exist, and
presses the button. That is the whole of the human's job here, and it is not a
formality: it is the only point at which anything reaches `main`.

## Database changes

The `Deploy` workflow owns the production database. On every push to `main` it
re-runs the full check suite, and only then applies migrations and seeds the
starting drink types. Both are no-ops when there is nothing to do: the migrator
applies only migrations the target is missing, and the seed uses
`onConflictDoNothing`, so caffeine values tuned by hand in production survive
every deploy.

One constraint follows from how this is wired, and it is not optional:

**Migrations must be safe against the currently deployed code.** Vercel deploys
the new revision from its own git integration, concurrently with the migration
job — neither waits for the other. So for a window of a minute or two, the old
code runs against the new schema and the new code runs against the old one.
Additive migrations are fine. Dropping or renaming a column in the same pull
request that stops using it is not; split it across two deploys.

Nothing about the database is needed to run the tests. Integration tests build
their own libSQL database files from the committed migrations, which is why CI
needs no secrets and why a fork can run the whole suite.

## Setting the repository up

For a maintainer wiring this up on a fresh clone or a fresh fork:

**Branch protection.** Run it once; it is idempotent.

```bash
./scripts/protect-main.sh
```

**Secrets.** Whatever the app has in Vercel, GitHub Actions cannot see: the two
are separate stores, and the deploy workflow reads GitHub's. Exactly two values
have to exist on both sides, because the migration job is the only thing here
that touches the database:

```bash
gh secret set TURSO_DATABASE_URL --env Production
gh secret set TURSO_AUTH_TOKEN --env Production
```

The environment rather than the repository, so nothing but a push to `main` can
reach them. `Production` is the environment Vercel's integration already
created; the workflow says `production` and GitHub matches the name
case-insensitively.

The other variables — `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
`TEAM_JOIN_CODE`, `ADMIN_EMAILS` — stay in Vercel alone. CI builds on
placeholders and never needs the real ones. [SETUP.md](SETUP.md) says where the
Turso values come from if you no longer have them.

Optionally add `ANTHROPIC_API_KEY` as a repository secret to switch on the
agent reviewer.

## The checks

| Check | What it runs | Why it can fail you |
|---|---|---|
| `quality` | `npm run lint`, `npm run typecheck` | Lint errors, type errors |
| `test` | `npm test` | Any of 439 tests |
| `schema` | `npm run db:generate`, then a diff | `src/db/schema.ts` changed with no migration committed |
| `build` | `npm run build` | Prerender failures, which the tests cannot see |
| `verify` | All of the above, again, on `main` | A squash merge creates a commit no pull request ever tested |

The `build` check runs with placeholder credentials. If a change makes the
build need a real secret, that is the change to reconsider — not the check.
