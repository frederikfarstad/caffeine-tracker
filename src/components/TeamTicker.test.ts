import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TeamTicker } from './TeamTicker'
import type { TeamActivityEvent } from '@/server/stats'

const NOW = new Date('2026-08-26T13:00:00Z')

function event(over: Partial<TeamActivityEvent>): TeamActivityEvent {
  return {
    id: 1,
    userId: 'ada',
    displayName: 'Ada',
    drinkName: 'Coffee',
    caffeineMg: 95,
    volumeMl: null,
    consumedAt: NOW,
    ...over,
  }
}

function render(events: TeamActivityEvent[]) {
  return renderToStaticMarkup(createElement(TeamTicker, { events, now: NOW }))
}

describe('TeamTicker markup', () => {
  it('renders nothing at all when there is no recent activity', () => {
    expect(render([])).toBe('')
  })

  it('names the person, the drink and how long ago', () => {
    const html = render([
      event({ id: 1, consumedAt: new Date(NOW.getTime() - 4 * 60_000) }),
      event({ id: 2, displayName: 'Bo', drinkName: 'Energy 0.5L', volumeMl: 500,
        consumedAt: new Date(NOW.getTime() - 3 * 3_600_000) }),
    ])

    expect(html).toContain('Ada')
    expect(html).toContain('Coffee')
    expect(html).toContain('4 min ago')
    expect(html).toContain('Bo')
    expect(html).toContain('500 ml')
    expect(html).toContain('3 h ago')
  })

  it('omits the volume when the drink was a standard serving', () => {
    expect(render([event({ volumeMl: null })])).not.toContain('ml')
  })
})
