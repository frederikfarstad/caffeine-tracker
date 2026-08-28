import { migrate } from 'drizzle-orm/libsql/migrator'
import path from 'node:path'
import type { Db } from './index'

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'src/db/migrations')

/**
 * Apply pending migrations.
 *
 * Deliberately run through the ORM rather than `drizzle-kit migrate`: the same
 * call works against a local file, a hosted Turso database and an in-memory
 * test database, whereas drizzle-kit's turso dialect insists on an auth token
 * that a local file has no use for.
 */
export async function applyMigrations(database: Db) {
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER })
}
