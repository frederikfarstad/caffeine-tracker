import { describe, expect, it } from 'vitest'
import {
  APP_TIMEZONE,
  addLocalDays,
  bucketFor,
  enumerateLocalDates,
  instantFromLocalTime,
  localBuckets,
  nextLocalTimeAfter,
  localDateOf,
  periodToDateRange,
  weekdayOf,
} from './time'

describe('APP_TIMEZONE', () => {
  it('is Europe/Oslo', () => {
    expect(APP_TIMEZONE).toBe('Europe/Oslo')
  })
})

describe('localBuckets', () => {
  it('maps a plain winter afternoon to Oslo local time (UTC+1)', () => {
    // 13:30 UTC in January is 14:30 CET.
    expect(localBuckets(new Date('2026-01-15T13:30:00Z'))).toEqual({
      localDate: '2026-01-15',
      localHour: 14,
    })
  })

  it('maps a plain summer afternoon to Oslo local time (UTC+2)', () => {
    // 13:30 UTC in August is 15:30 CEST.
    expect(localBuckets(new Date('2026-08-26T13:30:00Z'))).toEqual({
      localDate: '2026-08-26',
      localHour: 15,
    })
  })

  // The whole reason local_date is stored rather than derived: the UTC date and
  // the Oslo date disagree for a couple of hours every single night.
  it('rolls to the next local date before UTC midnight in summer', () => {
    // 22:30 UTC on the 25th is already 00:30 on the 26th in Oslo.
    expect(localBuckets(new Date('2026-08-25T22:30:00Z'))).toEqual({
      localDate: '2026-08-26',
      localHour: 0,
    })
  })

  it('rolls to the next local date before UTC midnight in winter', () => {
    // 23:30 UTC on the 15th is 00:30 on the 16th in Oslo.
    expect(localBuckets(new Date('2026-01-15T23:30:00Z'))).toEqual({
      localDate: '2026-01-16',
      localHour: 0,
    })
  })

  it('reports hour 0, not hour 24, at local midnight', () => {
    // Exactly 00:00 local on a winter day.
    expect(localBuckets(new Date('2026-01-15T23:00:00Z')).localHour).toBe(0)
  })

  // Oslo springs forward at 02:00 local on the last Sunday of March 2026 (the
  // 29th), so local 02:00-02:59 does not exist that day.
  describe('spring-forward transition (2026-03-29)', () => {
    it('is still CET (UTC+1) immediately before the change', () => {
      expect(localBuckets(new Date('2026-03-29T00:59:00Z'))).toEqual({
        localDate: '2026-03-29',
        localHour: 1,
      })
    })

    it('jumps straight to 03:00 CEST (UTC+2) at the change', () => {
      expect(localBuckets(new Date('2026-03-29T01:00:00Z'))).toEqual({
        localDate: '2026-03-29',
        localHour: 3,
      })
    })
  })

  // Oslo falls back at 03:00 local on the last Sunday of October 2026 (the
  // 25th), so local 02:00-02:59 happens twice that day.
  describe('fall-back transition (2026-10-25)', () => {
    it('reports hour 2 on the first pass, while still CEST', () => {
      expect(localBuckets(new Date('2026-10-25T00:30:00Z'))).toEqual({
        localDate: '2026-10-25',
        localHour: 2,
      })
    })

    it('reports hour 2 again on the second pass, now CET', () => {
      expect(localBuckets(new Date('2026-10-25T01:30:00Z'))).toEqual({
        localDate: '2026-10-25',
        localHour: 2,
      })
    })

    it('keeps both passes on the same local date', () => {
      const first = localBuckets(new Date('2026-10-25T00:30:00Z'))
      const second = localBuckets(new Date('2026-10-25T01:30:00Z'))
      expect(first.localDate).toBe(second.localDate)
    })
  })
})

describe('weekdayOf', () => {
  it('treats Monday as 1 and Sunday as 7 (ISO numbering)', () => {
    expect(weekdayOf('2026-08-24')).toBe(1) // Monday
    expect(weekdayOf('2026-08-26')).toBe(3) // Wednesday
    expect(weekdayOf('2026-08-30')).toBe(7) // Sunday
  })
})

