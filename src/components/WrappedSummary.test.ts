import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WrappedSummary } from './WrappedSummary'
import type { Wrapped } from '@/server/wrapped'

function wrapped(over: Partial<Wrapped> = {}): Wrapped {
  return {
    month: '2026-07',
    totalMg: 445,
    drinkCount: 4,
    coffeeCount: 3,
    energyCount: 1,
    activeDays: 3,
    longestStreak: 3,
    rank: 1,
    memberCount: 2,
    biggestDay: { localDate: '2026-07-04', mg: 255 },
    favourite: { name: 'Coffee', count: 3 },
    peakHour: 9,
    badgeIds: [],
    teamMg: 508,
    ...over,
  }
}

const render = (value: Wrapped) =>
  renderToStaticMarkup(createElement(WrappedSummary, { wrapped: value }))

describe('WrappedSummary', () => {
  it('shows the totals, the rank and the streak', () => {
    const html = render(wrapped())

    expect(html).toContain('445')
    expect(html).toContain('1 of 2')
    expect(html).toContain('3 days logged')
  })

  it('names the favourite drink and the biggest day', () => {
    const html = render(wrapped())

    expect(html).toContain('Coffee · 3 of them')
    expect(html).toContain('04.07')
  })

  it('pads the peak hour to a clock', () => {
    expect(render(wrapped({ peakHour: 9 }))).toContain('09:00')
  })

  it('works out the share of the office', () => {
    // 445 of 508 is 88%.
    expect(render(wrapped())).toContain('88%')
  })

  it('does not divide by zero when the team logged nothing', () => {
    expect(render(wrapped({ totalMg: 0, teamMg: 0 }))).toContain('0%')
  })

  it('leaves out the rows it has no answer for', () => {
    const html = render(wrapped({ favourite: null, peakHour: null, biggestDay: null }))

    expect(html).not.toContain('Your drink')
    expect(html).not.toContain('Your hour')
    expect(html).not.toContain('Biggest day')
  })

  it('lists badges earned in the month, and omits the section when there are none', () => {
    expect(render(wrapped({ badgeIds: ['first-drop'] }))).toContain('First drop')
    expect(render(wrapped({ badgeIds: [] }))).not.toContain('Earned in')
  })
})
