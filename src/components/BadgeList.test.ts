import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BadgeList, BadgeRow } from './BadgeList'
import { BADGES, type BadgeContext, type BadgeId } from '@/lib/badges'

const CONTEXT: BadgeContext = {
  localHour: null,
  days: [{ localDate: '2026-08-26', count: 40 }],
  distinctTypeCount: 3,
  today: '2026-08-26',
}

const row = (badgeIds: BadgeId[], max?: number) =>
  renderToStaticMarkup(createElement(BadgeRow, { badgeIds, max }))

const list = (earned: BadgeId[]) =>
  renderToStaticMarkup(createElement(BadgeList, { earned, context: CONTEXT }))

describe('BadgeRow', () => {
  it('renders nothing for a member with no badges', () => {
    expect(row([])).toBe('')
  })

  it('names the badges it shows', () => {
    expect(row(['first-drop'])).toContain('First drop')
  })

  it('counts the overflow rather than hiding it', () => {
    const html = row(['first-drop', 'century', 'dawn-patrol', 'night-shift', 'four-shots'], 3)

    expect(html).toContain('+2')
    expect(html).not.toContain('Four in a day')
  })
})

describe('BadgeList', () => {
  it('counts what is earned against what exists', () => {
    expect(list(['first-drop'])).toContain(`1 of ${BADGES.length}`)
  })

  it('shows progress for an unearned counting badge', () => {
    // 40 drinks in the context, so century is 40/100.
    expect(list([])).toContain('40/100')
  })

  it('shows no progress for a badge that is not a count', () => {
    const html = list([])
    expect(html).toContain('Dawn patrol')
    expect(html).not.toContain('0/0')
  })

  it('puts earned badges before unearned ones', () => {
    const html = list(['clean-sweep'])
    expect(html.indexOf('Clean sweep')).toBeLessThan(html.indexOf('First drop'))
  })

  it('never advertises a badge for passing the daily reference', () => {
    expect(list([])).not.toContain('400')
  })
})
