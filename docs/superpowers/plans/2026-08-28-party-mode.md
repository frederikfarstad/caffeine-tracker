# Party Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in alcohol tracking to the personal dashboard — one-tap logging, a Widmark blood-alcohol curve and a gauge — without touching any caffeine statistic, and rename the team throughout to Fleks.

**Architecture:** Two new pure modules (`lib/alcohol.ts` for dose arithmetic, `lib/blood-alcohol.ts` for the zero-order elimination model), two new tables with no rollup, a `server/alcohol.ts` mirroring `server/drinks.ts`, and a dashboard section gated on a new `members.party_mode` boolean. Nothing existing changes behaviour; the caffeine path is only read, never modified.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM on libSQL/Turso, Recharts, Vitest, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-08-28-party-mode-design.md`

## Global Constraints

- **Read the Next.js guide before writing any page or action code.** `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`. This version uses `refresh()` from `next/cache` after a mutation, **not** `revalidatePath`. Follow `src/app/(app)/actions.ts` exactly.
- **Never touch `drink_logs`, `daily_totals`, or anything in `server/stats.ts`.** Alcohol is a parallel path. Any test that writes an alcohol log must assert those tables are unchanged.
- **Timezone:** every alcohol log resolves `local_date` / `local_hour` through `localBuckets()` from `@/lib/time` at write time. Never compute a date in SQL.
- **Snapshots, not joins:** `alcohol_logs.alcohol_grams`, `.category`, `.volume_ml` are copied from the type at log time.
- **Team name is `Fleks`** — that exact spelling, capital F, everywhere. Never "Flex", and never either of the two previous team names.
- **Reference figures:** elimination `0.15` permille/hour; absorption half-life `12` minutes; ethanol density `0.789` g/ml; Norwegian driving limit `0.2` permille; fallback body `80` kg and Widmark ratio `0.615`; male `0.68`, female `0.55`; one Norwegian standard unit `12.8` g.
- **Commit after every task.** Run `npm test`, `npm run typecheck` and `npm run lint` before each commit; all three must pass.
- **House voice:** every non-obvious decision gets a comment explaining *why*, in the register of the existing files. No comment that restates the code.

---

### Task 1: Rename the team to Fleks

Independent of everything else and ships on its own. Do it first so the rename is not tangled with feature review.

**Files:**
- Modify: `src/app/(app)/layout.tsx:36-42`
- Modify: `src/app/layout.tsx:33-35`
- Modify: `src/app/manifest.ts:9-13`
- Modify: `src/app/signin/page.tsx:17,22`
- Modify: `src/app/privacy/page.tsx:17`
- Modify: `src/app/(app)/team/page.tsx:61`
- Modify: `README.md:3`
- Modify: `SETUP.md:224`
- Test: `src/app/manifest.test.ts` (existing — check whether it asserts on the name)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Copy only.

- [ ] **Step 1: Find every occurrence**

```bash
grep -rn "<the two former team names>" --include="*.ts" --include="*.tsx" --include="*.md" src README.md SETUP.md
```

Expected: the eight files above. `.claude/launch.json` (`ovio-buzz-dev`) and `SETUP.md`'s `turso db create ovio-buzz` are **infrastructure names, not copy — leave both alone.** Renaming the launch config breaks the dev server; renaming the Turso database in the guide would not match the deployed one.

- [ ] **Step 2: Check the manifest test first**

Run: `npx vitest run src/app/manifest.test.ts`

If it asserts on the `name` string, update the expectation in the same commit.

- [ ] **Step 3: Header eyebrow**

In `src/app/(app)/layout.tsx`, the comment above the wordmark explains why *two* team names sit above it as an eyebrow. With one name that reasoning is dead and the comment must go, not be edited. Replace the whole commented block:

```tsx
        <Link href="/" className="block">
          <span className="legend block text-[0.5625rem] leading-none">Fleks</span>
          <span className="display text-2xl leading-none tracking-tight text-foam">
            buzz<span className="text-crema">.</span>
          </span>
        </Link>
