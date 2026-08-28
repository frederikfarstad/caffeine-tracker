import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/db/test-db'
import { drinkTypes, users } from '@/db/schema'
import { DRINK_TYPE_SEEDS } from '@/db/seed-data'
import { addDrinkType, deriveSlug } from './drink-types'

describe('deriveSlug', () => {
  it('lowercases and joins words with underscores', () => {
    expect(deriveSlug('Oat latte', [])).toBe('oat_latte')
  })

  it('drops punctuation people type in drink names', () => {
    expect(deriveSlug('Cappuccino (double!)', [])).toBe('cappuccino_double')
    expect(deriveSlug('Coke Zero 0.5L', [])).toBe('coke_zero_0_5l')
  })

  // The team is Norwegian. Stripping these outright would turn "Øl" into
  // nothing at all, so they transliterate the way Norwegian does.
  it('transliterates Norwegian letters rather than dropping them', () => {
    expect(deriveSlug('Øl', [])).toBe('oel')
    expect(deriveSlug('Blåbær', [])).toBe('blaabaer')
    expect(deriveSlug('Kaffe å gå', [])).toBe('kaffe_aa_gaa')
  })

  it('strips accents from other latin letters', () => {
    expect(deriveSlug('Café crème', [])).toBe('cafe_creme')
  })

  it('collapses runs of separators and trims the ends', () => {
    expect(deriveSlug('  Iced   --  Coffee  ', [])).toBe('iced_coffee')
  })

  it('adds a suffix when the slug is taken', () => {
    expect(deriveSlug('Oat latte', ['oat_latte'])).toBe('oat_latte_2')
    expect(deriveSlug('Oat latte', ['oat_latte', 'oat_latte_2'])).toBe('oat_latte_3')
  })

  it('falls back to something usable when a name has no usable characters', () => {
    expect(deriveSlug('☕️', [])).toBe('drink')
    expect(deriveSlug('☕️', ['drink'])).toBe('drink_2')
  })

  it('keeps within the column length even for a long name', () => {
    const slug = deriveSlug('A ridiculously long drink name that nobody would ever type here', [])
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('_')).toBe(false)
  })
})

describe('addDrinkType', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
    await db.insert(users).values([
      { id: 'ada', name: 'Ada', email: 'ada@example.com' },
      { id: 'linn', name: 'Linn', email: 'linn@example.com' },
    ])
    await db.insert(drinkTypes).values(DRINK_TYPE_SEEDS)
  })

  it('adds a drink with a slug nobody had to invent', async () => {
    const result = await addDrinkType(db, {
      name: 'Oat latte',
      category: 'coffee',
      caffeineMg: 75,
      volumeMl: 250,
      createdBy: 'ada',
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('unreachable')

    const [row] = await db.select().from(drinkTypes).where(eq(drinkTypes.id, result.id))
    expect(row).toMatchObject({
      slug: 'oat_latte',
      name: 'Oat latte',
      category: 'coffee',
      caffeineMg: 75,
      volumeMl: 250,
      createdBy: 'ada',
      isActive: true,
    })
  })

  it('leaves volume null when nobody gave one', async () => {
    const result = await addDrinkType(db, {
      name: 'Drip coffee',
      category: 'coffee',
      caffeineMg: 95,
      volumeMl: null,
      createdBy: 'ada',
    })
    if (!result.ok) throw new Error('unreachable')

    const [row] = await db.select().from(drinkTypes).where(eq(drinkTypes.id, result.id))
    expect(row.volumeMl).toBeNull()
  })

  // Thirty people adding freely would otherwise end up with four Coffees.
  it('refuses a name that already exists, whatever the casing', async () => {
    const result = await addDrinkType(db, {
      name: 'coffee',
      category: 'coffee',
      caffeineMg: 90,
      volumeMl: null,
      createdBy: 'ada',
    })

    expect(result).toMatchObject({ ok: false, reason: 'duplicate-name' })
    expect(await db.select().from(drinkTypes)).toHaveLength(DRINK_TYPE_SEEDS.length)
  })

  it('refuses a name that differs only by surrounding space', async () => {
    const result = await addDrinkType(db, {
      name: '  Espresso  ',
      category: 'coffee',
      caffeineMg: 63,
      volumeMl: null,
      createdBy: 'ada',
    })
    expect(result).toMatchObject({ ok: false, reason: 'duplicate-name' })
  })

  it('gives a second drink a suffixed slug when names slugify the same', async () => {
    const first = await addDrinkType(db, {
      name: 'Iced coffee',
      category: 'coffee',
      caffeineMg: 80,
      volumeMl: null,
      createdBy: 'ada',
    })
    const second = await addDrinkType(db, {
      name: 'Iced Coffee!',
      category: 'coffee',
      caffeineMg: 90,
      volumeMl: null,
      createdBy: 'linn',
    })

    if (!first.ok || !second.ok) throw new Error('unreachable')
    const rows = await db.select().from(drinkTypes)
    const slugs = rows.map((row) => row.slug)

    expect(slugs).toContain('iced_coffee')
    expect(slugs).toContain('iced_coffee_2')
  })

  it('sorts member-added drinks after the seeded ones', async () => {
    const result = await addDrinkType(db, {
      name: 'Oat latte',
      category: 'coffee',
      caffeineMg: 75,
      volumeMl: null,
      createdBy: 'ada',
    })
    if (!result.ok) throw new Error('unreachable')

    const [row] = await db.select().from(drinkTypes).where(eq(drinkTypes.id, result.id))
    const seeded = Math.max(...DRINK_TYPE_SEEDS.map((seed) => seed.sortOrder))
    expect(row.sortOrder).toBeGreaterThan(seeded)
  })

  it('rejects a blank name', async () => {
    const result = await addDrinkType(db, {
      name: '   ',
      category: 'coffee',
      caffeineMg: 95,
      volumeMl: null,
      createdBy: 'ada',
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })
})
