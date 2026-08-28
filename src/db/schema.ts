import { relations } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { AlcoholCategory } from '@/lib/alcohol'
import type { DrinkCategory } from '@/lib/caffeine'

/* -------------------------------------------------------------------------- */
/* Auth.js tables                                                             */
/*                                                                            */
/* Column names and types are fixed by @auth/drizzle-adapter. Sessions live   */
/* in a JWT rather than the database, so the session table is created for     */
/* adapter compatibility but never read on a normal request — which also      */
/* keeps Turso row-reads down.                                                */
/* -------------------------------------------------------------------------- */

export const users = sqliteTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: integer('emailVerified', { mode: 'timestamp_ms' }),
  image: text('image'),
})

export const accounts = sqliteTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<'oauth' | 'oidc' | 'email' | 'webauthn'>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
)

export const sessions = sqliteTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
})

export const verificationTokens = sqliteTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
  },
  (token) => [primaryKey({ columns: [token.identifier, token.token] })],
)

/* -------------------------------------------------------------------------- */
/* Application tables                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Membership is the access grant.
 *
 * A signed-in Google account with no row here has not entered the team join
 * code yet, so "is this person allowed in?" stays a single predicate rather
 * than a check scattered across routes.
 */
export const members = sqliteTable('members', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull(),

  /* ---------------------------------------------------------------------- */
  /* Personal settings, all with the population defaults the app shipped    */
  /* with, so an untouched account behaves exactly as it did before.        */
  /* ---------------------------------------------------------------------- */

  /**
   * How fast this person clears caffeine.
   *
   * Minutes rather than hours so the column stays an integer while the form
   * still accepts 5.5. The several-fold spread between individuals is the whole
   * reason this is a setting: one hardcoded figure is wrong for most people.
   */
  eliminationHalfLifeMinutes: integer('elimination_half_life_minutes')
    .notNull()
    .default(300),
  /** The load below which this person reckons caffeine won't cost them sleep. */
  sleepThresholdMg: integer('sleep_threshold_mg').notNull().default(50),
  /** `HH:MM` in {@link APP_TIMEZONE}, for "how late can I have a coffee". */
  bedtimeLocal: text('bedtime_local').notNull().default('23:00'),
  /**
   * The newest patch note this person has seen, or null for someone who
   * predates the feature. Server-side rather than in localStorage so the notes
   * follow the account across devices instead of firing once per browser.
   */
  lastSeenPatchNote: text('last_seen_patch_note'),

  /* ---------------------------------------------------------------------- */
  /* Party mode. All optional, all off or absent by default, so an untouched */
  /* account behaves exactly as it did before the feature existed.           */
  /* ---------------------------------------------------------------------- */

  /**
   * Whether this member has switched party mode on.
   *
   * A column rather than a URL parameter or localStorage: the toggle has to
   * survive `LiveRefresh`, a nav click and a second device, and a
   * server-rendered section that appears only after hydration flashes.
   */
  partyMode: integer('party_mode', { mode: 'boolean' }).notNull().default(false),
  /**
   * Body weight in kilograms, or null.
   *
   * Optional, unlike the caffeine settings, because the alcohol model has a
   * defensible population fallback — and requiring a weight in order to use the
   * feature at all would be a poor trade. See `lib/blood-alcohol.ts`.
   */
  bodyWeightKg: integer('body_weight_kg'),
  /**
   * Used for exactly one thing: choosing Widmark's distribution ratio, which
   * differs because the fraction of the body that is water does. Nothing else
   * reads it, and it is never displayed.
   */
  sex: text('sex').$type<'male' | 'female'>(),
})

/**
 * The drinks that can be logged, with editable caffeine estimates.
 *
 * Editing `caffeineMg` affects future logs only — see `drinkLogs.caffeineMg`.
 */
export const drinkTypes = sqliteTable('drink_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').$type<DrinkCategory>().notNull(),
  /** Serving size in millilitres, or null where it isn't meaningful. */
  volumeMl: integer('volume_ml'),
  caffeineMg: integer('caffeine_mg').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  /**
   * Who added it, for the drinks members contribute themselves.
   *
   * Null for the seeded types and for anyone since deleted — a drink outlives
   * the person who added it, because logs still point at it.
   */
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
})

/**
 * One row per drink consumed. The source of truth.
 *
 * `caffeineMg` is a snapshot of the drink type's value at the moment of
 * logging, deliberately not a join. Drink types are editable, and joining
 * would silently rewrite history the moment someone tuned coffee from 95mg to
 * 100mg.
 *
 * `localDate` and `localHour` are resolved in Europe/Oslo at write time by
 * `lib/time.ts:localBuckets`, because SQLite has no timezone database.
 */