```

- [ ] **Step 4: Metadata, manifest and the remaining copy**

`src/app/layout.tsx`:

```tsx
export const metadata: Metadata = {
  title: 'Buzz — how caffeinated is Fleks?',
  description: 'Log every coffee and energy drink, and see who is running Fleks today.',
```

`src/app/manifest.ts`:

```ts
    name: 'Buzz — how caffeinated is Fleks?',
    short_name: 'Buzz',
    description: 'Log every coffee and energy drink, and see who is running Fleks today.',
```

`src/app/signin/page.tsx`:

```tsx
        <p className="legend">Fleks · caffeine tracker</p>
```

and

```tsx
          Every cup. Every can. One leaderboard. Settle who is actually running Fleks.
```

`src/app/privacy/page.tsx`:

```tsx
          Buzz is an internal caffeine leaderboard for the Fleks team. It is not a
          commercial product and there is nothing clever going on with your data.
```

`src/app/(app)/team/page.tsx`:

```tsx
            Fleks, all of it
```

`README.md` line 3:

```markdown
A caffeine tracker for the Fleks team. Log every coffee and energy drink in one
```

`SETUP.md` line 224: replace the clause naming the two former teams with "but if Fleks treats this as a company tool".

- [ ] **Step 5: Verify nothing was missed**

```bash
grep -rn "<the two former team names>" --include="*.ts" --include="*.tsx" --include="*.md" src README.md SETUP.md
```

Expected: only `src/lib/patch-notes.ts` (a historical note about a past release — **leave it**, it records what was true then) and `SETUP.md`'s `turso db create ovio-buzz` lines.

- [ ] **Step 6: Full check and commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add -A && git commit -m "Rename the team to Fleks"
```

---

### Task 2: Alcohol dose arithmetic — `lib/alcohol.ts`

**Files:**
- Create: `src/lib/alcohol.ts`
- Test: `src/lib/alcohol.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AlcoholCategory = 'beer' | 'wine' | 'spirits' | 'cider' | 'other'`
  - `CATEGORY_LABELS: Record<AlcoholCategory, string>`
  - `ETHANOL_DENSITY_G_PER_ML: 0.789`
  - `STANDARD_UNIT_G: 12.8`
  - `DRIVING_LIMIT_PERMILLE: 0.2`
  - `HEAVY_PERMILLE: 1`
  - `SCALE_MAX_PERMILLE: 2`
  - `gramsOfAlcohol(type: { volumeMl: number; abvPercent: number }): number`
  - `unitsFrom(grams: number): number`
  - `formatUnits(grams: number): string`
  - `formatPermille(bac: number): string`
  - `type BacStatus = 'clear' | 'over-limit' | 'heavy'`
  - `bacStatus(bac: number): BacStatus`
  - `bacHeadline(bac: number): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/alcohol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DRIVING_LIMIT_PERMILLE,
  bacHeadline,
  bacStatus,
  formatPermille,
  formatUnits,
  gramsOfAlcohol,
  unitsFrom,
} from './alcohol'

describe('gramsOfAlcohol', () => {
  it('multiplies volume by strength by ethanol density', () => {
    // A half-litre at 4.7%: 500 * 0.047 * 0.789.
    expect(gramsOfAlcohol({ volumeMl: 500, abvPercent: 4.7 })).toBeCloseTo(18.54, 2)
  })

  it('gives a glass of wine and a spirit measure roughly one unit each', () => {
    expect(gramsOfAlcohol({ volumeMl: 150, abvPercent: 12 })).toBeCloseTo(14.2, 1)
    expect(gramsOfAlcohol({ volumeMl: 40, abvPercent: 40 })).toBeCloseTo(12.62, 2)
  })

  it('is zero for an alcohol-free drink', () => {
    expect(gramsOfAlcohol({ volumeMl: 330, abvPercent: 0 })).toBe(0)
  })
})

describe('unitsFrom', () => {
  it('counts a Norwegian standard unit as 12.8 grams', () => {
    expect(unitsFrom(12.8)).toBeCloseTo(1, 5)
    expect(unitsFrom(25.6)).toBeCloseTo(2, 5)
  })
})

describe('formatUnits', () => {
  it('shows one decimal, because half units are the whole point', () => {
    expect(formatUnits(18.54)).toBe('1.4 units')
  })

  it('says one unit in the singular', () => {
    expect(formatUnits(12.8)).toBe('1 unit')
  })

  it('says none rather than 0.0 units', () => {
    expect(formatUnits(0)).toBe('Nothing yet')
  })
})

describe('formatPermille', () => {
  it('shows two decimals, the resolution the limit is written at', () => {
    expect(formatPermille(0.42)).toBe('0.42 ‰')
    expect(formatPermille(0)).toBe('0.00 ‰')
  })
})

describe('bacStatus', () => {
  it('is clear below the driving limit', () => {
    expect(bacStatus(0.19)).toBe('clear')
  })

  it('is over the limit at exactly the limit, not just past it', () => {
    expect(bacStatus(DRIVING_LIMIT_PERMILLE)).toBe('over-limit')
  })

  it('is heavy from one permille', () => {
    expect(bacStatus(1)).toBe('heavy')
  })
})

describe('bacHeadline', () => {
  it('never tells anyone they are fine to drive', () => {
    for (const bac of [0, 0.05, 0.19, 0.2, 0.9, 1.4]) {
      expect(bacHeadline(bac).toLowerCase()).not.toMatch(/fine to drive|safe to drive|ok to drive/)
    }
  })

  it('names the legal limit once past it', () => {
    expect(bacHeadline(0.6)).toContain('0.2')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/alcohol.test.ts`
Expected: FAIL — cannot resolve `./alcohol`.

- [ ] **Step 3: Implement**

Create `src/lib/alcohol.ts`:

```ts
/**
 * Alcohol dose arithmetic and the presentation rules built on it.
 *
 * The counterpart to `caffeine.ts`, and deliberately shaped like it. Two things
 * differ. Caffeine arrives as a milligram figure somebody typed; alcohol is
 * computed from a volume and a strength, because those are what a label states
 * and a 0.5L at 4.7% is a fact where "18.5 grams" is a calculation. And the
 * reference figure is a legal limit rather than a health guideline, which makes
 * the copy's job the opposite one: EFSA's 400 mg is advice you may ignore, and
 * 0.2 permille is not.
 *
 * Sources:
 * - Vegtrafikkloven section 22: the Norwegian limit is 0.2 permille.
 *   https://lovdata.no/lov/1965-06-18-4/§22
 * - Helsedirektoratet count a standard unit ("alkoholenhet") as 12.8 g of pure
 *   alcohol, which is 1.5 cl by volume.
 *
 * Every figure the app derives from these is an estimate. The strength on a
 * bottle is rounded, the pour is not measured, and the model downstream in
 * `blood-alcohol.ts` describes an average body. The UI says so.
 */

export type AlcoholCategory = 'beer' | 'wine' | 'spirits' | 'cider' | 'other'

export const CATEGORY_LABELS: Record<AlcoholCategory, string> = {
  beer: 'Beer',
  wine: 'Wine',
  spirits: 'Spirits',
  cider: 'Cider',
  other: 'Other',
}

/** Grams per millilitre of pure ethanol at room temperature. */
export const ETHANOL_DENSITY_G_PER_ML = 0.789

/** One Norwegian standard unit, in grams of pure alcohol. */
export const STANDARD_UNIT_G = 12.8

/** The Norwegian legal driving limit, in permille. */
export const DRIVING_LIMIT_PERMILLE = 0.2

/** Where the readout stops calling it a normal evening. */
export const HEAVY_PERMILLE = 1

/** Top of the gauge. Past the point anyone should be reading a gauge. */
export const SCALE_MAX_PERMILLE = 2

/**
 * Grams of pure alcohol in a serving.
 *
 * Not rounded. At an average body one gram is about 0.02 permille — a tenth of
 * the legal limit — so rounding per drink would put visible error on the one
 * number this whole feature exists to show.
 */
export function gramsOfAlcohol({
  volumeMl,
  abvPercent,
}: {
  volumeMl: number
  abvPercent: number
}): number {
  return volumeMl * (abvPercent / 100) * ETHANOL_DENSITY_G_PER_ML
}

export function unitsFrom(grams: number): number {
  return grams / STANDARD_UNIT_G
}

/**
 * Units to one decimal.
 *
 * Beers do not come in whole units — a half-litre is 1.4 — so rounding to
 * integers would make the count disagree with the drinks visibly on the screen.
 */
export function formatUnits(grams: number): string {
  if (grams <= 0) return 'Nothing yet'

  const units = unitsFrom(grams)
  const rounded = Math.round(units * 10) / 10
  return `${rounded} ${rounded === 1 ? 'unit' : 'units'}`
}

/** Permille to two decimals, the resolution the legal limit is written at. */
export function formatPermille(bac: number): string {
  return `${bac.toFixed(2)} ‰`
}

export type BacStatus = 'clear' | 'over-limit' | 'heavy'

export function bacStatus(bac: number): BacStatus {
  if (bac >= HEAVY_PERMILLE) return 'heavy'
  if (bac >= DRIVING_LIMIT_PERMILLE) return 'over-limit'
  return 'clear'
}

/**
 * The line beside the meter.
 *
 * Colour never carries the status alone, exactly as in `caffeine.ts`. The
 * difference is what the "clear" case is allowed to say: under the limit is a
 * statement about a modelled number, not permission to drive, and this string
 * must never be readable as the latter. The estimate has no idea what you
 * actually poured.
 */
export function bacHeadline(bac: number): string {
  switch (bacStatus(bac)) {
    case 'heavy':
      return 'Well past the 0.2 ‰ limit. Estimated, and an estimate is not a breathalyser.'
    case 'over-limit':
      return 'Over the 0.2 ‰ driving limit on this estimate.'
    case 'clear':
      return 'Under 0.2 ‰ on this estimate — which is a model, not a test.'
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/alcohol.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/lib/alcohol.ts src/lib/alcohol.test.ts
git commit -m "Add alcohol dose arithmetic"
```

---

### Task 3: The blood alcohol model — `lib/blood-alcohol.ts`

The riskiest task. Alcohol is eliminated at a **constant rate** clamped at zero, not exponentially, so unlike `blood-caffeine.ts` there is no per-dose closed form to sum — the module steps a simulation forward.

**Files:**
- Create: `src/lib/blood-alcohol.ts`
- Test: `src/lib/blood-alcohol.test.ts`

**Interfaces:**
- Consumes: `SCALE_MAX_PERMILLE`, `DRIVING_LIMIT_PERMILLE` from `@/lib/alcohol` (import only what is used).
- Produces:
  - `type BodyProfile = { weightKg: number; widmarkRatio: number; personal: boolean }`
  - `DEFAULT_BODY_PROFILE: BodyProfile`
  - `bodyProfileFrom(input: { bodyWeightKg: number | null; sex: 'male' | 'female' | null }): BodyProfile`
  - `type AlcoholDose = { consumedAt: Date; grams: number }`
  - `type BacPoint = { at: number; bac: number; projected: boolean }`
  - `bacAt(doses: AlcoholDose[], instant: Date, profile?: BodyProfile): number`
  - `bloodAlcoholCurve(doses, { from, to, now, stepMs?, profile? }): BacPoint[]`
  - `soberAt(doses, { from, profile?, threshold?, stepMs?, horizonMs? }): Date | null`
  - `curveWindow(doses: AlcoholDose[], now: Date, profile?: BodyProfile): { from: Date; to: Date }`
  - `type DrivingOutlook = { kind: 'clear' } | { kind: 'clears'; at: Date } | { kind: 'not-tonight' }`
  - `drivingOutlook(doses, now, profile?): DrivingOutlook`
  - `ELIMINATION_PERMILLE_PER_HOUR`, `ABSORPTION_HALF_LIFE_MS`, `WIDMARK_RATIO`, `DEFAULT_WEIGHT_KG`, `DEFAULT_WIDMARK_RATIO`

- [ ] **Step 1: Write the failing test**

Create `src/lib/blood-alcohol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BODY_PROFILE,
  bacAt,
  bloodAlcoholCurve,
  bodyProfileFrom,
  curveWindow,
  drivingOutlook,
  soberAt,
  type AlcoholDose,
} from './blood-alcohol'

const HOUR = 3_600_000
const MINUTE = 60_000

/** 20:00 Oslo on a Friday. */
const evening = new Date('2026-08-28T18:00:00Z')

function at(hoursFromEvening: number): Date {
  return new Date(evening.getTime() + hoursFromEvening * HOUR)
}

/** One half-litre at 4.7%, near enough 18.5 g. */
const pint = (when: Date): AlcoholDose => ({ consumedAt: when, grams: 18.54 })

describe('bacAt', () => {
  it('is zero before the first drink', () => {
    expect(bacAt([pint(evening)], at(-1))).toBe(0)
  })

  it('is still near zero at the moment of drinking, because absorption takes time', () => {
    expect(bacAt([pint(evening)], evening)).toBeLessThan(0.01)
  })

  it('peaks between 30 and 45 minutes after a single drink', () => {
    const samples = []
    for (let m = 0; m <= 120; m += 1) {
      samples.push({ m, bac: bacAt([pint(evening)], new Date(evening.getTime() + m * MINUTE)) })
    }
    const peak = samples.reduce((best, s) => (s.bac > best.bac ? s : best))
    expect(peak.m).toBeGreaterThanOrEqual(30)
    expect(peak.m).toBeLessThanOrEqual(45)
  })

  it('reaches a plausible level for three pints on an average body', () => {
    const doses = [pint(evening), pint(at(0.5)), pint(at(1))]
    const bac = bacAt(doses, at(2))
    expect(bac).toBeGreaterThan(0.5)
    expect(bac).toBeLessThan(1.2)
  })
})

describe('elimination', () => {
  it('is linear once absorption is done — equal falls over equal hours', () => {
    const doses = [pint(evening), pint(at(0.25))]
    // Well past absorption, and still well above zero.
    const a = bacAt(doses, at(2))
    const b = bacAt(doses, at(3))
    const c = bacAt(doses, at(4))
    expect(a - b).toBeCloseTo(b - c, 3)
    expect(a - b).toBeCloseTo(0.15, 2)
  })

  it('reaches exactly zero and stays there, rather than decaying asymptotically', () => {
    const doses = [pint(evening)]
    const late = bacAt(doses, at(12))
    expect(late).toBe(0)
    expect(bacAt(doses, at(24))).toBe(0)
  })
})

describe('superposition', () => {
  it('does not hold — the shared clearance rate is not per-dose', () => {
    const together = bacAt([pint(evening), pint(at(1))], at(3))
    const apart =
      bacAt([pint(evening)], at(3)) + bacAt([pint(at(1))], at(3))

    // Each drink alone has already cleared to zero by then, so summing single
    // curves says "sober" while two drinks together are demonstrably not.
    expect(apart).toBe(0)
    expect(together).toBeGreaterThan(0.1)
  })
})

describe('window independence', () => {
  it('reads the same at an instant however early the window starts', () => {
    const doses = [pint(evening), pint(at(1))]
    const target = at(2)

    const early = bloodAlcoholCurve(doses, {
      from: at(-4),
      to: at(3),
      now: target,
      stepMs: 10 * MINUTE,
    })
    const late = bloodAlcoholCurve(doses, {
      from: at(1.5),
      to: at(3),
      now: target,
      stepMs: 10 * MINUTE,
    })

    const pick = (points: { at: number; bac: number }[]) =>
      points.find((p) => p.at === target.getTime())!.bac

    // Starting the window after the first drink must not invent a sober body.
    expect(pick(late)).toBeCloseTo(pick(early), 3)
    expect(pick(late)).toBeGreaterThan(0.2)
  })
})

describe('bodyProfileFrom', () => {
  it('falls back to an average adult when nothing is set, and says so', () => {
    const profile = bodyProfileFrom({ bodyWeightKg: null, sex: null })
    expect(profile).toEqual(DEFAULT_BODY_PROFILE)
    expect(profile.personal).toBe(false)
  })

  it('is personal as soon as either field is given', () => {
    expect(bodyProfileFrom({ bodyWeightKg: 62, sex: null }).personal).toBe(true)
    expect(bodyProfileFrom({ bodyWeightKg: null, sex: 'female' }).personal).toBe(true)
  })

  it('uses the conventional Widmark ratios', () => {
    expect(bodyProfileFrom({ bodyWeightKg: 80, sex: 'male' }).widmarkRatio).toBe(0.68)
    expect(bodyProfileFrom({ bodyWeightKg: 60, sex: 'female' }).widmarkRatio).toBe(0.55)
  })

  it('keeps the average ratio when only weight is known', () => {
    expect(bodyProfileFrom({ bodyWeightKg: 95, sex: null }).widmarkRatio).toBe(0.615)
  })
})

describe('the profile changes the answer', () => {
  it('gives a heavier person a lower peak on the same drinks', () => {
    const doses = [pint(evening), pint(at(0.5))]
    const light = bacAt(doses, at(1), bodyProfileFrom({ bodyWeightKg: 55, sex: 'female' }))
    const heavy = bacAt(doses, at(1), bodyProfileFrom({ bodyWeightKg: 110, sex: 'male' }))
    expect(heavy).toBeLessThan(light)
  })
})

describe('soberAt', () => {
  it('does not call someone sober while a drink is still being absorbed', () => {
    // Two minutes after the pint the blood is still near zero and rising.
    const justDrunk = new Date(evening.getTime() + 2 * MINUTE)
    const when = soberAt([pint(evening)], { from: justDrunk })
    expect(when).not.toBeNull()
    expect(when!.getTime()).toBeGreaterThan(justDrunk.getTime() + HOUR)
  })

  it('returns null rather than a fabricated time beyond the horizon', () => {
    const many = Array.from({ length: 20 }, (_, i) => pint(at(i * 0.25)))
    expect(soberAt(many, { from: evening, horizonMs: 2 * HOUR })).toBeNull()
  })

  it('finds the crossing of an arbitrary threshold', () => {
    const doses = [pint(evening), pint(at(0.5))]
    const when = soberAt(doses, { from: at(1), threshold: 0.2 })
    expect(when).not.toBeNull()
    expect(bacAt(doses, when!)).toBeLessThanOrEqual(0.2 + 0.01)
  })
})

describe('curveWindow', () => {
  it('starts just before the first drink rather than a fixed span back', () => {
    const { from } = curveWindow([pint(at(-1))], evening)
    expect(from.getTime()).toBeGreaterThan(at(-2).getTime())
    expect(from.getTime()).toBeLessThan(at(-1).getTime())
  })

  it('still gives an axis when nothing has been drunk', () => {
    const { from, to } = curveWindow([], evening)
    expect(to.getTime()).toBeGreaterThan(from.getTime())
  })
})

describe('drivingOutlook', () => {
  it('is clear when nothing has been drunk', () => {
    expect(drivingOutlook([], evening).kind).toBe('clear')
  })

  it('names a time when the evening will clear inside the window', () => {
    const outlook = drivingOutlook([pint(evening)], at(0.75))
    expect(outlook.kind).toBe('clears')
  })

  it('says not tonight rather than quoting a time off the edge of the plot', () => {
    const many = Array.from({ length: 12 }, (_, i) => pint(at(i * 0.25)))
    expect(drivingOutlook(many, at(3)).kind).toBe('not-tonight')
  })
})

describe('bloodAlcoholCurve', () => {
  it('always samples now, so the solid and dashed halves meet', () => {
    const now = at(1)
    const points = bloodAlcoholCurve([pint(evening)], { from: at(-1), to: at(4), now })
    expect(points.some((p) => p.at === now.getTime())).toBe(true)
  })

  it('marks everything after now as projected, and now itself as measured', () => {
    const now = at(1)
    const points = bloodAlcoholCurve([pint(evening)], { from: at(-1), to: at(4), now })
    expect(points.find((p) => p.at === now.getTime())!.projected).toBe(false)
    expect(points.filter((p) => p.at > now.getTime()).every((p) => p.projected)).toBe(true)
  })

  it('is sorted and stays inside the window', () => {
    const points = bloodAlcoholCurve([pint(evening)], { from: at(-1), to: at(4), now: at(1) })
    const times = points.map((p) => p.at)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(times[0]).toBe(at(-1).getTime())
    expect(times[times.length - 1]).toBe(at(4).getTime())
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/blood-alcohol.test.ts`
Expected: FAIL — cannot resolve `./blood-alcohol`.

- [ ] **Step 3: Implement**

Create `src/lib/blood-alcohol.ts`:

```ts
/**
 * How much alcohol is in your blood, and when it will be gone.
 *
 * The sibling of `blood-caffeine.ts`, and structurally not the same model.
 * Caffeine is eliminated first-order — a fixed *fraction* per unit time — which
 * makes each dose an independent exponential and lets that module sum a closed
 * form per drink. Alcohol above the first drink or so is eliminated
 * **zero-order**: the liver's enzymes are saturated, so it clears at a roughly
 * constant 0.15 permille per hour whatever the level, and stops at zero.
 *
 * That single difference removes superposition. A constant shared by all the
 * alcohol present cannot be attributed to individual doses, and the floor at
 * zero is a non-linearity no sum of per-dose curves can reproduce: two drinks
 * an hour apart are emphatically not the sum of two lone drinks. So this module
 * steps a simulation forward rather than evaluating a formula.
 *
 * Sources:
 * - Widmark, *Die theoretischen Grundlagen und die praktische Verwendbarkeit
 *   der gerichtlich-medizinischen Alkoholbestimmung* (1932) — the r ratios and
 *   the distribution formula still in forensic use.
 * - Jones, *Evidence-based survey of the elimination rates of ethanol from
 *   blood*, Forensic Sci Int 200(1-3) 2010 — 0.15 permille/hour is the usual
 *   figure; the observed range runs about 0.10 to 0.25.
 *   https://pubmed.ncbi.nlm.nih.gov/20304569/
 * - Vegtrafikkloven section 22: the Norwegian limit, 0.2 permille.
 *
 * Everything here is an estimate about a body the app barely knows. Food in the
 * stomach can double the time to peak and is not modelled; elimination varies
 * by half between people; the strength of what was actually poured is a guess.
 * This is never a breathalyser and the UI must never let it read as one.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Zero-order elimination, in permille per hour. */
export const ELIMINATION_PERMILLE_PER_HOUR = 0.15

/**
 * Absorption half-life.
 *
 * Chosen so a drink peaks 30-45 minutes after it is swallowed, which is an
 * average stomach. A full one is much slower; that is a variable the app cannot
 * ask about and does not pretend to model.
 */
export const ABSORPTION_HALF_LIFE_MS = 12 * MINUTE_MS

/** Widmark's distribution ratios: the fraction of the body that is water. */
export const WIDMARK_RATIO = { male: 0.68, female: 0.55 } as const

export const DEFAULT_WEIGHT_KG = 80

/**
 * The ratio used when sex is unknown: the midpoint of the two.
 *
 * A midpoint is wrong for everybody by about ten per cent rather than wrong for
 * half of everybody by twenty, which is the better failure for a number nobody
 * is obliged to supply.
 */
export const DEFAULT_WIDMARK_RATIO = 0.615

/**
 * The body the estimate is computed against.
 *
 * `personal` is the honest flag: false means these are population figures, and
 * the UI is required to say so rather than presenting an average as the
 * reader's own. `blood-caffeine.ts` needs no equivalent because milligrams in
 * the body do not depend on the body — permille does.
 */
export type BodyProfile = {
  weightKg: number
  widmarkRatio: number
  personal: boolean
}

export const DEFAULT_BODY_PROFILE: BodyProfile = {
  weightKg: DEFAULT_WEIGHT_KG,
  widmarkRatio: DEFAULT_WIDMARK_RATIO,
  personal: false,
}

/** Build a profile from whatever the member chose to tell us, if anything. */
export function bodyProfileFrom({
  bodyWeightKg,
  sex,
}: {
  bodyWeightKg: number | null
  sex: 'male' | 'female' | null
}): BodyProfile {
  if (bodyWeightKg === null && sex === null) return DEFAULT_BODY_PROFILE

  return {
    weightKg: bodyWeightKg ?? DEFAULT_WEIGHT_KG,
    widmarkRatio: sex ? WIDMARK_RATIO[sex] : DEFAULT_WIDMARK_RATIO,
    personal: true,
  }
}

/** One drink's worth of pure alcohol, and when it was drunk. */
export type AlcoholDose = { consumedAt: Date; grams: number }

export type BacPoint = {
  /** Epoch milliseconds, so the chart can use a real time axis. */
  at: number
  bac: number
  /** True after `now`: a forecast, not a record. */
  projected: boolean
}

const ABSORPTION_RATE = Math.LN2 / ABSORPTION_HALF_LIFE_MS

/** Integration step. One minute is far finer than anything displayed. */
const STEP_MS = MINUTE_MS

/** Below this, the gut is empty enough that nothing more is coming. */
const GUT_EMPTY_G = 0.01

type Sample = { bac: number; gutG: number }

/**
 * Walk the two-compartment state forward and read it at each requested instant.
 *
 * The simulation **always** begins at the earliest dose, never at the first
 * sample. Seeding it at the caller's window would start a body sober in the
 * middle of an evening, which is the one mistake this shape of model invites:
 * with no closed form there is nothing to evaluate at an arbitrary instant, so
 * the history has to be replayed every time.
 *
 * `sampleTimes` must be sorted ascending; the walk is single-pass.
 */
function simulate(
  doses: AlcoholDose[],
  sampleTimes: number[],
  profile: BodyProfile,
): Sample[] {
  if (sampleTimes.length === 0) return []

  const ordered = [...doses].sort(
    (a, b) => a.consumedAt.getTime() - b.consumedAt.getTime(),
  )
  const eliminationPerMs = ELIMINATION_PERMILLE_PER_HOUR / HOUR_MS
  /** Permille added per gram absorbed — the Widmark denominator. */
  const permillePerGram = 1 / (profile.widmarkRatio * profile.weightKg)

  let t = ordered.length
    ? Math.min(ordered[0].consumedAt.getTime(), sampleTimes[0])
    : sampleTimes[0]
  let gutG = 0
  let bac = 0
  let next = 0

  const swallowUpTo = (instant: number) => {
    while (next < ordered.length && ordered[next].consumedAt.getTime() <= instant) {
      gutG += ordered[next].grams
      next++
    }
  }

  const out: Sample[] = []

  for (const sampleAt of sampleTimes) {
    while (t < sampleAt) {
      swallowUpTo(t)
      // The last step of a stretch is short when a sample falls off the grid.
      // Both processes are rate-based, so a partial step is exact for
      // elimination and correct to the same order for absorption.
      const step = Math.min(STEP_MS, sampleAt - t)
      const absorbed = gutG * (1 - Math.exp(-ABSORPTION_RATE * step))
      gutG -= absorbed
      bac = Math.max(0, bac + absorbed * permillePerGram - eliminationPerMs * step)
      t += step
    }

    swallowUpTo(t)
    out.push({ bac, gutG })
  }

  return out
}

/** Estimated blood alcohol, in permille, at `instant`. */
export function bacAt(
  doses: AlcoholDose[],
  instant: Date,
  profile: BodyProfile = DEFAULT_BODY_PROFILE,
): number {
  return simulate(doses, [instant.getTime()], profile)[0].bac
}

/**
 * Sample the curve across a window.
 *
 * The grid is anchored on `now` rather than on `from`, so the present instant is
 * always a sample — the chart draws the past solid and the future dashed, and
 * they can only meet if they share a point. Same rule as
 * `bloodCaffeineCurve`.
 */
export function bloodAlcoholCurve(
  doses: AlcoholDose[],
  {
    from,
    to,
    now,
    stepMs = 10 * MINUTE_MS,
    profile = DEFAULT_BODY_PROFILE,
  }: { from: Date; to: Date; now: Date; stepMs?: number; profile?: BodyProfile },
): BacPoint[] {
  const times = new Set<number>([from.getTime(), to.getTime()])

  for (let t = now.getTime(); t >= from.getTime(); t -= stepMs) times.add(t)
  for (let t = now.getTime(); t <= to.getTime(); t += stepMs) times.add(t)

  const ordered = [...times]
    .filter((t) => t >= from.getTime() && t <= to.getTime())
    .sort((a, b) => a - b)

  const samples = simulate(doses, ordered, profile)

  return ordered.map((at, index) => ({
    at,
    bac: samples[index].bac,
    // The joining sample counts as measured, so the solid line reaches it.
    projected: at > now.getTime(),
  }))
}

/**
 * The first instant from `from` onwards at or below a threshold, or `null`
 * inside the horizon.
 *
 * The gut check is load-bearing and is the one thing this does that the
 * caffeine module's `clearsBelowAt` does not. Two minutes after a drink the
 * blood is still near zero because nothing has been absorbed yet; asking only
 * "is the level low" would answer "you are already sober" to someone with a
 * pint in their stomach. A candidate only counts once there is nothing left to
 * arrive.
 */
export function soberAt(
  doses: AlcoholDose[],
  {
    from,
    profile = DEFAULT_BODY_PROFILE,
    threshold = 0,
    stepMs = 5 * MINUTE_MS,
    horizonMs = 24 * HOUR_MS,
  }: {
    from: Date
    profile?: BodyProfile
    threshold?: number
    stepMs?: number
    horizonMs?: number
  },
): Date | null {
  const times: number[] = []
  for (let t = from.getTime(); t <= from.getTime() + horizonMs; t += stepMs) times.push(t)

  const samples = simulate(doses, times, profile)

  for (let i = 0; i < samples.length; i++) {
    if (samples[i].gutG <= GUT_EMPTY_G && samples[i].bac <= threshold) {
      return new Date(times[i])
    }
  }

  return null
}

/** How far back the curve looks. An evening, not a working day. */
const LOOKBACK_MS = 8 * HOUR_MS

/** How far ahead it is willing to guess. */
const MAX_PROJECTION_MS = 12 * HOUR_MS
const MIN_PROJECTION_MS = HOUR_MS

/** A little air either side of the first drink and the crossing. */
const PADDING_MS = 30 * MINUTE_MS

/**
 * The window worth drawing.
 *
 * Same reasoning as the caffeine chart's: start just before the first drink
 * rather than a fixed span back, so the plot is not mostly flat zero, and end a
 * little past the point the reader came for — here, sober rather than under a
 * sleep threshold.
 */
export function curveWindow(
  doses: AlcoholDose[],
  now: Date,
  profile: BodyProfile = DEFAULT_BODY_PROFILE,
): { from: Date; to: Date } {
  const earliest = Math.min(...doses.map((d) => d.consumedAt.getTime()))
  const from = Number.isFinite(earliest)
    ? Math.max(now.getTime() - LOOKBACK_MS, earliest - PADDING_MS)
    : now.getTime() - LOOKBACK_MS

  const crossing = soberAt(doses, { from: now, profile })
  const wanted = crossing ? crossing.getTime() + PADDING_MS : now.getTime() + MAX_PROJECTION_MS
  const to = Math.min(
    now.getTime() + MAX_PROJECTION_MS,
    Math.max(now.getTime() + MIN_PROJECTION_MS, wanted),
  )

  return { from: new Date(from), to: new Date(to) }
}

export type DrivingOutlook =
  /** Nothing on board. */
  | { kind: 'clear' }
  /** Will be sober at a time the chart can show. */
  | { kind: 'clears'; at: Date }
  /** Not inside the projection window. */
  | { kind: 'not-tonight' }

/**
 * The one-line answer, and never a time past the right-hand edge of the plot.
 *
 * A figure quoted off the end of the chart is a claim the reader cannot check
 * against the line, and the further out the projection runs the less it is
 * worth. "Not tonight" is the honest form of that answer — and for this
 * quantity it is also the safer one.
 */
export function drivingOutlook(
  doses: AlcoholDose[],
  now: Date,
  profile: BodyProfile = DEFAULT_BODY_PROFILE,
): DrivingOutlook {
  const crossing = soberAt(doses, { from: now, profile })
  if (crossing && crossing.getTime() <= now.getTime()) return { kind: 'clear' }

  const { to } = curveWindow(doses, now, profile)
  if (!crossing || crossing.getTime() > to.getTime()) return { kind: 'not-tonight' }

  return { kind: 'clears', at: crossing }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/blood-alcohol.test.ts`
Expected: PASS.

If the peak test fails at 29 or 46 minutes, do **not** widen the assertion — adjust `ABSORPTION_HALF_LIFE_MS` and record the chosen value in the constant's comment. The 30-45 minute range is the claim the model is making.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/blood-alcohol.ts src/lib/blood-alcohol.test.ts
git commit -m "Model blood alcohol with zero-order elimination"
```

---

### Task 4: Schema, migration and seed data

**Files:**
- Modify: `src/db/schema.ts` (add two tables, three member columns, one relation)
- Create: `src/db/migrations/0006_party_mode.sql`
- Modify: `src/db/migrations/meta/_journal.json`
- Create: `src/db/migrations/meta/0006_snapshot.json` (generated)
- Create: `src/db/alcohol-seed-data.ts`
- Modify: `src/db/seed.ts`

**Interfaces:**
- Consumes: `AlcoholCategory` from `@/lib/alcohol`.
- Produces:
  - `alcoholDrinkTypes` and `alcoholLogs` table objects from `@/db/schema`
  - `members.partyMode`, `members.bodyWeightKg`, `members.sex`
  - `ALCOHOL_TYPE_SEEDS: AlcoholTypeSeed[]` from `@/db/alcohol-seed-data`

- [ ] **Step 1: Add the member columns**

In `src/db/schema.ts`, inside `members`, after `lastSeenPatchNote`:

```ts
  /**
   * Whether this member has switched party mode on.
   *
   * A column rather than a URL parameter or localStorage: the toggle has to
   * survive `LiveRefresh`, a nav click and a second device, and a server-
   * rendered section that appears after hydration flashes.
   */
  partyMode: integer('party_mode', { mode: 'boolean' }).notNull().default(false),
  /**
   * Body weight in kilograms, or null.
   *
   * Optional, unlike the caffeine settings, because the alcohol model has a
   * defensible population fallback and asking for a weight to use the feature
   * at all would be a poor trade. See `lib/blood-alcohol.ts`.
   */
  bodyWeightKg: integer('body_weight_kg'),
  /**
   * Used for exactly one thing: choosing Widmark's distribution ratio, which
   * differs because body water fraction does. Nothing else reads it, and it is
   * never displayed.
   */
  sex: text('sex').$type<'male' | 'female'>(),
```

- [ ] **Step 2: Add the two tables**

In `src/db/schema.ts`, after `dailyTotals`, before the Relations block. Note the import at the top of the file gains `real`:

```ts
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { AlcoholCategory } from '@/lib/alcohol'
```

```ts
/* -------------------------------------------------------------------------- */
/* Party mode                                                                 */
/*                                                                            */
/* Alcohol is a parallel path, not a category of drink. Sharing `drink_logs`   */
/* would put a beer into every caffeine statistic in `stats.ts` — the drink    */
/* count, the rank, the streak, the category split — as a zero-milligram row.  */
/* Two tables that never meet is the cheaper honesty.                          */
/*                                                                            */
/* There is deliberately no `daily_totals` equivalent. That rollup exists      */
/* because all-time leaderboards would otherwise scan every drink ever logged; */
/* party mode has no all-time query, only one member's last day or two, which  */
/* the `(user_id, local_date)` index already answers in a handful of rows.     */
/* -------------------------------------------------------------------------- */

/**
 * The alcoholic drinks that can be logged.
 *
 * Volume and ABV are both required, unlike `drinkTypes.volumeMl`. Grams of
 * alcohol is volume times strength times density, so a type missing either
 * cannot produce a dose at all — where a coffee's caffeine is simply a number
 * somebody typed.
 */
export const alcoholDrinkTypes = sqliteTable('alcohol_drink_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').$type<AlcoholCategory>().notNull(),
  volumeMl: integer('volume_ml').notNull(),
  /**
   * Percent alcohol by volume, as printed on the label.
   *
   * REAL rather than the integer-of-tenths trick used for
   * `elimination_half_life_minutes`. That one exists so a form can accept 5.5
   * while the column stays whole; here 4.7 simply *is* an ABV, and tenths would
   * push a conversion into every read for nothing.
   */
  abvPercent: real('abv_percent').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Null for the seeded types and for anyone since deleted. */
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
})

