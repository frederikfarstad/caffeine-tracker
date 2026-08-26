import { describe, expect, it } from 'vitest'
import { formatDayTick, formatOsloClock } from './format'

describe('formatDayTick', () => {
  it('renders day before month, Norwegian order', () => {
    expect(formatDayTick('2026-08-26')).toBe('26.08')
  })
})

describe('formatOsloClock', () => {
  it('renders a summer instant at UTC+2', () => {
    expect(formatOsloClock(new Date('2026-08-26T08:00:00Z'))).toBe('10:00')
  })

  it('renders a winter instant at UTC+1', () => {
    expect(formatOsloClock(new Date('2026-01-15T08:00:00Z'))).toBe('09:00')
  })

  it('accepts epoch milliseconds, as the chart axis supplies them', () => {
    expect(formatOsloClock(new Date('2026-08-26T08:00:00Z').getTime())).toBe('10:00')
  })

  it('zero-pads both fields', () => {
    expect(formatOsloClock(new Date('2026-08-26T05:05:00Z'))).toBe('07:05')
  })

  it('renders local midnight as 00:00, not 24:00', () => {
    expect(formatOsloClock(new Date('2026-08-25T22:00:00Z'))).toBe('00:00')
  })
})
