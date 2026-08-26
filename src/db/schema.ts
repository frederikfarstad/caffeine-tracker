import { relations } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
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
    localDate: text('local_date').notNull(),
    localHour: integer('local_hour').notNull(),
  },
  (table) => [
    index('drink_logs_user_date_idx').on(table.userId, table.localDate),
    index('drink_logs_date_idx').on(table.localDate),
    // Supports the "undo my most recent drink" lookup.
    index('drink_logs_user_recent_idx').on(table.userId, table.consumedAt),
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