/**
 * One row per alcoholic drink consumed.
 *
 * `alcoholGrams` is a snapshot of what the type worked out to at the moment of
 * logging, for the same reason as `drinkLogs.caffeineMg`: ABV figures are
 * estimates and editable, and a join would rewrite last Friday.
 *
 * REAL, not a rounded integer. At an average body one gram is about 0.02
 * permille — a tenth of the legal limit — so rounding each dose would put
 * visible error on the one number the gauge exists to show.
 */
export const alcoholLogs = sqliteTable(
  'alcohol_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    drinkTypeId: integer('drink_type_id')
      .notNull()
      .references(() => alcoholDrinkTypes.id),
    alcoholGrams: real('alcohol_grams').notNull(),
    category: text('category').$type<AlcoholCategory>().notNull(),
    /** The serving, snapshotted so a past evening explains itself without a join. */
    volumeMl: integer('volume_ml').notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }).notNull(),
    /** When the row was written. The undo window measures from here. */
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    localDate: text('local_date').notNull(),
    localHour: integer('local_hour').notNull(),
  },
  (table) => [
    index('alcohol_logs_user_date_idx').on(table.userId, table.localDate),
    index('alcohol_logs_user_recent_idx').on(table.userId, table.createdAt),
  ],
)
```

And in the Relations block:

```ts
export const alcoholLogsRelations = relations(alcoholLogs, ({ one }) => ({
  user: one(users, { fields: [alcoholLogs.userId], references: [users.id] }),
  drinkType: one(alcoholDrinkTypes, {
    fields: [alcoholLogs.drinkTypeId],
    references: [alcoholDrinkTypes.id],
  }),
}))
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`

This writes `src/db/migrations/0006_*.sql`, the snapshot and the journal entry.

- [ ] **Step 4: Check and fix the generated SQL**

Read the generated `.sql`. Drizzle-kit omits `ON DELETE` actions on new tables in this version — the same defect `0005`'s comment records. Verify by eye that:

- `alcohol_logs.user_id` has `ON DELETE cascade`. If it says `no action`, deleting an account fails, and the privacy page promises it works.
- `alcohol_drink_types.created_by` has `ON DELETE set null`.

Fix them in the SQL by hand if wrong, and rename the file to `0006_party_mode.sql`, updating the `tag` in `meta/_journal.json` to match. Add a comment at the top of the SQL if you corrected anything, in the style of `0005`.

Expected shape:

```sql
CREATE TABLE `alcohol_drink_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`volume_ml` integer NOT NULL,
	`abv_percent` real NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
```

