## What changed

<!-- One paragraph. Written for the next agent to read this file, not for a
     human reviewer — there isn't one. -->

## Why

<!-- The reason the change exists. If it came from an issue, link it. -->

## How it was verified

<!-- CI runs lint, typecheck, the schema check, the tests and a build. Say what
     you did beyond that: which tests you added, and what you exercised by hand. -->

- [ ] `npm test` passes locally
- [ ] `npm run typecheck` and `npm run lint` pass locally
- [ ] Behavioural changes have tests that fail without the change
- [ ] Schema changes include the generated migration, and it is safe against the currently deployed code
- [ ] Read `AGENTS.md` and the relevant guide under `node_modules/next/dist/docs/`

## Decisions this touches

<!-- Delete the ones it doesn't. If you're changing one of these on purpose,
     say so and say why — see the README. -->

- [ ] Membership is the access grant
- [ ] `drink_logs.caffeine_mg` is a snapshot, not a join
- [ ] Local dates are computed at write time
- [ ] `daily_totals` is a rollup, and `stats.ts` hides it
- [ ] Alcohol is a parallel path, not a drink category
- [ ] None of them
