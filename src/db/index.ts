import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

function connectionConfig() {
  const url = process.env.TURSO_DATABASE_URL

  if (!url) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. Copy .env.example to .env.local — ' +
        'use "file:local.db" for local development.',
    )
  }

  // A local file database needs no token; a hosted Turso database does.
  return { url, authToken: process.env.TURSO_AUTH_TOKEN || undefined }
}

/**
 * Reuse one client across hot reloads in development.
 *
 * Without this, every edit leaks a connection until the dev server is
 * restarted.
 */
const globalForDb = globalThis as unknown as {
  libsqlClient?: ReturnType<typeof createClient>
}

const client = globalForDb.libsqlClient ?? createClient(connectionConfig())

if (process.env.NODE_ENV !== 'production') {
  globalForDb.libsqlClient = client
}

export const db = drizzle(client, { schema })

export type Db = typeof db
export { schema }