- [ ] **Step 5: Write the seed data**

Create `src/db/alcohol-seed-data.ts`:

```ts
import type { AlcoholCategory } from '@/lib/alcohol'

export type AlcoholTypeSeed = {
  slug: string
  name: string
  category: AlcoholCategory
  volumeMl: number
  abvPercent: number
  sortOrder: number
}

/**
 * Starting alcoholic drinks.
 *
 * Real servings rather than round numbers: these are the containers a bar and a
 * fridge actually hand you, which is why party mode ships without a volume
 * slider. The strengths are typical Norwegian ones and, like the caffeine
 * figures, estimates — a craft IPA is nearer 6.5% than 4.7%, so the list is
 * editable for the same reason the coffee list is.
 */
export const ALCOHOL_TYPE_SEEDS: AlcoholTypeSeed[] = [
  { slug: 'beer_pint', name: 'Pint 0.5L', category: 'beer', volumeMl: 500, abvPercent: 4.7, sortOrder: 10 },
  { slug: 'beer_small', name: 'Beer 0.33L', category: 'beer', volumeMl: 330, abvPercent: 4.7, sortOrder: 20 },
  { slug: 'beer_strong', name: 'Strong beer 0.33L', category: 'beer', volumeMl: 330, abvPercent: 6.5, sortOrder: 30 },
  { slug: 'wine_glass', name: 'Wine glass', category: 'wine', volumeMl: 150, abvPercent: 12, sortOrder: 40 },
  { slug: 'spirit_4cl', name: 'Spirit 4cl', category: 'spirits', volumeMl: 40, abvPercent: 40, sortOrder: 50 },
  { slug: 'cider_033', name: 'Cider 0.33L', category: 'cider', volumeMl: 330, abvPercent: 4.5, sortOrder: 60 },
]
```

- [ ] **Step 6: Seed both catalogues**

Rewrite `src/db/seed.ts` so one command seeds both, still idempotently:

```ts
import { db } from './index'
import { ALCOHOL_TYPE_SEEDS } from './alcohol-seed-data'
import { DRINK_TYPE_SEEDS } from './seed-data'
import { alcoholDrinkTypes, drinkTypes } from './schema'

/**
 * Insert the starting drink types, caffeinated and not.
 *
 * Idempotent: existing slugs are left alone, so running this against a live
 * database will not overwrite values that have been tuned by hand.
 */
async function seed() {
  const caffeinated = await db
    .insert(drinkTypes)
    .values(DRINK_TYPE_SEEDS)
    .onConflictDoNothing({ target: drinkTypes.slug })
    .returning({ slug: drinkTypes.slug })

  const alcoholic = await db
    .insert(alcoholDrinkTypes)
    .values(ALCOHOL_TYPE_SEEDS)
    .onConflictDoNothing({ target: alcoholDrinkTypes.slug })
    .returning({ slug: alcoholDrinkTypes.slug })

  for (const [label, rows] of [
    ['drink type', caffeinated],
    ['alcoholic drink type', alcoholic],
  ] as const) {
    if (rows.length === 0) {
      console.log(`No new ${label}s to seed.`)
    } else {
      console.log(`Seeded ${rows.length} ${label}(s): ${rows.map((r) => r.slug).join(', ')}`)
    }
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
```

- [ ] **Step 7: Verify the migration applies to a fresh database**

The whole test suite builds a fresh database per test through `createTestDb()`, which runs every migration. If `0006` is malformed, everything fails.

Run: `npm test`
Expected: PASS — the existing 145 tests, unchanged.

- [ ] **Step 8: Apply locally and commit**

```bash
npm run db:migrate && npm run db:seed
```

```bash
npm run typecheck && npm run lint
git add -A && git commit -m "Add alcohol tables and party-mode member settings"
```

---

### Task 5: `server/alcohol.ts` and its integration tests

**Files:**
- Create: `src/server/alcohol.ts`
- Test: `src/server/alcohol.test.ts`

**Interfaces:**
- Consumes: `alcoholDrinkTypes`, `alcoholLogs`, `drinkLogs`, `dailyTotals` from `@/db/schema`; `gramsOfAlcohol`, `AlcoholCategory` from `@/lib/alcohol`; `localBuckets`, `localDateOf`, `addLocalDays` from `@/lib/time`; `resolveConsumedAt` from `@/server/drinks` (reused, not duplicated).
- Produces:
  - `ALCOHOL_UNDO_WINDOW_MS: number`
  - `type ActiveAlcoholType = { id, slug, name, category, volumeMl, abvPercent, alcoholGrams }`
  - `listActiveAlcoholTypes(db): Promise<ActiveAlcoholType[]>`
  - `logAlcoholDrink(db, { userId, slug, now?, consumedAt? }): Promise<{ ok: true; logId: number; alcoholGrams: number } | { ok: false; reason: 'unknown-drink' }>`
  - `undoLastAlcoholDrink(db, { userId, now? }): Promise<{ ok: true; alcoholGrams: number } | { ok: false; reason: 'nothing-to-undo' | 'too-old' }>`
  - `type UndoableAlcoholDrink = { alcoholGrams: number; name: string; expiresAt: Date }`
  - `getUndoableAlcoholDrink(db, { userId, now? }): Promise<UndoableAlcoholDrink | null>`
  - `type AlcoholEvent = { consumedAt: Date; alcoholGrams: number }`
  - `getUserAlcoholEvents(db, userId, { from, now }): Promise<AlcoholEvent[]>`
  - `type AlcoholToday = { totalGrams: number; drinkCount: number }`
  - `getUserAlcoholToday(db, userId, { now? }): Promise<AlcoholToday>`
  - `type RecentAlcoholDrink = { id, name, category, alcoholGrams, volumeMl, consumedAt }`
  - `getUserRecentAlcohol(db, userId, { now? }): Promise<RecentAlcoholDrink[]>`

