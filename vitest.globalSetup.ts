import fs from 'node:fs'
import { TEST_DB_DIR } from './src/db/test-db'

/** Start every run from an empty scratch directory. */
export default function setup() {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEST_DB_DIR, { recursive: true })

  return () => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
  }
}
