import { describe, expect, it } from 'vitest'
import { formatMonth, isValidMonth, monthOf, monthRange, previousMonth } from './wrapped'

describe('monthOf', () => {
  it('takes the month off a local date', () => {
    expect(monthOf('2026-08-26')).toBe('2026-08')
  })
})

describe('previousMonth', () => {
  it('steps back one month', () => {
    expect(previousMonth('2026-08')).toBe('2026-07')
  })

  it('steps back across a year boundary', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
  })

  it('keeps the two-digit month padded', () => {
    expect(previousMonth('2026-10')).toBe('2026-09')
  })
})

describe('monthRange', () => {
  it('spans the whole month', () => {
    expect(monthRange('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('knows a thirty-day month', () => {
    expect(monthRange('2026-06').to).toBe('2026-06-30')
  })

  it('knows February in a leap year', () => {
    expect(monthRange('2024-02').to).toBe('2024-02-29')
  })

  it('knows February in a common year', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28')
  })
})

describe('formatMonth', () => {
  it('names the month and the year', () => {
    expect(formatMonth('2026-08')).toBe('August 2026')
  })

  it('names January, which is the index that is easiest to get wrong', () => {
    expect(formatMonth('2026-01')).toBe('January 2026')
  })

  it('names December, the other one', () => {
    expect(formatMonth('2026-12')).toBe('December 2026')
  })
})

describe('isValidMonth', () => {
  it('accepts a well-formed month', () => {
    expect(isValidMonth('2026-08')).toBe(true)
  })

  it('rejects rubbish, a bare year, and an impossible month', () => {
    expect(isValidMonth('nonsense')).toBe(false)
    expect(isValidMonth('2026')).toBe(false)
    expect(isValidMonth('2026-13')).toBe(false)
    expect(isValidMonth('2026-00')).toBe(false)
    expect(isValidMonth('2026-8')).toBe(false)
  })
})
