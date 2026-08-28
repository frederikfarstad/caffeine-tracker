import { describe, expect, it } from 'vitest'
import { LATEST_PATCH_NOTE, PATCH_NOTES, unseenPatchNotes } from './patch-notes'

describe('PATCH_NOTES', () => {
  it('is not empty', () => {
    expect(PATCH_NOTES.length).toBeGreaterThan(0)
  })

  it('is ordered newest first', () => {
    const ids = PATCH_NOTES.map((note) => note.id)
    expect(ids).toEqual([...ids].sort().reverse())
  })

  it('has unique ids', () => {
    expect(new Set(PATCH_NOTES.map((note) => note.id)).size).toBe(PATCH_NOTES.length)
  })

  it('names the newest note', () => {
    expect(LATEST_PATCH_NOTE).toBe(PATCH_NOTES[0].id)
  })

  it('gives every note something to say', () => {
    for (const note of PATCH_NOTES) {
      expect(note.title.length).toBeGreaterThan(0)
      expect(note.items.length).toBeGreaterThan(0)
    }
  })
})

describe('unseenPatchNotes', () => {
  it('is empty for someone already on the newest note', () => {
    expect(unseenPatchNotes(LATEST_PATCH_NOTE)).toEqual([])
  })

  it('is empty for an id newer than anything we know about', () => {
    expect(unseenPatchNotes('9999-99-99')).toEqual([])
  })

  // Someone who predates the feature. They get the newest note only rather
  // than a wall of history they were never around for.
  it('shows only the newest note to someone who has seen none', () => {
    expect(unseenPatchNotes(null)).toEqual([PATCH_NOTES[0]])
  })

  it('shows everything published since the note someone last saw', () => {
    const oldest = PATCH_NOTES.at(-1)!
    const unseen = unseenPatchNotes(oldest.id)

    expect(unseen).not.toContain(oldest)
    expect(unseen.every((note) => note.id > oldest.id)).toBe(true)
  })

  it('keeps newest-first order in what it returns', () => {
    const oldest = PATCH_NOTES.at(-1)!
    const ids = unseenPatchNotes(oldest.id).map((note) => note.id)

    expect(ids).toEqual([...ids].sort().reverse())
  })
})
