import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'turso',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? 'file:local.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
