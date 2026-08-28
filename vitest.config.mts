import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Resolves the "@/*" alias from tsconfig.json natively.
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./vitest.globalSetup.ts'],
  },
})
