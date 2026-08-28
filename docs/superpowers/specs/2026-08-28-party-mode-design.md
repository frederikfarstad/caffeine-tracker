# Party mode: alcohol tracking alongside caffeine

Status: approved 2026-08-28

## Why

Buzz answers "how much caffeine is in me" well. On a Friday the office asks the
same question about a different drug, and the answer has the same shape: doses
over an evening, a curve, and a time it clears. The machinery to answer it —
local-date bucketing, snapshot doses, an optimistic one-tap panel, a gauge — all
exists. What does not exist is the pharmacology, which is genuinely different.

Alcohol is a side thing, deliberately. It appears only on the personal
dashboard, only for members who switch it on, and it touches none of the
caffeine statistics.

## Scope

In:

- Log alcoholic drinks in one tap, with a ten-minute undo.
- A blood alcohol curve for the evening, with a "sober by" reading.
- A gauge, marked at Norway's 0.2 permille driving limit.
- Party mode as a per-member setting, off by default.
- Optional body weight and sex in settings, for a personal Widmark estimate.
- Team copy changes from "Ovio and Teoria" to "Fleks".

Out, deliberately:

- No alcohol leaderboard, team page or all-time statistics.
- No volume picker. Alcohol servings are already standardised; the seeded list
  covers them, and a slider would invite precision the ABV estimate cannot back.
- No edit-history list for alcohol logs. Undo covers the mistap.
- Alcohol never enters `drink_logs`, `daily_totals`, rank, streak or any
  existing chart.

## The model: `lib/blood-alcohol.ts`

Widmark, simulated rather than solved.

Caffeine is eliminated first-order, so `blood-caffeine.ts` can sum an
independent closed-form curve per dose. Alcohol is eliminated **zero-order** —
a constant fall of about 0.15 permille per hour, clamped at zero — and that
breaks superposition. Two drinks an hour apart do not produce the sum of two
single-drink curves, because the shared clearance rate does not scale with how
much is present and cannot take the blood below zero. There is no useful closed
form, so the module steps forward instead.

State is two variables, stepped at one-minute resolution:

    absorbed = gut * (1 - exp(-k_abs * dt))     first-order, 12 min half-life
    gut     -= absorbed
    bac     += absorbed / (r * weightKg)         Widmark distribution
    bac      = max(0, bac - beta * dt)           constant, clamped at zero

The simulation always begins from a sober body just before the earliest dose,
regardless of where the chart's window starts. Seeding the stepper at the
window's left edge would invent a sober body mid-evening — the one bug this
shape of model is prone to, and the reason the start is not a parameter.

Constants, with the same "estimates, not measurements" honesty as the caffeine
module:

- `ELIMINATION_PERMILLE_PER_HOUR = 0.15` — the usual figure for adults; the real
  spread is roughly 0.10 to 0.20.
- `ABSORPTION_HALF_LIFE_MS = 12 min` — puts the peak 30 to 45 minutes after the
  drink, which matches an average stomach. Food slows it considerably; not
  modelled, and said so in the UI.
- `ETHANOL_DENSITY = 0.789` g/ml, for grams from volume and ABV.
- `DRIVING_LIMIT_PERMILLE = 0.2` — Norway's legal limit, and the marked line on
  the gauge. Plays the role EFSA's 400 mg plays for caffeine: a published
  reference, not personal advice.

### Profile and the fallback

    type BodyProfile = { weightKg: number; widmarkRatio: number; personal: boolean }

`personal` is false when the member has not given weight or sex, in which case
the profile is 80 kg and r = 0.615 — the midpoint of the conventional 0.68
(male) and 0.55 (female) ratios. The UI must say which of the two it used: an
impersonal estimate presented as a personal one is the failure mode that
matters here.

### Public surface

- `bodyProfileFrom(member)` — row to profile, applying the fallback.
- `bloodAlcoholCurve(doses, { from, to, now, profile })` — `CurvePoint[]`,
  mirroring the caffeine module's shape so the chart component can too.
- `bacAt(doses, instant, profile)`
- `soberAt(doses, { from, profile, threshold })` — first instant at or below a
  threshold, or null beyond the horizon.
- `curveWindow(doses, now, profile)` — same padding rules as caffeine.
- `drivingOutlook(doses, now, profile)` — `clear` / `clears at` /
  `not-tonight`, the one-line answer.

## Storage

### `alcohol_drink_types`

`id`, `slug` (unique), `name`, `category`
(`beer | wine | spirits | cider | other`), `volume_ml` (not null),
`abv_percent` (real, not null), `is_active`, `sort_order`, `created_by`.

Volume and ABV are both required, unlike `drink_types.volume_ml`: grams of
alcohol is `volume_ml * abv_percent/100 * 0.789`, so a type missing either
cannot produce a dose at all.

`abv_percent` is REAL rather than an integer of tenths. The integer-with-a-unit
trick elsewhere in the schema (`elimination_half_life_minutes`) exists so a form
can accept 5.5 while the column stays whole; here 4.7 is simply what an ABV is,
and tenths would only push the conversion into every read.

### `alcohol_logs`

