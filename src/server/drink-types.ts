import { asc } from 'drizzle-orm'
import type { Db } from '@/db'
import { drinkTypes } from '@/db/schema'
import type { TestDb } from '@/db/test-db'
import type { DrinkCategory } from '@/lib/caffeine'

type AnyDb = Db | TestDb

/** Matches the column, and keeps a slug short enough to read in a URL. */
const MAX_SLUG_LENGTH = 40

/** Where member-added drinks sort: after everything seeded. */
const MEMBER_SORT_ORDER = 100

/**
 * Norwegian letters, which do not decompose into a base letter plus an accent
 * the way é does. Stripping them would turn "Øl" into an empty slug, so they
 * transliterate the way Norwegian itself does when latinising.
 */
const TRANSLITERATIONS: Record<string, string> = {
  æ: 'ae',
  ø: 'oe',
  å: 'aa',
  ð: 'd',
  þ: 'th',
  ß: 'ss',
}

/**
 * A machine id derived from the name, rather than one a person has to invent.
 *
 * Members should never see a slug field: it exists so URLs and the log action
 * have something stable to name a drink by, which is not their problem. The
 * admin form keeps its explicit field for the cases where the id matters.
 *
 * @param taken Slugs already in use, so a collision gets a numeric suffix
 *   rather than a database error.
 */
export function deriveSlug(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[æøåðþß]/g, (letter) => TRANSLITERATIONS[letter] ?? letter)
      // Split accented letters into letter + combining mark, then drop the marks.
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, MAX_SLUG_LENGTH)
      .replace(/_+$/, '') || 'drink'

  if (!taken.includes(base)) return base

  for (let suffix = 2; ; suffix++) {
    // Trim the base so the suffix cannot push the slug past the column length.
    const tail = `_${suffix}`
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - tail.length).replace(/_+$/, '')}${tail}`
    if (!taken.includes(candidate)) return candidate
  }
}

export type AddDrinkTypeInput = {
  name: string
  category: DrinkCategory
  caffeineMg: number
  volumeMl: number | null
  /** The member adding it, or null for the admin form and the seeds. */
  createdBy: string | null
}

export type AddDrinkTypeResult =
  | { ok: true; id: number; slug: string }
  | { ok: false; reason: 'duplicate-name' | 'invalid' }

/**
 * Add a drink to the shared catalogue.
 *
 * Shared by the admin page and the member-facing form, because the rules are
 * the same either way and only the permission differs.
 *
 * An exact name match is refused, so thirty people cannot end up with four
 * Coffees. Near-duplicates — "Latte" beside "Cafe latte" — are deliberately
 * allowed: telling them apart needs a human, and admins can already deactivate.
 */
export async function addDrinkType(
  db: AnyDb,
  input: AddDrinkTypeInput,
): Promise<AddDrinkTypeResult> {
  const name = input.name.trim()
  if (!name) return { ok: false, reason: 'invalid' }

  const existing = await db
    .select({ slug: drinkTypes.slug, name: drinkTypes.name })
    .from(drinkTypes)
    .orderBy(asc(drinkTypes.id))

  const clash = existing.some((row) => row.name.trim().toLowerCase() === name.toLowerCase())
  if (clash) return { ok: false, reason: 'duplicate-name' }

  const slug = deriveSlug(name, existing.map((row) => row.slug))

  const [created] = await db
    .insert(drinkTypes)
    .values({
      slug,
      name,
      category: input.category,
      caffeineMg: input.caffeineMg,
      volumeMl: input.volumeMl,
      createdBy: input.createdBy,
      sortOrder: MEMBER_SORT_ORDER,
    })
    .returning({ id: drinkTypes.id })

  return { ok: true, id: created.id, slug }
}