describe('addLocalDays', () => {
  it('adds and subtracts days', () => {
    expect(addLocalDays('2026-08-26', 1)).toBe('2026-08-27')
    expect(addLocalDays('2026-08-26', -1)).toBe('2026-08-25')
  })

  it('crosses month and year boundaries', () => {
    expect(addLocalDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addLocalDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('handles a leap day', () => {
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addLocalDays('2028-02-29', 1)).toBe('2028-03-01')
  })

  // Calendar arithmetic runs in UTC precisely so that a clock change cannot
  // shift a date by a day.
  it('is unaffected by the DST transitions', () => {
    expect(addLocalDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addLocalDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addLocalDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addLocalDays('2026-10-25', 1)).toBe('2026-10-26')
  })
})

describe('enumerateLocalDates', () => {
  it('includes both endpoints', () => {
    expect(enumerateLocalDates('2026-08-24', '2026-08-26')).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
    ])
  })

  it('returns a single date when the range is one day', () => {
    expect(enumerateLocalDates('2026-08-26', '2026-08-26')).toEqual(['2026-08-26'])
  })

  it('returns nothing when the range is inverted', () => {
    expect(enumerateLocalDates('2026-08-26', '2026-08-24')).toEqual([])
  })

  it('produces exactly 7 days for a week spanning the spring DST change', () => {
    const days = enumerateLocalDates('2026-03-23', '2026-03-29')
    expect(days).toHaveLength(7)
    expect(days.at(-1)).toBe('2026-03-29')
  })

  it('produces exactly 7 days for a week spanning the autumn DST change', () => {
    const days = enumerateLocalDates('2026-10-19', '2026-10-25')
    expect(days).toHaveLength(7)
    expect(days.at(-1)).toBe('2026-10-25')
  })
})

describe('periodToDateRange', () => {
  // A Wednesday, 15:30 Oslo time.
  const wednesday = new Date('2026-08-26T13:30:00Z')

  it('scopes "today" to the current local date', () => {
    expect(periodToDateRange('today', wednesday)).toEqual({
      from: '2026-08-26',
      to: '2026-08-26',
    })
  })

  it('starts "week" on Monday', () => {
    expect(periodToDateRange('week', wednesday)).toEqual({
      from: '2026-08-24',
      to: '2026-08-26',
    })
  })

  it('keeps a Monday as its own week start', () => {
    const monday = new Date('2026-08-24T10:00:00Z')
    expect(periodToDateRange('week', monday)).toEqual({
      from: '2026-08-24',
      to: '2026-08-24',
    })
  })

  it('keeps a Sunday in the week that began the previous Monday', () => {
    const sunday = new Date('2026-08-30T10:00:00Z')
    expect(periodToDateRange('week', sunday)).toEqual({
      from: '2026-08-24',
      to: '2026-08-30',
    })
  })

  it('starts "month" on the first of the local month', () => {
    expect(periodToDateRange('month', wednesday)).toEqual({
      from: '2026-08-01',
      to: '2026-08-26',
    })
  })

  it('leaves "all" open at the start', () => {
    expect(periodToDateRange('all', wednesday)).toEqual({
      from: null,
      to: '2026-08-26',
    })
  })

  it('uses the local date, not the UTC date, at the day boundary', () => {
    // 22:30 UTC is already the next day in Oslo, so "today" must be the 26th.
    const lateEvening = new Date('2026-08-25T22:30:00Z')
    expect(periodToDateRange('today', lateEvening)).toEqual({
      from: '2026-08-26',
      to: '2026-08-26',
    })
  })

  it('spans a week containing the spring DST change without drifting', () => {
    // 2026-03-29 is the Sunday the clocks go forward.
    const dstSunday = new Date('2026-03-29T12:00:00Z')
    const range = periodToDateRange('week', dstSunday)
    expect(range).toEqual({ from: '2026-03-23', to: '2026-03-29' })
    expect(enumerateLocalDates(range.from!, range.to)).toHaveLength(7)
  })

  it('spans a week containing the autumn DST change without drifting', () => {
    const dstSunday = new Date('2026-10-25T12:00:00Z')
    const range = periodToDateRange('week', dstSunday)
    expect(range).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(enumerateLocalDates(range.from!, range.to)).toHaveLength(7)
  })
})

describe('localDateOf', () => {
  it('is the date half of localBuckets', () => {
    expect(localDateOf(new Date('2026-08-25T22:30:00Z'))).toBe('2026-08-26')
  })
})

describe('bucketFor', () => {
  it('buckets today by hour so the chart shows the shape of a single day', () => {
    expect(bucketFor('today')).toBe('hour')
  })

  it('buckets longer periods by day', () => {
    expect(bucketFor('week')).toBe('day')
    expect(bucketFor('month')).toBe('day')
    expect(bucketFor('all')).toBe('day')
  })
})

