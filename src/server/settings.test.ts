import { describe, expect, it } from 'vitest'
import { parseSettings } from './settings'

/**
 * The form's own defaults, which every account starts on.
 *
 * The two body fields are empty rather than absent: empty is what an untouched
 * form submits, and it is a valid answer for them where it is not for the
 * caffeine numbers.
 */
const valid = {
  halfLifeHours: '5',
  sleepThresholdMg: '50',
  bedtimeLocal: '23:00',
  bodyWeightKg: '',
  sex: '',
}

describe('parseSettings', () => {
  it('accepts the defaults', () => {
    expect(parseSettings(valid)).toEqual({
      ok: true,
      settings: {
        eliminationHalfLifeMinutes: 300,
        sleepThresholdMg: 50,
        bedtimeLocal: '23:00',
        bodyWeightKg: null,
        sex: null,
      },
    })
  })

  // Half-lives are quoted in hours and half-hours in the literature, so the
  // form has to accept 5.5 while the column stays an integer.
  it('converts fractional hours to whole minutes', () => {
    const parsed = parseSettings({ ...valid, halfLifeHours: '5.5' })
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.settings.eliminationHalfLifeMinutes).toBe(330)
  })

  /*
   * Everyone using this is on a Norwegian keyboard, where the decimal separator
   * is a comma. `input[type=number]` normalises its value for us in principle,
   * but only when the browser accepts what was typed — and this costs one line
   * to stop being a class of bug.
   */
  it('accepts a comma as the decimal separator', () => {
    const parsed = parseSettings({ ...valid, halfLifeHours: '5,5' })
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.settings.eliminationHalfLifeMinutes).toBe(330)
  })

  it('rounds a half-life that lands between minutes', () => {
    const parsed = parseSettings({ ...valid, halfLifeHours: '4.005' })
    if (!parsed.ok) throw new Error('unreachable')
    expect(Number.isInteger(parsed.settings.eliminationHalfLifeMinutes)).toBe(true)
  })

  it('accepts the published extremes of adult clearance', () => {
    expect(parseSettings({ ...valid, halfLifeHours: '2.5' })).toMatchObject({ ok: true })
    expect(parseSettings({ ...valid, halfLifeHours: '10' })).toMatchObject({ ok: true })
  })

  // Outside 2-12h the curve stops describing a human, and a zero would divide
  // by zero in the model.
  it('rejects an implausible half-life', () => {
    for (const halfLifeHours of ['0', '-5', '1', '24', 'soon', '']) {
      expect(parseSettings({ ...valid, halfLifeHours })).toMatchObject({ ok: false })
    }
  })

  it('rejects a threshold outside the useful range', () => {
    for (const sleepThresholdMg of ['0', '-1', '5', '400', 'low', '']) {
      expect(parseSettings({ ...valid, sleepThresholdMg })).toMatchObject({ ok: false })
    }
  })

  it('accepts the ends of the threshold range', () => {
    expect(parseSettings({ ...valid, sleepThresholdMg: '10' })).toMatchObject({ ok: true })
    expect(parseSettings({ ...valid, sleepThresholdMg: '200' })).toMatchObject({ ok: true })
  })

  it('rejects a malformed bedtime', () => {
    for (const bedtimeLocal of ['25:00', '11pm', '23:60', '7:00', '', '2300']) {
      expect(parseSettings({ ...valid, bedtimeLocal })).toMatchObject({ ok: false })
    }
  })

  it('accepts a bedtime after midnight', () => {
    expect(parseSettings({ ...valid, bedtimeLocal: '01:30' })).toMatchObject({ ok: true })
  })

  it('explains the first problem it finds', () => {
    const parsed = parseSettings({ ...valid, halfLifeHours: '99' })
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.message).toMatch(/hours/i)
  })
})

describe('parseSettings — the body fields', () => {
  it('treats both as optional', () => {
    const parsed = parseSettings({ ...valid, bodyWeightKg: '', sex: '' })
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.settings.bodyWeightKg).toBeNull()
    expect(parsed.settings.sex).toBeNull()
  })

  it('accepts a weight and a sex', () => {
    const parsed = parseSettings({ ...valid, bodyWeightKg: '72', sex: 'female' })
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.settings.bodyWeightKg).toBe(72)
    expect(parsed.settings.sex).toBe('female')
  })

  // Same Norwegian-keyboard reasoning as the half-life field above.
  it('accepts a comma as the decimal separator, and rounds to a whole kilogram', () => {
    const parsed = parseSettings({ ...valid, bodyWeightKg: '72,5' })
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.settings.bodyWeightKg).toBe(73)
  })

  it('refuses a weight outside the range the model can describe', () => {
    expect(parseSettings({ ...valid, bodyWeightKg: '5' })).toMatchObject({ ok: false })
    expect(parseSettings({ ...valid, bodyWeightKg: '400' })).toMatchObject({ ok: false })
  })

  it('accepts the bounds themselves', () => {
    expect(parseSettings({ ...valid, bodyWeightKg: '35' })).toMatchObject({ ok: true })
    expect(parseSettings({ ...valid, bodyWeightKg: '250' })).toMatchObject({ ok: true })
  })

  it('refuses a sex it does not have a ratio for', () => {
    expect(parseSettings({ ...valid, sex: 'yes' })).toMatchObject({ ok: false })
  })

  it('still refuses a bad half-life when the body fields are fine', () => {
    expect(
      parseSettings({ ...valid, halfLifeHours: '99', bodyWeightKg: '72', sex: 'male' }),
    ).toMatchObject({ ok: false })
  })
})
