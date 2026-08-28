import { asc } from 'drizzle-orm'
import { DrinkTypeRow } from '@/components/admin/DrinkTypeRow'
import { NewDrinkTypeForm } from '@/components/admin/NewDrinkTypeForm'
import { db } from '@/db'
import { drinkTypes } from '@/db/schema'
import { requireAdmin } from '@/server/auth'

export const metadata = { title: 'Drinks — Buzz' }

export default async function AdminPage() {
  await requireAdmin()

  const types = await db
    .select()
    .from(drinkTypes)
    .orderBy(asc(drinkTypes.sortOrder), asc(drinkTypes.id))

  return (
    <>
      <div>
        <p className="legend">Admin</p>
        <h1 className="display text-3xl leading-tight tracking-tight text-foam">
          Drinks and caffeine estimates
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-oat">
          Changing a caffeine value applies to new logs only. Everything already logged keeps the
          value it was recorded with, so past days and the leaderboard never shift underneath
          anyone.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {types.map((type) => (
          <DrinkTypeRow key={type.id} type={type} />
        ))}
      </div>

      <NewDrinkTypeForm />
    </>
  )
}