`id`, `user_id`, `drink_type_id`, `alcohol_grams` (real, snapshot),
`category`, `volume_ml`, `consumed_at`, `created_at`, `local_date`,
`local_hour`. Indexed on `(user_id, local_date)` and `(user_id, created_at)`.

`alcohol_grams` is a snapshot for the same reason `drink_logs.caffeine_mg` is:
ABV estimates are editable and a join would rewrite last Friday. `volume_ml`
and `category` are snapshotted beside it on the same argument — with no picker
they always equal the type's current values today, but they are what lets a
past evening explain itself without joining to a type someone has since
retuned.

Grams are REAL, not rounded integers. At 80 kg and r = 0.615, one gram is about
0.02 permille — a tenth of the driving limit. Rounding each dose would put
visible error on the one number the gauge exists to show.

### No rollup

`daily_totals` exists because all-time leaderboards would otherwise scan every
drink ever logged. Party mode has no all-time query: the dashboard reads one
member's last day or two, bounded by `local_date` on the existing index shape.
A rollup would be four more arithmetic paths to keep in sync for no saving.

### `members` additions

- `party_mode` integer boolean, default false.
- `body_weight_kg` integer, nullable.
- `sex` text, nullable, `male | female`.

`sex` is used for nothing but the Widmark ratio, and is commented as such. Both
personal fields are optional and the model works without them.

Migration `0006_party_mode`. Plain `ALTER TABLE ADD COLUMN` for the three
member columns; `CREATE TABLE` for the two new tables, written with
`ON DELETE set null` on `created_by` and `ON DELETE cascade` on `user_id`
directly rather than through drizzle-kit's output, for the reason recorded in
`0005`.

## Server: `server/alcohol.ts`

Mirrors `server/drinks.ts`, minus the rollup and minus edit/delete:

- `listActiveAlcoholTypes(db)`
- `logAlcoholDrink(db, { userId, slug, consumedAt, now })`
- `undoLastAlcoholDrink(db, { userId, now })` — same 10-minute window,
  ordered by `created_at`.
- `getUndoableAlcoholDrink(db, { userId, now })`
- `getUserAlcoholEvents(db, userId, { from, now })` — doses for the curve.
- `getUserAlcoholToday(db, userId, { now })` — grams and count for the readout.

`resolveConsumedAt` is reused from `drinks.ts` rather than duplicated.

Seeded types: pint 0.5 L 4.7%, bottle 0.33 L 4.7%, can 0.5 L 4.7%, wine glass
150 ml 12%, spirit 4 cl 40%, cider 0.33 L 4.5%.

## UI

The caffeine dashboard is untouched. The alcohol section appends after it.

- `components/PartyPanel.tsx` — the alcohol hero. Optimistic grams, one-tap
  buttons, undo. Mirrors `LogDrinkPanel`.
- `components/BacMeter.tsx` — the gauge. Same dial language as `BuzzMeter`,
  scale 0 to 2.0 permille, 0.2 marked. Mirrors `BuzzMeter`.
- `components/charts/BloodAlcoholChart.tsx` — solid to now, dashed ahead.
- `components/PartyModeToggle.tsx` — a quiet footer button posting to a server
  action.

The panel carries a flat, unmissable line: this is an estimate from an average
body and a guessed ABV, it is not a breathalyser, and it is never a reason to
drive. That belongs in the panel, not in a footnote — a permille readout is
read as a driving decision whether or not it is labelled as one.

## Settings

`server/settings.ts` gains weight and sex to `parseSettings`, both optional
(empty clears them). Bounds: 35 to 250 kg. The settings page grows a second
section, framed as opt-in and explaining exactly what it changes.

## Copy: Fleks

Every "Ovio and Teoria" becomes "Fleks": `app/(app)/layout.tsx` header eyebrow,
`app/layout.tsx` metadata, `app/manifest.ts`, `app/signin/page.tsx`,
`app/privacy/page.tsx`, `app/(app)/team/page.tsx`, `README.md`, `SETUP.md`.
The layout comment explaining why two team names sit above the wordmark stops
being true with one name and goes.

A patch note dated `2026-08-28` announces the rename and party mode.

## Testing

TDD on the two pure modules, which carry the risk.

`lib/blood-alcohol.test.ts`:
- BAC reaches exactly zero and stays there (the clamp), rather than decaying
  asymptotically.
- Elimination is linear: equal falls over equal intervals once absorption is
  done.
- Peak lands 30 to 45 minutes after a single drink.
- Superposition does not hold — two drinks an hour apart differ from the sum of
  two single-drink curves.
- The curve is independent of the window: the same instant reads the same
  whether the window starts before or after the first drink.
- The fallback profile is used when weight and sex are absent, and a heavier
  member reaches a lower peak on the same drinks.
- `soberAt` returns null past the horizon rather than a fabricated time.

`lib/alcohol.test.ts`: grams from volume and ABV, unit formatting, limit states.

`server/alcohol.test.ts`, against a real libSQL file like `drinks.test.ts`:
- grams snapshotted at log time and unaffected by a later ABV edit.
- undo scoped to the caller, and refused past the window.
- `local_date` and `local_hour` resolved in Oslo, including across a DST edge.
- alcohol logs leave `drink_logs` and `daily_totals` completely untouched.
