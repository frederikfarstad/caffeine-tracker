/**
 * What changed, in the order it changed.
 *
 * A file rather than a table: notes ship with the deploy that introduces them,
 * so they belong in the same commit as the code they describe. Nobody has to
 * remember to write a row afterwards.
 *
 * `id` is a date, which makes ordering and comparison the same operation —
 * string comparison on `YYYY-MM-DD` sorts chronologically, so "is this newer
 * than what they last saw" needs no parsing.
 *
 * Written for the people using Buzz, not for the commit log: what they can now
 * do, not which files moved.
 */
export type PatchNote = {
  /** `YYYY-MM-DD`, and the marker stored against each member. */
  id: string
  title: string
  items: string[]
}

export const PATCH_NOTES: PatchNote[] = [
  /*
   * The first note, so it covers everything shipped since there was anything to
   * read. Every existing member is stored as having seen nothing, and
   * `unseenPatchNotes` shows them the newest note only — so anything left out
   * here is never announced to anyone.
   *
   * Ordered by what people will notice, not by what was hardest to build.
   */
  {
    id: '2026-08-27',
    title: 'Caffeine in your system, and your own numbers',
    items: [
      'Your dashboard now charts how much caffeine is actually in you, hour by hour, rather than only the total you have drunk today. Solid up to now, dashed for the projection ahead — a 300 mg morning and a 300 mg evening are the same total and a very different night.',
      'Settings hold your caffeine half-life, your sleep threshold and your usual bedtime, and the curve uses all three. The first version assumed everyone clears caffeine at the same rate, which is wrong for most people: smoking roughly halves it, and some medications double it.',
      'A "last call" reading tells you how late you could still have your usual drink and be under your threshold by bedtime. It accounts for a drink still being absorbed after you swallow it, so it will not wave you through a coffee at ten to eleven.',
      'Anyone can add a drink now, not just admins. Give it a name, a category and a caffeine estimate, and it appears for everyone — no need to ask.',
      'The drink buttons show the four you log most, with everything else behind a search. That keeps logging at one tap however long the list gets.',
      'Drank a bigger mug than usual? The "amount" control beside each drink scales the dose — a slider in millilitres where the drink has a serving size, and a simple multiple where it does not.',
      'You can log a drink at an earlier time, for the one you had at breakfast and forgot.',
      'Today\'s drinks are listed under the buttons, and you can fix the time or delete one long after the ten-minute undo has expired.',
      'The Everyone page has a small chart of what the whole office is carrying right now, with each person modelled on their own clearance rate.',
      'Buzz is now for Ovio and Teoria both, which is why the name lost its prefix.',
      'It installs properly on a phone home screen, with its own icon instead of a screenshot of the page. There is also a privacy page saying plainly what is stored and who can see it.',
      'This box is new too. It will tell you what changed after an update, once, and then get out of the way.',
    ],
  },
]

/** The newest note's id. What a fully caught-up member has stored. */
export const LATEST_PATCH_NOTE = PATCH_NOTES[0].id

/**
 * The notes a member hasn't seen yet, newest first.
 *
 * Someone who has seen nothing gets the newest note alone. Showing them
 * everything ever published would greet a new colleague with a changelog for an
 * app they have never used, so `joinTeam` stamps them as caught up on arrival
 * and this is only the belt to that braces.
 */
export function unseenPatchNotes(lastSeen: string | null): PatchNote[] {
  if (lastSeen === null) return PATCH_NOTES.slice(0, 1)

  return PATCH_NOTES.filter((note) => note.id > lastSeen)
}