- [ ] **Step 1: Write the failing test**

Create `src/server/alcohol.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/db/test-db'
import { alcoholDrinkTypes, alcoholLogs, dailyTotals, drinkLogs, drinkTypes, users } from '@/db/schema'
import { ALCOHOL_TYPE_SEEDS } from '@/db/alcohol-seed-data'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import { logDrink } from './drinks'
import {
  ALCOHOL_UNDO_WINDOW_MS,
  getUndoableAlcoholDrink,
  getUserAlcoholEvents,
  getUserAlcoholToday,
  getUserRecentAlcohol,
  listActiveAlcoholTypes,
  logAlcoholDrink,
  undoLastAlcoholDrink,
} from './alcohol'

let db: TestDb

/** 22:00 Oslo on a Friday in summer (UTC+2). */
const now = new Date('2026-08-28T20:00:00Z')

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(users).values([
    { id: 'ada', name: 'Ada', email: 'ada@example.com' },
    { id: 'linn', name: 'Linn', email: 'linn@example.com' },
  ])
  await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)
  await db.insert(alcoholDrinkTypes).values(ALCOHOL_TYPE_SEEDS)
})

describe('listActiveAlcoholTypes', () => {
  it('returns the seeded types in display order with their grams worked out', async () => {
    const types = await listActiveAlcoholTypes(db)
    expect(types.map((t) => t.slug)).toEqual([
      'beer_pint',
      'beer_small',
      'beer_strong',
      'wine_glass',
      'spirit_4cl',
      'cider_033',
    ])
    expect(types[0].alcoholGrams).toBeCloseTo(18.54, 2)
  })

  it('omits deactivated types', async () => {
    await db
      .update(alcoholDrinkTypes)
      .set({ isActive: false })
      .where(eq(alcoholDrinkTypes.slug, 'spirit_4cl'))
    const types = await listActiveAlcoholTypes(db)
    expect(types.map((t) => t.slug)).not.toContain('spirit_4cl')
  })
})

describe('logAlcoholDrink', () => {
  it('records the drink with its Oslo date and hour', async () => {
    const result = await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    expect(result.ok).toBe(true)

    const [log] = await db.select().from(alcoholLogs)
    expect(log).toMatchObject({
      userId: 'ada',
      category: 'beer',
      volumeMl: 500,
      localDate: '2026-08-28',
      localHour: 22,
    })
    expect(log.alcoholGrams).toBeCloseTo(18.54, 2)
  })

  it('refuses an unknown drink', async () => {
    const result = await logAlcoholDrink(db, { userId: 'ada', slug: 'absinthe', now })
    expect(result).toEqual({ ok: false, reason: 'unknown-drink' })
  })

  it('snapshots the grams, so a later ABV edit does not rewrite history', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await db
      .update(alcoholDrinkTypes)
      .set({ abvPercent: 9 })
      .where(eq(alcoholDrinkTypes.slug, 'beer_pint'))

    const [log] = await db.select().from(alcoholLogs)
    expect(log.alcoholGrams).toBeCloseTo(18.54, 2)
  })

  it('buckets a drink after midnight onto the next local date', async () => {
    // 00:30 Oslo is 22:30 UTC the day before.
    const afterMidnight = new Date('2026-08-28T22:30:00Z')
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: afterMidnight })

    const [log] = await db.select().from(alcoholLogs)
    expect(log.localDate).toBe('2026-08-29')
    expect(log.localHour).toBe(0)
  })

  it('keeps consumedAt and createdAt apart when backdating', async () => {
    const earlier = new Date('2026-08-28T17:00:00Z')
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now, consumedAt: earlier })

    const [log] = await db.select().from(alcoholLogs)
    expect(log.consumedAt).toEqual(earlier)
    expect(log.createdAt).toEqual(now)
    expect(log.localHour).toBe(19)
  })
})

describe('alcohol never touches the caffeine path', () => {
  it('leaves drink_logs and daily_totals completely alone', async () => {
    await logDrink(db, { userId: 'ada', slug: 'coffee', now })
    const before = {
      logs: await db.select().from(drinkLogs),
      totals: await db.select().from(dailyTotals),
    }

    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    await undoLastAlcoholDrink(db, { userId: 'ada', now })

    expect(await db.select().from(drinkLogs)).toEqual(before.logs)
    expect(await db.select().from(dailyTotals)).toEqual(before.totals)
  })
})

describe('undoLastAlcoholDrink', () => {
  it('removes the most recently written drink', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })

    const result = await undoLastAlcoholDrink(db, { userId: 'ada', now })
    expect(result.ok).toBe(true)

    const rows = await db.select().from(alcoholLogs)
    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBe('beer')
  })

  it('orders by write time, so a backdated drink is still the last thing you did', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, {
      userId: 'ada',
      slug: 'wine_glass',
      now: new Date(now.getTime() + 1000),
      consumedAt: new Date(now.getTime() - 3 * 3_600_000),
    })

    await undoLastAlcoholDrink(db, { userId: 'ada', now: new Date(now.getTime() + 2000) })
    const rows = await db.select().from(alcoholLogs)
    expect(rows.map((r) => r.category)).toEqual(['beer'])
  })

  it('refuses once the window has passed', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    const late = new Date(now.getTime() + ALCOHOL_UNDO_WINDOW_MS + 1000)

    expect(await undoLastAlcoholDrink(db, { userId: 'ada', now: late })).toEqual({
      ok: false,
      reason: 'too-old',
    })
  })

  it('says there is nothing to undo when there is nothing', async () => {
    expect(await undoLastAlcoholDrink(db, { userId: 'ada', now })).toEqual({
      ok: false,
      reason: 'nothing-to-undo',
    })
  })

  it('cannot reach another member drink', async () => {
    await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })

    expect(await undoLastAlcoholDrink(db, { userId: 'ada', now })).toEqual({
      ok: false,
      reason: 'nothing-to-undo',
    })
    expect(await db.select().from(alcoholLogs)).toHaveLength(1)
  })
})

describe('getUndoableAlcoholDrink', () => {
  it('names the drink while the window is open', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    const undoable = await getUndoableAlcoholDrink(db, { userId: 'ada', now })
    expect(undoable?.name).toBe('Wine glass')
  })

  it('is null once the window has closed', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    const late = new Date(now.getTime() + ALCOHOL_UNDO_WINDOW_MS + 1)
    expect(await getUndoableAlcoholDrink(db, { userId: 'ada', now: late })).toBeNull()
  })
})

describe('getUserAlcoholToday', () => {
  it('adds up the local day and counts the drinks', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })

    const today = await getUserAlcoholToday(db, 'ada', { now })
    expect(today.drinkCount).toBe(2)
    expect(today.totalGrams).toBeCloseTo(18.54 + 14.2, 1)
  })

  it('is zero for a member who has logged nothing', async () => {
    expect(await getUserAlcoholToday(db, 'ada', { now })).toEqual({
      totalGrams: 0,
      drinkCount: 0,
    })
  })
})

describe('getUserAlcoholEvents', () => {
  it('returns only this member drinks inside the window, oldest first', async () => {
    const early = new Date(now.getTime() - 4 * 3_600_000)
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: early })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'wine_glass', now })
    await logAlcoholDrink(db, { userId: 'linn', slug: 'beer_pint', now })

    const events = await getUserAlcoholEvents(db, 'ada', {
      from: new Date(now.getTime() - 8 * 3_600_000),
      now,
    })
    expect(events).toHaveLength(2)
    expect(events[0].consumedAt.getTime()).toBeLessThan(events[1].consumedAt.getTime())
  })

  it('spans midnight, because an evening does', async () => {
    // 23:30 then 00:30 Oslo: two local dates, one evening.
    const beforeMidnight = new Date('2026-08-28T21:30:00Z')
    const afterMidnight = new Date('2026-08-28T22:30:00Z')
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: beforeMidnight })
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now: afterMidnight })

    const events = await getUserAlcoholEvents(db, 'ada', {
      from: new Date(afterMidnight.getTime() - 8 * 3_600_000),
      now: afterMidnight,
    })
    expect(events).toHaveLength(2)
  })
})

describe('getUserRecentAlcohol', () => {
  it('lists this evening newest first', async () => {
    await logAlcoholDrink(db, { userId: 'ada', slug: 'beer_pint', now })
    await logAlcoholDrink(db, {
      userId: 'ada',
      slug: 'wine_glass',
      now: new Date(now.getTime() + 60_000),
    })

    const recent = await getUserRecentAlcohol(db, 'ada', { now: new Date(now.getTime() + 60_000) })
    expect(recent.map((r) => r.name)).toEqual(['Wine glass', 'Pint 0.5L'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/alcohol.test.ts`
Expected: FAIL — cannot resolve `./alcohol`.

- [ ] **Step 3: Implement**

Create `src/server/alcohol.ts`:

