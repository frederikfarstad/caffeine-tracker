'use server'

import { eq } from 'drizzle-orm'
import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { drinkTypes } from '@/db/schema'
import { requireAdmin } from '@/server/auth'

export type AdminFormState = { error: string | null; notice: string | null }

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, 'Give the drink a name.').max(60),
  caffeineMg: z.coerce
    .number()
    .int('Caffeine must be a whole number of milligrams.')
    .min(0, 'Caffeine cannot be negative.')
    .max(1000, 'That is more caffeine than any single drink contains.'),
  isActive: z.coerce.boolean(),
})

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, 'Give the drink a short id.')
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only.'),
  name: z.string().trim().min(1, 'Give the drink a name.').max(60),
  category: z.enum(['coffee', 'energy', 'other']),
  volumeMl: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(5000)])
    .transform((value) => (value === '' ? null : value)),
  caffeineMg: z.coerce.number().int().min(0).max(1000),
})

/**
 * Change a drink's name, caffeine estimate, or availability.
 *
 * Editing the caffeine value affects future logs only — existing rows keep the
 * value they were recorded with, so history never moves under anyone's feet.
 */
export async function updateDrinkType(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin()

  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    caffeineMg: formData.get('caffeineMg'),
    isActive: formData.get('isActive') === 'on',
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, notice: null }
  }

  const { id, name, caffeineMg, isActive } = parsed.data
  await db.update(drinkTypes).set({ name, caffeineMg, isActive }).where(eq(drinkTypes.id, id))

  refresh()
  return { error: null, notice: `Saved ${name}. New logs will use ${caffeineMg} mg.` }
}

export async function createDrinkType(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin()

  const parsed = createSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    category: formData.get('category'),
    volumeMl: formData.get('volumeMl') ?? '',
    caffeineMg: formData.get('caffeineMg'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, notice: null }
  }

  const existing = await db
    .select({ id: drinkTypes.id })
    .from(drinkTypes)
    .where(eq(drinkTypes.slug, parsed.data.slug))

  if (existing.length > 0) {
    return { error: `The id "${parsed.data.slug}" is already taken.`, notice: null }
  }

  await db.insert(drinkTypes).values({ ...parsed.data, sortOrder: 100 })

  refresh()
  return { error: null, notice: `Added ${parsed.data.name}.` }
}
