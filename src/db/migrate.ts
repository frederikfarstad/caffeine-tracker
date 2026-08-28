import { db } from './index'
import { applyMigrations } from './migrator'

applyMigrations(db)
  .then(() => {
    console.log('Migrations applied.')
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