```ts
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@/db'
import { alcoholDrinkTypes, alcoholLogs } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import { gramsOfAlcohol, type AlcoholCategory } from '@/lib/alcohol'
import { addLocalDays, localBuckets, localDateOf } from '@/lib/time'

type AnyDb = Db | TestDb

/**
 * How long after writing an alcohol log it can still be taken back.
 *
 * The same ten minutes as caffeine. Its own constant rather than an import,
 * because the two are equal by coincidence rather than by rule: the arguments
 * for the length are about mistaps, and nothing says a Friday and a Tuesday
 * have to agree forever.
 */
export const ALCOHOL_UNDO_WINDOW_MS = 10 * 60 * 1000

export type ActiveAlcoholType = {
  id: number
  slug: string
  name: string
  category: AlcoholCategory
  volumeMl: number
  abvPercent: number
  /** What one of these works out to, so the button can show it. */
  alcoholGrams: number
}

/**
 * The catalogue, with grams already computed.
 *
 * Derived here rather than in the component so the number on the button and the
 * number written to the log come from one call to `gramsOfAlcohol`. Two copies
 * of that arithmetic is how they start disagreeing.
 */
export async function listActiveAlcoholTypes(db: AnyDb): Promise<ActiveAlcoholType[]> {
  const rows = await db
    .select({
      id: alcoholDrinkTypes.id,
      slug: alcoholDrinkTypes.slug,
      name: alcoholDrinkTypes.name,
      category: alcoholDrinkTypes.category,
      volumeMl: alcoholDrinkTypes.volumeMl,
      abvPercent: alcoholDrinkTypes.abvPercent,
    })
    .from(alcoholDrinkTypes)
    .where(eq(alcoholDrinkTypes.isActive, true))
    .orderBy(asc(alcoholDrinkTypes.sortOrder), asc(alcoholDrinkTypes.id))

  return rows.map((row) => ({ ...row, alcoholGrams: gramsOfAlcohol(row) }))
}

export type LogAlcoholResult =
  | { ok: true; logId: number; alcoholGrams: number; localDate: string }
  | { ok: false; reason: 'unknown-drink' }

/**
 * Record one alcoholic drink.
 *
 * No transaction, unlike `logDrink`: there is no rollup to keep in step, so
 * this is a single insert and there is nothing to half-succeed.
 *
 * `consumedAt` is when it was drunk and `now` is when it was logged. Every
 * calendar consequence follows the drink; only the undo window follows the
 * write.
 */
export async function logAlcoholDrink(
  db: AnyDb,
  {
    userId,
    slug,
    now = new Date(),
    consumedAt = now,
  }: { userId: string; slug: string; now?: Date; consumedAt?: Date },
): Promise<LogAlcoholResult> {
  const [type] = await db
    .select()
    .from(alcoholDrinkTypes)
    .where(and(eq(alcoholDrinkTypes.slug, slug), eq(alcoholDrinkTypes.isActive, true)))

  if (!type) return { ok: false, reason: 'unknown-drink' }

  const alcoholGrams = gramsOfAlcohol(type)
  const { localDate, localHour } = localBuckets(consumedAt)

  const [log] = await db
    .insert(alcoholLogs)
    .values({
      userId,
      drinkTypeId: type.id,
      // Snapshot, not a join: retuning an ABV later must not rewrite what last
      // Friday cost.
      alcoholGrams,
      category: type.category,
      volumeMl: type.volumeMl,
      consumedAt,
      createdAt: now,
      localDate,
      localHour,
    })
    .returning({ id: alcoholLogs.id })

  return { ok: true, logId: log.id, alcoholGrams, localDate }
}

export type UndoAlcoholResult =
  | { ok: true; alcoholGrams: number }
  | { ok: false; reason: 'nothing-to-undo' | 'too-old' }

/**
 * Take back the drink you most recently logged.
 *
 * Ordered and timed by `createdAt`, so a drink backdated to earlier in the
 * evening is still the last thing you did. Scoped to the caller's own rows.
 */
export async function undoLastAlcoholDrink(
  db: AnyDb,
  { userId, now = new Date() }: { userId: string; now?: Date },
): Promise<UndoAlcoholResult> {
  const [last] = await db
    .select()
    .from(alcoholLogs)
    .where(eq(alcoholLogs.userId, userId))
    .orderBy(desc(alcoholLogs.createdAt), desc(alcoholLogs.id))
    .limit(1)

  if (!last) return { ok: false, reason: 'nothing-to-undo' }
  if (now.getTime() - last.createdAt.getTime() > ALCOHOL_UNDO_WINDOW_MS) {
    return { ok: false, reason: 'too-old' }
  }

  await db.delete(alcoholLogs).where(eq(alcoholLogs.id, last.id))

  return { ok: true, alcoholGrams: last.alcoholGrams }
}

export type UndoableAlcoholDrink = {
  alcoholGrams: number
  name: string
  expiresAt: Date
}

export async function getUndoableAlcoholDrink(
  db: AnyDb,
  { userId, now = new Date() }: { userId: string; now?: Date },
): Promise<UndoableAlcoholDrink | null> {
  const [last] = await db
    .select({
      alcoholGrams: alcoholLogs.alcoholGrams,
      createdAt: alcoholLogs.createdAt,
      name: alcoholDrinkTypes.name,
    })
    .from(alcoholLogs)
    .innerJoin(alcoholDrinkTypes, eq(alcoholDrinkTypes.id, alcoholLogs.drinkTypeId))
    .where(eq(alcoholLogs.userId, userId))
    .orderBy(desc(alcoholLogs.createdAt), desc(alcoholLogs.id))
    .limit(1)

  if (!last) return null

  const expiresAt = new Date(last.createdAt.getTime() + ALCOHOL_UNDO_WINDOW_MS)
  if (expiresAt.getTime() <= now.getTime()) return null

  return { alcoholGrams: last.alcoholGrams, name: last.name, expiresAt }
}

export type AlcoholEvent = { consumedAt: Date; alcoholGrams: number }

/**
 * The doses the curve is drawn from.
 *
 * Bounded by `local_date` on the `(user_id, local_date)` index rather than by
 * `consumed_at`, which would scan every drink the member has ever logged — the
 * same reason `getUserRecentDrinks` does it. Two local dates are read because
 * an evening crosses midnight and the drinks before it are exactly the ones
 * still in the bloodstream after it.
 */
export async function getUserAlcoholEvents(
  db: AnyDb,
  userId: string,
  { from, now }: { from: Date; now: Date },
): Promise<AlcoholEvent[]> {
  return db
    .select({
      consumedAt: alcoholLogs.consumedAt,
      alcoholGrams: alcoholLogs.alcoholGrams,
    })
    .from(alcoholLogs)
    .where(
      and(
        eq(alcoholLogs.userId, userId),
        gte(alcoholLogs.localDate, localDateOf(from)),
        lte(alcoholLogs.localDate, localDateOf(now)),
        gte(alcoholLogs.consumedAt, from),
      ),
    )
    .orderBy(asc(alcoholLogs.consumedAt), asc(alcoholLogs.id))
}

export type AlcoholToday = { totalGrams: number; drinkCount: number }

/** This member's local-day total, for the readout above the buttons. */
export async function getUserAlcoholToday(
  db: AnyDb,
  userId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<AlcoholToday> {
  const [row] = await db
    .select({
      totalGrams: sql<number>`coalesce(sum(${alcoholLogs.alcoholGrams}), 0)`,
      drinkCount: sql<number>`count(*)`,
    })
    .from(alcoholLogs)
    .where(
      and(eq(alcoholLogs.userId, userId), eq(alcoholLogs.localDate, localDateOf(now))),
    )

  return { totalGrams: row?.totalGrams ?? 0, drinkCount: row?.drinkCount ?? 0 }
}

export type RecentAlcoholDrink = {
  id: number
  name: string
  category: AlcoholCategory
  alcoholGrams: number
  volumeMl: number
  consumedAt: Date
}

/**
 * This member's drinks from tonight and yesterday, newest first.
 *
 * Two dates rather than one, for the same midnight reason as
 * {@link getUserAlcoholEvents}: at 00:30 the list would otherwise be empty
 * while the gauge reads 0.8.
 */
export async function getUserRecentAlcohol(
  db: AnyDb,
  userId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<RecentAlcoholDrink[]> {
  const since = addLocalDays(localDateOf(now), -1)

  return db
    .select({
      id: alcoholLogs.id,
      name: alcoholDrinkTypes.name,
      category: alcoholLogs.category,
      alcoholGrams: alcoholLogs.alcoholGrams,
      volumeMl: alcoholLogs.volumeMl,
      consumedAt: alcoholLogs.consumedAt,
    })
    .from(alcoholLogs)
    .innerJoin(alcoholDrinkTypes, eq(alcoholDrinkTypes.id, alcoholLogs.drinkTypeId))
    .where(and(eq(alcoholLogs.userId, userId), gte(alcoholLogs.localDate, since)))
    .orderBy(desc(alcoholLogs.consumedAt), desc(alcoholLogs.id))
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/server/alcohol.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/server/alcohol.ts src/server/alcohol.test.ts
git commit -m "Log and read alcohol drinks"
```

---

### Task 6: Body settings and the party-mode toggle

Both are member-row changes reaching `Member`, so they land together.

**Files:**
- Modify: `src/server/auth.ts` (`Member` type and `toMember`)
- Modify: `src/server/settings.ts` (`parseSettings`, `MemberSettings`, bounds, `setPartyMode`)
- Test: `src/server/settings.test.ts` (extend)
- Modify: `src/app/(app)/settings/actions.ts`
- Modify: `src/components/SettingsForm.tsx`
- Modify: `src/app/(app)/settings/page.tsx`
- Create: `src/app/(app)/party-actions.ts`
- Create: `src/components/PartyModeToggle.tsx`

**Interfaces:**
- Consumes: `bodyProfileFrom`, `BodyProfile` from `@/lib/blood-alcohol`.
- Produces:
  - `Member` gains `partyMode: boolean`, `bodyWeightKg: number | null`, `sex: 'male' | 'female' | null`, `bodyProfile: BodyProfile`
  - `MIN_WEIGHT_KG = 35`, `MAX_WEIGHT_KG = 250` from `@/server/settings`
  - `MemberSettings` gains `bodyWeightKg: number | null`, `sex: 'male' | 'female' | null`
  - `setPartyMode(db, userId, on: boolean): Promise<void>` from `@/server/settings`
  - `togglePartyModeAction(on: boolean): Promise<void>` from `@/app/(app)/party-actions`
  - `<PartyModeToggle on={boolean} />`

- [ ] **Step 1: Write the failing settings test**

Append to `src/server/settings.test.ts` (keep the existing imports and add `MAX_WEIGHT_KG`, `MIN_WEIGHT_KG`):

```ts
describe('parseSettings — body', () => {
  const valid = { halfLifeHours: '5', sleepThresholdMg: '50', bedtimeLocal: '23:00' }

  it('treats both body fields as optional', () => {
    const parsed = parseSettings({ ...valid, bodyWeightKg: '', sex: '' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.settings.bodyWeightKg).toBeNull()
    expect(parsed.settings.sex).toBeNull()
  })

  it('accepts a weight and a sex', () => {
    const parsed = parseSettings({ ...valid, bodyWeightKg: '72', sex: 'female' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.settings.bodyWeightKg).toBe(72)
    expect(parsed.settings.sex).toBe('female')
  })

  it('accepts a comma decimal, because the keyboards here are Norwegian', () => {
    const parsed = parseSettings({ ...valid, bodyWeightKg: '72,5', sex: '' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.settings.bodyWeightKg).toBe(73)
  })

  it('refuses a weight outside the human range', () => {
    expect(parseSettings({ ...valid, bodyWeightKg: '5', sex: '' }).ok).toBe(false)
    expect(parseSettings({ ...valid, bodyWeightKg: '400', sex: '' }).ok).toBe(false)
  })

  it('refuses a sex it does not model', () => {
    expect(parseSettings({ ...valid, bodyWeightKg: '', sex: 'yes' }).ok).toBe(false)
  })

  it('still refuses a bad half-life when the body fields are fine', () => {
    expect(parseSettings({ ...valid, halfLifeHours: '99', bodyWeightKg: '72', sex: 'male' }).ok).toBe(false)
  })
})
```

Also update every existing `parseSettings(...)` call in that file to pass `bodyWeightKg: ''` and `sex: ''`, since the parameter type gains two required keys.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/settings.test.ts`
Expected: FAIL — TypeScript rejects the extra keys, then assertions fail.

- [ ] **Step 3: Extend `server/settings.ts`**

Add the bounds beside the existing ones:

```ts
/**
 * The range a body weight can sensibly take.
 *
 * Wide on purpose. This is a divisor in the Widmark denominator, so the floor
 * stops a typo producing an alarming permille figure rather than policing
 * anyone's weight.
 */
export const MIN_WEIGHT_KG = 35
export const MAX_WEIGHT_KG = 250
```

Extend the zod schema:

```ts
  bodyWeightKg: z
    .union([
      z.literal(''),
      z.coerce
        .number({ message: 'Give a weight in kilograms.' })
        .min(MIN_WEIGHT_KG, `Use at least ${MIN_WEIGHT_KG} kg.`)
        .max(MAX_WEIGHT_KG, `Over ${MAX_WEIGHT_KG} kg is not a weight this can model.`),
    ])
    .transform((value) => (value === '' ? null : Math.round(value))),
  sex: z
    .union([z.literal(''), z.enum(['male', 'female'])])
    .transform((value) => (value === '' ? null : value)),
```

Extend `MemberSettings`:

```ts
export type MemberSettings = {
  eliminationHalfLifeMinutes: number
  sleepThresholdMg: number
  bedtimeLocal: string
  /** Both null unless the member chose to give them. See `blood-alcohol.ts`. */
  bodyWeightKg: number | null
  sex: 'male' | 'female' | null
}
```

Widen `parseSettings`'s input to include `bodyWeightKg: string` and `sex: string`, apply the same comma-to-point replacement it already applies to `halfLifeHours` (Norwegian keyboards), and return the two new fields. The empty-string guard at the top must **not** be extended to them — empty means "not given", which is a valid answer here and is not for the caffeine numbers.

Add at the end of the file:

```ts
/**
 * Switch party mode on or off for one member.
 *
 * Separate from `saveMemberSettings` because it is a button, not a form: the
 * settings page saves five fields at once and this saves one from somewhere
 * else entirely.
 */
export async function setPartyMode(db: AnyDb, userId: string, on: boolean): Promise<void> {
  await db.update(members).set({ partyMode: on }).where(eq(members.userId, userId))
}
```

- [ ] **Step 4: Run the settings tests**

Run: `npx vitest run src/server/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen `Member` in `server/auth.ts`**

Add to the `Member` type:

```ts
  /** Whether the alcohol section is switched on for this member. */
  partyMode: boolean
  /** How the alcohol model sees this person. Population figures if they said nothing. */
  bodyProfile: BodyProfile
  bodyWeightKg: number | null
  sex: 'male' | 'female' | null
```

Import `bodyProfileFrom` and `type BodyProfile` from `@/lib/blood-alcohol`, and in `toMember`:

```ts
    partyMode: row.partyMode,
    bodyProfile: bodyProfileFrom({ bodyWeightKg: row.bodyWeightKg, sex: row.sex }),
    bodyWeightKg: row.bodyWeightKg,
    sex: row.sex,
```

- [ ] **Step 6: The settings action and form**

`src/app/(app)/settings/actions.ts` — add the two fields to the `parseSettings` call:

```ts
  const parsed = parseSettings({
    halfLifeHours: String(formData.get('halfLifeHours') ?? ''),
    sleepThresholdMg: String(formData.get('sleepThresholdMg') ?? ''),
    bedtimeLocal: String(formData.get('bedtimeLocal') ?? ''),
    bodyWeightKg: String(formData.get('bodyWeightKg') ?? ''),
    sex: String(formData.get('sex') ?? ''),
  })
```

`src/components/SettingsForm.tsx` — take two more props, `bodyWeightKg: number | null` and `sex: 'male' | 'female' | null`, and add a section after the bedtime field, separated by a rule because it belongs to a different feature:

```tsx
      <div className="space-y-5 border-t border-hairline pt-5">
        <div className="space-y-1">
          <p className="legend">Party mode · optional</p>
          <p className="max-w-prose text-xs leading-relaxed text-oat">
            Only read when party mode is on, and only to estimate blood alcohol — which depends
            on the size of the body the alcohol is in, where milligrams of caffeine do not. Leave
            both blank and the estimate uses an average adult: 80 kg, and the midpoint of the two
            distribution ratios. It will say which it used.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="bodyWeightKg" className="legend block">
            Body weight · kg
          </label>
          <input
            id="bodyWeightKg"
            name="bodyWeightKg"
            type="number"
            step="1"
            min={MIN_WEIGHT_KG}
            max={MAX_WEIGHT_KG}
            defaultValue={bodyWeightKg ?? ''}
            className={`${FIELD_CLASS} font-gauge max-w-32`}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="sex" className="legend block">
            Widmark ratio
          </label>
          <select
            id="sex"
            name="sex"
            defaultValue={sex ?? ''}
            className={`${FIELD_CLASS} font-gauge max-w-56`}
          >
            <option value="">Average of the two</option>
            <option value="male">Male · 0.68</option>
            <option value="female">Female · 0.55</option>
          </select>
          <p className="text-xs leading-relaxed text-oat">
            The fraction of the body that is water, which is what alcohol spreads through. The
            two figures are Widmark&apos;s, and they are averages of populations rather than facts
            about anybody in particular.
          </p>
        </div>
      </div>
```

Import `MAX_WEIGHT_KG` and `MIN_WEIGHT_KG` alongside the existing bounds. Update the form's doc comment: it says "three numbers", and there are now five fields.

`src/app/(app)/settings/page.tsx` — pass the two new props and update the intro paragraph, which currently says "These three numbers".

- [ ] **Step 7: The toggle**

Create `src/app/(app)/party-actions.ts`:

```ts
'use server'

import { refresh } from 'next/cache'
import { db } from '@/db'
import { requireMember } from '@/server/auth'
import { setPartyMode } from '@/server/settings'

/**
 * Switch the alcohol section on or off for the signed-in member.
 *
 * Scoped to `requireMember()`, so there is no id in the call and no way to aim
 * it at somebody else's row.
 */
export async function togglePartyModeAction(on: boolean): Promise<void> {
  const member = await requireMember()
  await setPartyMode(db, member.userId, on)
  refresh()
}
```

Create `src/components/PartyModeToggle.tsx`:

```tsx
'use client'

import { useTransition } from 'react'
import { togglePartyModeAction } from '@/app/(app)/party-actions'

/**
 * The switch, and the whole of party mode's discoverability.
 *
 * Understated when off, and it does not explain itself. Anyone who wants it
 * will recognise it; nobody who doesn't should have to read a pitch for alcohol
 * tracking on a page about coffee.
 */
export function PartyModeToggle({ on }: { on: boolean }) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex justify-end pt-2">
      <button
        type="button"
        disabled={pending}
        aria-pressed={on}
        onClick={() => startTransition(() => togglePartyModeAction(!on))}
        className="font-gauge text-[0.6875rem] tracking-[0.12em] text-oat uppercase underline decoration-hairline underline-offset-4 transition-colors hover:text-foam disabled:opacity-60"
      >
        {on ? 'Party mode off' : 'Party mode'}
      </button>
    </div>
  )
}
```

- [ ] **Step 8: Full check and commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add -A && git commit -m "Add body settings and the party-mode switch"
```

---

### Task 7: The gauge and the chart

**Files:**
- Create: `src/components/BacMeter.tsx`
- Create: `src/components/charts/BloodAlcoholChart.tsx`

**Interfaces:**
- Consumes: `SCALE_MAX_PERMILLE`, `DRIVING_LIMIT_PERMILLE`, `HEAVY_PERMILLE`, `bacStatus`, `formatPermille` from `@/lib/alcohol`; `BacPoint` from `@/lib/blood-alcohol`; `formatOsloClock` from `@/lib/format`; `ChartTooltip` from `./ChartTooltip`.
- Produces: `<BacMeter bac={number} />`, `<BloodAlcoholChart data={BacPoint[]} now={Date} />`.

- [ ] **Step 1: The gauge**

Create `src/components/BacMeter.tsx`. Copy the geometry constants, `angleFor`, `pointAt`, `arcPath`, the swept-needle effect and the reduced-motion handling from `src/components/BuzzMeter.tsx` — read it first and mirror it exactly, changing only the scale, the zones and the labels.

Differences from `BuzzMeter`, all deliberate:

```tsx
const SCALE_MAX = SCALE_MAX_PERMILLE   // 2.0 ‰
const TICK_STEP = 0.2
const LABEL_STEP = 0.5

const ZONE_COLORS = {
  clear: 'var(--color-oat)',
  'over-limit': 'var(--color-crema)',
  heavy: 'var(--color-scald)',
} as const
```

**No tremor.** `BuzzMeter`'s needle shakes harder as the day's caffeine climbs, and the comment there explains it as a second reading of the same number. Repeating the joke here would make a drunk needle, which turns a legal limit into a gag. Write that reasoning into the file's doc comment so nobody adds it back.

The limit at 0.2 ‰ gets an etched red band from 0.2 to the top of the dial, and a labelled tick — the marked operating range a real gauge has. Label it `0.2` with a `‰` on the dial face.

Accessibility, matching `BuzzMeter`: the SVG carries `role="img"` and an `aria-label` naming the reading in words, since the needle position is not readable text.

- [ ] **Step 2: The chart**

Create `src/components/charts/BloodAlcoholChart.tsx` by mirroring `src/components/charts/BloodCaffeineChart.tsx`. Read that file first. Same two-series-over-one-array trick so solid and dashed meet at `now`, same `AXIS_STYLE` and `ANNOTATION_STYLE`, same real time axis, same `isAnimationActive={false}`.

Changes:

```tsx
  const series = data.map((point) => ({
    at: point.at,
    measured: point.projected ? null : point.bac,
    projected: point.projected || point.at === now.getTime() ? point.bac : null,
  }))
```

The Y axis shows two decimals, so `allowDecimals` must be `true` and the formatter explicit:

```tsx
        <YAxis
          tick={AXIS_STYLE}
          stroke="var(--color-chart-grid)"
          tickLine={false}
          width={44}
          tickFormatter={(value: number) => value.toFixed(1)}
          domain={[0, (max: number) => Math.max(0.4, Math.ceil(max * 10) / 10)]}
        />
```

The domain floor matters: an evening of two beers peaks around 0.3, and a y-axis auto-scaled to the data would draw that as a dramatic mountain. A floor of 0.4 keeps small nights looking small.

The reference line is the legal limit, not a personal threshold — it takes `--color-scald` rather than the recessive `--color-oat` the caffeine chart uses for its sleep rule, because unlike a sleep threshold it is not a preference:

```tsx
        <ReferenceLine
          y={DRIVING_LIMIT_PERMILLE}
          stroke="var(--color-scald)"
          strokeDasharray="2 4"
          label={{
            value: '0.2 ‰ · legal limit',
            position: 'insideTopRight',
            ...ANNOTATION_STYLE,
            fill: 'var(--color-scald)',
          }}
        />
```

Keep the `now` rule exactly as the caffeine chart has it.

- [ ] **Step 3: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: clean. These are unreferenced components until Task 8, so there is nothing to run yet.

- [ ] **Step 4: Commit**

```bash
git add src/components/BacMeter.tsx src/components/charts/BloodAlcoholChart.tsx
git commit -m "Draw the blood alcohol gauge and curve"
```

---

### Task 8: The party panel

**Files:**
- Create: `src/components/PartyPanel.tsx`
- Modify: `src/app/(app)/actions.ts` (add two alcohol actions)

**Interfaces:**
- Consumes: `ActiveAlcoholType`, `UndoableAlcoholDrink` from `@/server/alcohol`; `BacMeter`; `formatUnits`, `bacStatus`, `bacHeadline`, `formatPermille` from `@/lib/alcohol`.
- Produces:
  - `logAlcoholAction(slug: string, time?: string): Promise<ActionResult>` from `@/app/(app)/actions`
  - `undoLastAlcoholAction(): Promise<ActionResult>` from `@/app/(app)/actions`
  - `<PartyPanel todayGrams bac profilePersonal favourites undoable />`

- [ ] **Step 1: The server actions**

Append to `src/app/(app)/actions.ts`, reusing `ActionResult`, `resolveConsumedAt` and the existing error-shape convention:

```ts
/* -------------------------------------------------------------------------- */
/* Party mode                                                                */
/* -------------------------------------------------------------------------- */

const logAlcoholSchema = z.object({
  slug: z.string().min(1).max(64),
  time: z.string().max(5).optional(),
})

/**
 * Log one alcoholic drink, optionally at an earlier time today.
 *
 * A sibling of `logDrinkAction` rather than a parameter on it: they write to
 * different tables and mean different things, and a `kind` flag would put a
 * branch in the one action that must never write a beer into `drink_logs`.
 */
export async function logAlcoholAction(slug: string, time?: string): Promise<ActionResult> {
  const member = await requireMember()

  const parsed = logAlcoholSchema.safeParse({ slug, time })
  if (!parsed.success) {
    return { ok: false, message: "That drink isn't available." }
  }

  const when = resolveConsumedAt({ time: parsed.data.time })
  if (!when.ok) {
    return {
      ok: false,
      message:
        when.reason === 'future-time' ? "That time hasn't happened yet." : 'Use a time like 21:15.',
    }
  }

  const result = await logAlcoholDrink(db, {
    userId: member.userId,
    slug: parsed.data.slug,
    consumedAt: when.consumedAt,
  })

  if (!result.ok) {
    return { ok: false, message: "That drink isn't available any more." }
  }

  refresh()
  return { ok: true, message: null }
}

/** Take back the most recent alcoholic drink, if it is still in the window. */
export async function undoLastAlcoholAction(): Promise<ActionResult> {
  const member = await requireMember()
  const result = await undoLastAlcoholDrink(db, { userId: member.userId })

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === 'nothing-to-undo'
          ? 'Nothing to undo yet.'
          : 'That drink is too old to undo.',
    }
  }

  refresh()
  return { ok: true, message: null }
}
```

Add to the imports at the top of the file:

```ts
import { logAlcoholDrink, undoLastAlcoholDrink } from '@/server/alcohol'
```

- [ ] **Step 2: The panel**

Create `src/components/PartyPanel.tsx`. Mirror `LogDrinkPanel`: `useOptimistic` on the grams total so the readout moves on the tap, `useTransition` for pending, an inline error line, the earlier-time control, and the undo affordance. Read `LogDrinkPanel` first and follow its structure.

The optimistic value is **grams and the unit count only, never the permille figure.** Grams are a sum the client can do; a BAC is a replayed simulation, and guessing it optimistically would mean the needle jumping to a number the server then contradicts. The gauge shows the server's reading and moves on refresh. Put that in a comment — it is the one place this panel deliberately differs from its sibling.

```tsx
'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { logAlcoholAction, undoLastAlcoholAction } from '@/app/(app)/actions'
import { BacMeter } from '@/components/BacMeter'
import { bacHeadline, bacStatus, formatPermille, formatUnits } from '@/lib/alcohol'
import type { ActiveAlcoholType, UndoableAlcoholDrink } from '@/server/alcohol'

