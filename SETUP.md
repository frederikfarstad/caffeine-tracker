# Setting up Ovio Buzz

Three services need your credentials, so they can't be automated. Budget about
25 minutes for the lot. Everything is on a free tier — see
[Costs](#what-this-costs) at the end.

Work through this in order: Turso first, so you can run the app locally before
touching OAuth.

---

## 1. Turso (the database)

Turso is SQLite as a service. It bills rows read and storage — never time
awake — so nothing about leaving a tab open can cost you money.

**Install the CLI**

```bash
curl -sSfL https://tur.so/install.sh | bash
```

**Sign up and log in.** This opens a browser.

```bash
turso auth signup
```

**Create the database**

```bash
turso db create ovio-buzz
```

**Get the two values you need**

```bash
turso db show ovio-buzz --url
```

```bash
turso db tokens create ovio-buzz
```

Keep both. The first is `TURSO_DATABASE_URL`, the second is `TURSO_AUTH_TOKEN`.

---

## 2. Google OAuth

Free, no billing account, and no app-review process — you're only requesting
`email` and `profile`, which Google treats as non-sensitive.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project. Call it whatever you like.
2. Go to **APIs & Services → OAuth consent screen**.
   - User type: **External**.
   - Fill in the app name (`Ovio Buzz`), your email, and a developer contact.
   - On the Scopes step add nothing — the defaults are what you want.
   - Finish, then click **Publish app**. Leave it in Testing and only a
     manually-listed handful of accounts can sign in.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Under **Authorised redirect URIs**, add both:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://YOUR-VERCEL-DOMAIN/api/auth/callback/google`
   - Create, then copy the **Client ID** and **Client secret**.

> **Coworkers use personal Google accounts.** Nothing here touches Bekk's
> Microsoft tenant, so no IT ticket and no admin consent. Access is controlled
> by the team code instead, not by email domain.

> **Preview deploys won't sign in.** Vercel gives each preview a new URL, and
> Google only accepts redirect URIs registered in advance. Test auth on
> localhost and production. If you want working previews, set up a stable
> preview alias in Vercel and register that URL too.

---

## 3. Run it locally

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where it comes from |
|---|---|
| `TURSO_DATABASE_URL` | step 1, or `file:local.db` to work offline |
| `TURSO_AUTH_TOKEN` | step 1; leave empty for `file:local.db` |
| `AUTH_SECRET` | run `npx auth secret` |
| `AUTH_GOOGLE_ID` | step 2, Client ID |
| `AUTH_GOOGLE_SECRET` | step 2, Client secret |
| `TEAM_JOIN_CODE` | invent one, then share it in Slack |
| `ADMIN_EMAILS` | your own email, so you can edit drinks |

Create the tables and the starting drink types:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Start it:

```bash
npm run dev
```

Open http://localhost:3000, sign in with Google, enter your team code. Port
3000 matters here — it's the redirect URI you registered.

---

## 4. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import
   `frederikfarstad/caffeine-tracker`. Accept the detected Next.js defaults.
2. Before the first deploy, add all seven environment variables from the table
   above under **Environment Variables**. Use the Turso URL and token, not
   `file:local.db`.
3. Deploy. Then copy your production URL back into the Google Console as a
   redirect URI if you used a placeholder earlier.
4. Point the production database at the migrations once:

```bash
TURSO_DATABASE_URL="<your turso url>" TURSO_AUTH_TOKEN="<your token>" npx tsx src/db/migrate.ts
```

```bash
TURSO_DATABASE_URL="<your turso url>" TURSO_AUTH_TOKEN="<your token>" npx tsx src/db/seed.ts
```

Migrations run deliberately, not during `build` — builds fire on every preview
deploy, and you don't want schema changes riding along with them.

Share the URL and the join code in Slack. That's it.

---

## What this costs

Nothing, with room to spare. Modelled on 30 people logging 3 drinks and opening
the app 8 times each per working day:

| Limit | Free allowance | Estimated use |
|---|---|---|
| Turso rows read | 500M / month | ~4% |
| Turso rows written | 10M / month | <1% |
| Turso storage | 5 GB | <1% after a year |
| Vercel edge requests | 1M / month | ~14% |
| Vercel function CPU | 4 CPU-hours / month | ~13% |
| Vercel data transfer | 100 GB / month | ~3% |
| Google OAuth | unlimited | — |

At 100 people the tightest figures are Vercel edge requests (~44%) and function
CPU (~38%). Still free.

**Nothing here is metered by time.** That was the point of choosing Turso over a
serverless Postgres: no forgotten tab, idle period, or cold start can move these
numbers — only real usage does.

Two things to keep an eye on if you extend the app:

- **Don't remove the polling guards in `src/components/LiveRefresh.tsx`.**
  Vercel's 4 CPU-hour allowance is the smallest number in that table, and a few
  leaderboard tabs left open all day on an unguarded interval would eat ~70% of
  it on their own.
- **Keep aggregate queries on `daily_totals`.** Turso counts every row a query
  scans. Reading the raw `drink_logs` table for all-time totals would cost ~25%
  of the row-read allowance after a year and keep climbing.

If you did exceed a limit, both platforms degrade rather than invoice — Vercel
Hobby has no overage billing and Turso throttles. The failure mode is the app
going quiet, not a surprise bill.

**One licensing note.** Vercel's Hobby plan is for personal, non-commercial use.
A free internal tracker with no ads or payments sits within the spirit of that,
but if Ovio treats this as a company tool, the honest answer is Pro at
$20/month.
