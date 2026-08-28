import { describe, expect, it } from 'vitest'
import { isPartyTime } from './party-time'

/*
 * Every instant here is written in UTC and annotated with the Oslo wall clock
 * it lands on, because that is the thing under test. Summer is UTC+2 and winter
 * UTC+1, so the same UTC hour is a different Oslo hour depending on the month —
 * which is the whole reason this goes through `lib/time.ts` rather than
 * reading `getDay()` and `getHours()` off a Date.
 */

describe('isPartyTime', () => {
  it('is false across the working week', () => {
    // Mon–Thu, all at 20:00 Oslo — well past four in the afternoon, and still
    // not Friday.
    expect(isPartyTime(new Date('2026-08-24T18:00:00Z'))).toBe(false)
    expect(isPartyTime(new Date('2026-08-25T18:00:00Z'))).toBe(false)
    expect(isPartyTime(new Date('2026-08-26T18:00:00Z'))).toBe(false)
    expect(isPartyTime(new Date('2026-08-27T18:00:00Z'))).toBe(false)
  })

  it('is false on a Friday that is still a work day', () => {
    // 09:00 and 15:59 Oslo on Friday the 28th.
    expect(isPartyTime(new Date('2026-08-28T07:00:00Z'))).toBe(false)
    expect(isPartyTime(new Date('2026-08-28T13:59:00Z'))).toBe(false)
  })

  it('turns on at four on Friday afternoon', () => {
    // 16:00 Oslo exactly.
    expect(isPartyTime(new Date('2026-08-28T14:00:00Z'))).toBe(true)
  })

  it('stays on through Friday evening', () => {
    // 23:00 Oslo.
    expect(isPartyTime(new Date('2026-08-28T21:00:00Z'))).toBe(true)
  })

  it('stays on into Saturday morning, because an evening crosses midnight', () => {
    // 01:00 and 03:00 Oslo on Saturday the 29th.
    expect(isPartyTime(new Date('2026-08-28T23:00:00Z'))).toBe(true)
    expect(isPartyTime(new Date('2026-08-29T01:00:00Z'))).toBe(true)
  })

  it('is off again by four on Saturday morning', () => {
    // 04:00 Oslo.
    expect(isPartyTime(new Date('2026-08-29T02:00:00Z'))).toBe(false)
  })

  it('is false for the rest of the weekend', () => {
    // Saturday 14:00 and Sunday 20:00 Oslo. Saturday night is somebody else's
    // problem — this reorders the work week, not every evening.
    expect(isPartyTime(new Date('2026-08-29T12:00:00Z'))).toBe(false)
    expect(isPartyTime(new Date('2026-08-30T18:00:00Z'))).toBe(false)
  })

  it('reads the Oslo clock rather than UTC, so winter behaves like summer', () => {
    // Friday 30 January 2026, when Oslo is UTC+1 rather than UTC+2.
    // 15:59 Oslo is still work; 16:00 Oslo is not.
    expect(isPartyTime(new Date('2026-01-30T14:59:00Z'))).toBe(false)
    expect(isPartyTime(new Date('2026-01-30T15:00:00Z'))).toBe(true)
    // 03:00 Oslo on the Saturday.
    expect(isPartyTime(new Date('2026-01-31T02:00:00Z'))).toBe(true)
  })

  /*
   * The bug this guards against: reading the weekday off UTC. At 00:30 Oslo on
   * Saturday it is still Friday in UTC, so a UTC-based check would answer
   * "Friday, hour 22" — accidentally right here, and wrong at 01:00 on a
   * Saturday in January for the opposite reason. Pinning the boundary hour
   * catches it.
   */
  it('does not confuse the UTC date with the Oslo one at the boundary', () => {
    // 23:30 UTC Friday is 01:30 Oslo Saturday: on.
    expect(isPartyTime(new Date('2026-08-28T23:30:00Z'))).toBe(true)
    // 02:30 UTC Saturday is 04:30 Oslo Saturday: off.
    expect(isPartyTime(new Date('2026-08-29T02:30:00Z'))).toBe(false)
  })
})