const HEADLINE_TONE = {
  clear: 'text-oat',
  'over-limit': 'text-crema',
  heavy: 'text-scald',
} as const
```

The panel's body, in order:

1. `<BacMeter bac={bac} />` beside the readout, laid out exactly as `LogDrinkPanel` lays out `BuzzMeter` (`flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8`).
2. The readout: legend `Right now · ‰`, the permille in `display text-7xl leading-none tracking-tighter text-foam`, then `bacHeadline(bac)` in `HEADLINE_TONE[bacStatus(bac)]`, then `formatUnits(optimisticGrams)` and the drink count as a smaller line.
3. **The disclaimer, in the panel and not in a footnote.** Required by the spec. Exact copy:

```tsx
          <p className="pt-1 text-xs leading-relaxed text-scald">
            An estimate from {profilePersonal ? 'your figures' : 'an average adult'} and a guessed
            strength — not a breathalyser, and never a reason to decide you can drive.
          </p>
```

When `profilePersonal` is false, follow it with a link to settings, matching how the caffeine chart's footnote links there:

```tsx
          {!profilePersonal && (
            <p className="text-xs leading-relaxed text-oat">
              Set your weight in{' '}
              <Link href="/settings" className="underline decoration-hairline underline-offset-2">
                settings
              </Link>{' '}
              and this uses your body instead of an 80 kg average.
            </p>
          )}
```

4. The button grid, in the same `border-t border-hairline bg-roast/40 p-4` footer as `LogDrinkPanel`, one drink per button. **No `VolumePicker`** — alcohol servings are already standardised, so the button is the whole control and the row is simpler than the caffeine one. Each button shows the drink name and its unit count (`formatUnits(type.alcoholGrams)` trimmed to just the number) rather than grams: nobody thinks in grams of ethanol.

Use `--color-zap` for the alcohol buttons' border and background tint (`border-zap-dim`, `bg-zap/10`, `hover:bg-zap/15`), which distinguishes them at a glance from the crema-toned coffee buttons.

5. The earlier-time control and the undo button, copied from `LogDrinkPanel` — including `osloClockNow()`, which must be duplicated or lifted; **lift it into `src/lib/format.ts` as `osloClockNow()` and import it in both**, since two copies of a timezone-formatting helper is exactly the drift the codebase avoids elsewhere.

Props:

```tsx
export function PartyPanel({
  todayGrams,
  drinkCount,
  bac,
  profilePersonal,
  drinkTypes,
  undoable,
}: {
  todayGrams: number
  drinkCount: number
  /** The server's reading. Never optimistic — see the comment above. */
  bac: number
  /** False when the estimate used population figures rather than the member's. */
  profilePersonal: boolean
  drinkTypes: ActiveAlcoholType[]
  undoable: UndoableAlcoholDrink | null
}) {
```

- [ ] **Step 3: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Add the party panel"
```

---

### Task 9: Wire party mode into the dashboard, and announce it

**Files:**
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/lib/patch-notes.ts`
- Test: `src/lib/patch-notes.test.ts` (check whether it asserts a note count)
- Modify: `README.md`

**Interfaces:**
- Consumes: everything from Tasks 2-8.
- Produces: the finished feature.

- [ ] **Step 1: Read the current page**

`src/app/(app)/page.tsx` fetches nine things in one `Promise.all`. The alcohol reads join that call — not a second awaited block, which would serialise two round trips for no reason.

- [ ] **Step 2: Add the alcohol reads**

Below the existing caffeine `lookback`, add the alcohol window and reads. Party mode gates the *queries*, not just the markup: a member with it off must pay nothing for it.

```tsx
  const alcoholLookback = alcoholCurveWindow([], now, member.bodyProfile).from
```

Import with aliases, since both modules export `curveWindow`:

```tsx
import {
  bacAt,
  bloodAlcoholCurve,
  curveWindow as alcoholCurveWindow,
  drivingOutlook,
} from '@/lib/blood-alcohol'
```

Add to the `Promise.all` array, conditionally:

```tsx
      member.partyMode ? listActiveAlcoholTypes(db) : Promise.resolve([]),
      member.partyMode ? getUndoableAlcoholDrink(db, { userId: member.userId }) : Promise.resolve(null),
      member.partyMode ? getUserAlcoholToday(db, member.userId, { now }) : Promise.resolve({ totalGrams: 0, drinkCount: 0 }),
      member.partyMode
        ? getUserAlcoholEvents(db, member.userId, { from: alcoholLookback, now })
        : Promise.resolve([]),
```

Then, after the caffeine curve is built:

```tsx
  // Party mode's own curve. Its window and reading come from one `now` for the
  // same reason the caffeine ones do.
  const alcoholDoses = alcoholEvents.map((event) => ({
    consumedAt: event.consumedAt,
    grams: event.alcoholGrams,
  }))
  const alcoholBounds = alcoholCurveWindow(alcoholDoses, now, member.bodyProfile)
  const bacCurve = bloodAlcoholCurve(alcoholDoses, {
    ...alcoholBounds,
    now,
    profile: member.bodyProfile,
  })
  const bacNow = bacAt(alcoholDoses, now, member.bodyProfile)
```

- [ ] **Step 3: Render the section**

After the last existing block in the returned fragment, and before the closing `</>`:

```tsx
      {member.partyMode && (
        <section className="space-y-4 border-t border-hairline pt-6" aria-labelledby="party-heading">
          <div className="space-y-1">
            <p className="legend" id="party-heading">
              Party mode
            </p>
            <h2 className="display text-2xl leading-tight tracking-tight text-foam">
              The other kind of buzz
            </h2>
          </div>

          <PartyPanel
            todayGrams={alcoholToday.totalGrams}
            drinkCount={alcoholToday.drinkCount}
            bac={bacNow}
            profilePersonal={member.bodyProfile.personal}
            drinkTypes={alcoholTypes}
            undoable={undoableAlcohol}
          />

          {alcoholDoses.length > 0 && (
            <ChartFrame
              legend="Permille · in your blood"
              title="Blood alcohol tonight"
              columns={['Blood alcohol (‰)', 'Measured or projected']}
              rows={bacCurve
                .filter((_, index) => index % 6 === 0)
                .map((point) => ({
                  label: formatOsloClock(point.at),
                  values: [point.bac.toFixed(2), point.projected ? 'Projected' : 'Measured'],
                }))}
              footnote={<>{soberFootnote(drivingOutlook(alcoholDoses, now, member.bodyProfile))}</>}
            >
              <BloodAlcoholChart data={bacCurve} now={now} />
            </ChartFrame>
          )}
        </section>
      )}

      <PartyModeToggle on={member.partyMode} />
```

The toggle sits **outside** the conditional, so it is reachable in both states.

- [ ] **Step 4: The footnote helper**

Beside `outlookFootnote` at the top of the file, mirroring its shape:

```tsx
/** The sentence under the alcohol curve, which is the point of that chart. */
function soberFootnote(outlook: ReturnType<typeof drivingOutlook>): string {
  switch (outlook.kind) {
    case 'clear':
      return 'Nothing on board on this estimate. It is still an estimate.'
    case 'clears':
      return `Down to nothing around ${formatOsloClock(outlook.at)} — hours later than you will feel fine, which is the point of drawing it.`
    case 'not-tonight':
      return 'Still not clear twelve hours from now.'
  }
}
```

- [ ] **Step 5: The patch note**

Prepend a new note to `PATCH_NOTES` in `src/lib/patch-notes.ts`. It must be **first in the array** — `LATEST_PATCH_NOTE` reads `PATCH_NOTES[0].id` and `unseenPatchNotes` filters by `id >`, so an out-of-order entry breaks both.

```ts
  {
    id: '2026-08-28',
    title: 'Fleks, and a party mode',
    items: [
      'Buzz is the Fleks team’s now, and the name at the top says so.',
      'There is a party mode. Switch it on at the bottom of your dashboard and you get a second set of buttons for beer, wine and spirits, with a gauge and a curve for what is in your blood rather than what is in your stomach.',
      'It is modelled on Widmark, which is the arithmetic every breathalyser calibration argument is about, and it will be wrong. It does not know what you actually poured, whether you had dinner, or how your liver is feeling. It is never a reason to decide you can drive.',
      'Blood alcohol depends on the size of the body it is in, unlike milligrams of caffeine. Settings will take your weight if you want the estimate to be about you rather than about an average 80 kg adult — both optional, and the readout says which one it used.',
      'None of it touches the caffeine leaderboard. A beer is not a drink as far as your rank, your streak or the team charts are concerned.',
    ],
  },
```

- [ ] **Step 6: Check the patch-notes test**

Run: `npx vitest run src/lib/patch-notes.test.ts`

If it asserts a note count or a specific `LATEST_PATCH_NOTE`, update the expectation.

- [ ] **Step 7: Update the README**

In "What it does", after the "Editable drink types" bullet:

```markdown
- **Party mode.** Off by default, and a button switches it on. Alcohol gets the
  same treatment caffeine does — one-tap logging, a gauge, a curve — modelled
  with Widmark rather than a half-life, because alcohol clears at a constant
  rate rather than an exponential one. It never enters a caffeine statistic.
```

In "How it's put together", add to the tree:

```
  lib/blood-alcohol.ts  Widmark, simulated: zero-order elimination
  server/alcohol.ts  Party-mode logging, deliberately no rollup
```

Add a fifth decision to "Four decisions worth knowing" — and change the heading to "Five":

```markdown
**Alcohol is a parallel path, not a drink category.** Sharing `drink_logs`
would put a beer into every aggregate in `stats.ts` as a zero-milligram row.
Two tables that never meet is cheaper than a filter on every query. There is no
`daily_totals` equivalent either: the rollup exists for all-time leaderboards,
and party mode has none.
```

Update the test count in the "Tests" section to whatever `npm test` reports.

- [ ] **Step 8: Run everything**

```bash
npm test && npm run typecheck && npm run lint
```

Expected: all green.

- [ ] **Step 9: Verify in the browser**

Start the dev server through the preview tooling (`.claude/launch.json` defines `ovio-buzz-dev`), then:

1. Load `/`. Party mode is off: confirm the section is absent and only the toggle shows.
2. Press the toggle. The section appears with a gauge reading 0.00 ‰.
3. Log a pint. The unit count moves immediately; after the refresh the gauge is still near zero — **this is correct**, absorption takes 30-45 minutes, and it is the single most likely thing to be misread as a bug.
4. Check the console and the server log are clean.
5. Set a weight in settings, return, and confirm the disclaimer switches from "an average adult" to "your figures".
6. Press the toggle again and confirm the section goes away.
7. Screenshot the panel with party mode on.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "Turn party mode on from the dashboard"
```

---

## Self-review notes

Checked against the spec:

- Model, storage, no-rollup, member columns, server module, UI components, settings, Fleks rename, patch note — each has a task.
- `formatOsloClock` already exists in `lib/format.ts`; `osloClockNow` is currently private to `LogDrinkPanel` and Task 8 lifts it, which is the one refactor of existing code in this plan.
- Both modules export `curveWindow`; Task 9 aliases the alcohol one at the import. Watch for this — it is the likeliest compile error.
- `AlcoholDose.grams` (the model) and `alcoholLogs.alcoholGrams` (the row) are deliberately different names; Task 9 maps between them.
- The spec's `getUserAlcoholToday` returns `{ totalGrams, drinkCount }`, matching Task 5's interface block and Task 8's props.