export const drinkLogs = sqliteTable(
  'drink_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    drinkTypeId: integer('drink_type_id')
      .notNull()
      .references(() => drinkTypes.id),
    caffeineMg: integer('caffeine_mg').notNull(),
    category: text('category').$type<DrinkCategory>().notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * When the row was written, which is not when the drink was drunk: a drink
     * can be logged for a time earlier in the day.
     *
     * The undo window measures from here. Keyed off `consumedAt` instead, a
     * coffee backdated to breakfast would arrive already too old to take back.
     */
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * The volume actually drunk, when it differed from the drink type's.
     *
     * Null means "the standard serving". Recorded so history can explain
     * itself: without it a 400ml mug shows up as a milligram figure matching no
     * drink in the list.
     */
    volumeMl: integer('volume_ml'),
    localDate: text('local_date').notNull(),
    localHour: integer('local_hour').notNull(),
  },
  (table) => [
    index('drink_logs_user_date_idx').on(table.userId, table.localDate),
    index('drink_logs_date_idx').on(table.localDate),
    // Supports the "undo my most recent drink" lookup, which orders by write
    // time so that backdating cannot hide the row you just added.
    index('drink_logs_user_recent_idx').on(table.userId, table.createdAt),
  ],
)

/**
 * Per-user, per-day rollup, maintained in the same transaction as each write.
 *
 * Turso bills rows *scanned*, so aggregating leaderboards straight from
 * `drinkLogs` would make every all-time query scan every drink ever logged —
 * cheap now, linearly worse forever. Reading days instead of drinks keeps that
 * cost flat.
 *
 * Derived data: `drinkLogs` remains authoritative and this table can be
 * rebuilt from it at any time by `db/rebuild-rollup.ts`.
 */
export const dailyTotals = sqliteTable(
  'daily_totals',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    totalMg: integer('total_mg').notNull().default(0),
    coffeeMg: integer('coffee_mg').notNull().default(0),
    energyMg: integer('energy_mg').notNull().default(0),
    otherMg: integer('other_mg').notNull().default(0),
    coffeeCount: integer('coffee_count').notNull().default(0),
    energyCount: integer('energy_count').notNull().default(0),
    otherCount: integer('other_count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.localDate] }),
    index('daily_totals_date_idx').on(table.localDate),
  ],
)

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
/* party mode answers that by not offering an all-time period at all. Every    */
/* query it does make is bounded by `local_date` — one member's evening, or at */
/* most a month across the team — which the indexes below already serve.       */
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
 * REAL, not a rounded integer. At an average body one gram is about 0.02 ‰ — a
 * tenth of the legal limit — so rounding each dose would put visible error on
 * the one number the gauge exists to show.
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
    /**
     * When the row was written, which is not when the drink was drunk. The undo
     * window measures from here, so backdating cannot hide a fresh mistap.
     */
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    localDate: text('local_date').notNull(),
    localHour: integer('local_hour').notNull(),
  },
  (table) => [
    index('alcohol_logs_user_date_idx').on(table.userId, table.localDate),
    // The leaderboard asks about a date range across every member, so it cannot
    // use an index led by `user_id`. Mirrors `drink_logs_date_idx`.
    index('alcohol_logs_date_idx').on(table.localDate),
    index('alcohol_logs_user_recent_idx').on(table.userId, table.createdAt),
  ],
)

/* -------------------------------------------------------------------------- */
/* Relations                                                                 */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ one, many }) => ({
  member: one(members, { fields: [users.id], references: [members.userId] }),
  drinkLogs: many(drinkLogs),
}))

export const membersRelations = relations(members, ({ one }) => ({
  user: one(users, { fields: [members.userId], references: [users.id] }),
}))

export const drinkLogsRelations = relations(drinkLogs, ({ one }) => ({
  user: one(users, { fields: [drinkLogs.userId], references: [users.id] }),
  drinkType: one(drinkTypes, {
    fields: [drinkLogs.drinkTypeId],
    references: [drinkTypes.id],
  }),
}))

export const alcoholLogsRelations = relations(alcoholLogs, ({ one }) => ({
  user: one(users, { fields: [alcoholLogs.userId], references: [users.id] }),
  drinkType: one(alcoholDrinkTypes, {
    fields: [alcoholLogs.drinkTypeId],
    references: [alcoholDrinkTypes.id],
  }),
}))

/**
 * Failed join-code attempts, for rate limiting.
 *
 * Keyed by user id rather than IP or a cookie: reaching the join form already
 * requires a signed-in Google account, so this is the one identifier an
 * attacker cannot clear by wiping browser state.
 */
export const joinAttempts = sqliteTable('join_attempts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  attempts: integer('attempts').notNull().default(0),
  windowStartedAt: integer('window_started_at', { mode: 'timestamp_ms' }).notNull(),
})