describe('instantFromLocalTime', () => {
  it('resolves a winter wall-clock time at UTC+1', () => {
    expect(instantFromLocalTime('2026-01-15', '08:30')).toEqual(
      new Date('2026-01-15T07:30:00Z'),
    )
  })

  it('resolves a summer wall-clock time at UTC+2', () => {
    expect(instantFromLocalTime('2026-08-26', '08:30')).toEqual(
      new Date('2026-08-26T06:30:00Z'),
    )
  })

  // Local midnight is the previous UTC day, which is exactly the case a naive
  // `new Date('2026-08-26T00:00')` gets wrong on a server running in UTC.
  it('puts local midnight on the previous UTC day in summer', () => {
    expect(instantFromLocalTime('2026-08-26', '00:00')).toEqual(
      new Date('2026-08-25T22:00:00Z'),
    )
  })

  it('round-trips through localBuckets', () => {
    const instant = instantFromLocalTime('2026-08-26', '14:45')
    expect(localBuckets(instant)).toEqual({ localDate: '2026-08-26', localHour: 14 })
  })

  describe('spring-forward transition (2026-03-29)', () => {
    it('resolves the hour before the change as CET', () => {
      expect(instantFromLocalTime('2026-03-29', '01:30')).toEqual(
        new Date('2026-03-29T00:30:00Z'),
      )
    })

    it('resolves the hour after the change as CEST', () => {
      expect(instantFromLocalTime('2026-03-29', '03:30')).toEqual(
        new Date('2026-03-29T01:30:00Z'),
      )
    })

    // 02:30 never happens that day. Landing on 03:30 keeps the function total,
    // so a picker offering every hour cannot produce an invalid Date.
    it('shifts a local time that does not exist forward past the gap', () => {
      const instant = instantFromLocalTime('2026-03-29', '02:30')
      expect(localBuckets(instant)).toEqual({ localDate: '2026-03-29', localHour: 3 })
    })
  })

  describe('fall-back transition (2026-10-25)', () => {
    // 02:30 happens twice. Either is defensible; the later pass is pinned so
    // the choice is a decision rather than an accident.
    it('resolves an ambiguous local time to the later, CET pass', () => {
      expect(instantFromLocalTime('2026-10-25', '02:30')).toEqual(
        new Date('2026-10-25T01:30:00Z'),
      )
    })

    it('resolves an unambiguous time later that day as CET', () => {
      expect(instantFromLocalTime('2026-10-25', '12:00')).toEqual(
        new Date('2026-10-25T11:00:00Z'),
      )
    })
  })
})

describe('nextLocalTimeAfter', () => {
  // 10:00 Oslo on a Wednesday in summer.
  const morning = new Date('2026-08-26T08:00:00Z')

  it('is later the same day when the time has not come round yet', () => {
    expect(nextLocalTimeAfter('23:00', morning)).toEqual(instantFromLocalTime('2026-08-26', '23:00'))
  })

  it('rolls to tomorrow when the time has already passed today', () => {
    expect(nextLocalTimeAfter('07:00', morning)).toEqual(instantFromLocalTime('2026-08-27', '07:00'))
  })

  // A bedtime after midnight belongs to the night that is still coming, not to
  // the one that already happened.
  it('treats an after-midnight time as tomorrow', () => {
    expect(nextLocalTimeAfter('01:30', morning)).toEqual(instantFromLocalTime('2026-08-27', '01:30'))
  })

  it('rolls forward when the time is exactly now', () => {
    expect(nextLocalTimeAfter('10:00', morning)).toEqual(instantFromLocalTime('2026-08-27', '10:00'))
  })

  it('is always in the future', () => {
    for (const time of ['00:00', '06:30', '10:00', '12:00', '23:59']) {
      expect(nextLocalTimeAfter(time, morning).getTime()).toBeGreaterThan(morning.getTime())
    }
  })

  // The clock goes forward at 02:00 on 2026-03-29, so a 23:00 bedtime the night
  // before is still an ordinary 23:00 — the shift lands after it.
  it('handles a bedtime on the night the clocks change', () => {
    const saturdayEvening = new Date('2026-03-28T20:00:00Z') // 21:00 CET
    expect(nextLocalTimeAfter('23:00', saturdayEvening)).toEqual(
      instantFromLocalTime('2026-03-28', '23:00'),
    )
  })
})
