import { describe, expect, it } from 'vitest'
import { applyOptimisticListAction } from './optimisticList'

type Row = { id: number; name: string }

const rows: Row[] = [
  { id: 1, name: 'Coffee' },
  { id: 2, name: 'Espresso' },
  { id: 3, name: 'Energy drink' },
]

describe('applyOptimisticListAction', () => {
  it('removes the matching row and leaves the others untouched', () => {
    expect(applyOptimisticListAction(rows, { type: 'delete', id: 2 })).toEqual([
      { id: 1, name: 'Coffee' },
      { id: 3, name: 'Energy drink' },
    ])
  })

  it('is a no-op deleting an id that is not there', () => {
    expect(applyOptimisticListAction(rows, { type: 'delete', id: 999 })).toEqual(rows)
  })

  it('tags the matching row with the new time label and leaves the rest alone', () => {
    const result = applyOptimisticListAction(rows, { type: 'edit', id: 2, timeLabel: '09:15' })
    expect(result).toEqual([
      { id: 1, name: 'Coffee' },
      { id: 2, name: 'Espresso', optimisticTimeLabel: '09:15' },
      { id: 3, name: 'Energy drink' },
    ])
  })

  it('is a no-op editing an id that is not there', () => {
    expect(applyOptimisticListAction(rows, { type: 'edit', id: 999, timeLabel: '09:15' })).toEqual(rows)
  })
})
