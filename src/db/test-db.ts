import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import fs from 'node:fs'
import path from 'node:path'
import { MIGRATIONS_FOLDER } from './migrator'
import * as schema from './schema'

/**
 * Where per-suite test databases live. Wiped before each run by
 * `vitest.globalSetup.ts`.
 */
export const TEST_DB_DIR = path.join(process.cwd(), '.tmp-test')

let counter = 0

/**
 * A fresh, isolated database for one test.
 *
 * Deliberately a file rather than `:memory:`. `@libsql/client` opens a separate
 * connection to run a transaction, and a second connection to `:memory:` is a
 * different, empty database — so anything under test that uses a transaction
 * would silently see no tables.
 *
 * Turso runs the same libSQL engine, so these tests exercise the real SQL with
 * no container and no network.
 */
export async function createTestDb() {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true })
  const file = path.join(TEST_DB_DIR, `${process.pid}-${counter++}.db`)

  const client = createClient({ url: `file:${file}` })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return db
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>
