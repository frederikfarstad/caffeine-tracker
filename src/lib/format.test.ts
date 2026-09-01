import { describe, expect, it } from 'vitest'
import { formatAgo, formatDayTick, formatOsloClock, formatWeekday } from './format'

describe('formatDayTick', () => {
  it('renders day before month, Norwegian order', () => {
    expect(formatDayTick('2026-08-26')).toBe('26.08')
  })
})

describe('formatWeekday', () => {
  it('labels 1 through 7 as Monday through Sunday', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(formatWeekday)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ])
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

describe('formatAgo', () => {
  const now = new Date('2026-08-26T13:00:00Z')

  function ago(ms: number) {
    return formatAgo(new Date(now.getTime() - ms), now)
  }

  it('calls anything under a minute "just now"', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59_000)).toBe('just now')
  })

  it('counts whole minutes up to an hour', () => {
    expect(ago(60_000)).toBe('1 min ago')
    expect(ago(4 * 60_000 + 30_000)).toBe('4 min ago')
    expect(ago(59 * 60_000)).toBe('59 min ago')
  })

  it('switches to whole hours at sixty minutes', () => {
    expect(ago(60 * 60_000)).toBe('1 h ago')
    expect(ago(90 * 60_000)).toBe('1 h ago')
    expect(ago(3 * 60 * 60_000)).toBe('3 h ago')
  })

  it('treats an instant in the future as now, rather than counting backwards', () => {
    expect(formatAgo(new Date(now.getTime() + 5_000), now)).toBe('just now')
  })

  it('accepts epoch milliseconds, like the other formatters here', () => {
    expect(formatAgo(now.getTime() - 120_000, now.getTime())).toBe('2 min ago')
  })
})
