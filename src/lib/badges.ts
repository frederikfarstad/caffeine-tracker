import { addLocalDays, type LocalDate } from './time'

/**
 * What the team can earn.
 *
 * Every badge here is a pure function of the log tables, which is the one
 * constraint that makes `earned_badges` rebuildable — see
 * `db/rebuild-badges.ts`. A badge that depended on when the code happened to
 * run could never be reproduced, and derived data that cannot be rebuilt is not
 * derived data, it is a second source of truth.
 *
 * Deliberately absent: anything celebrating a large dose or a day over the
 * 400 mg reference. The app's warning copy is factual rather than nagging, and
 * turning the one number it gives health guidance about into a prize would
 * undo that.
 */
export type BadgeId =
  | 'first-drop'
  | 'century'
  | 'half-k'
  | 'dawn-patrol'
  | 'night-shift'
  | 'week-straight'
  | 'month-straight'
  | 'connoisseur'
  | 'four-shots'
  | 'clean-sweep'
  | 'pioneer'

/** One member's drinks on one local date. */
export type DayCount = { localDate: LocalDate; count: number }

/**
 * Everything a predicate is allowed to read.
 *
 * `days` comes from `daily_totals` rather than `drink_logs`: one row per day
 * instead of one per drink, so evaluating badges costs the same for someone on
 * their thousandth coffee as on their first.
 *
 * `localHour` is the drink being logged right now, or null when badges are
 * being read rather than awarded — the hour badges must not fire merely because
 * somebody opened the dashboard early. `distinctTypeCount` is null unless it
 * was worth loading; see `needsDistinctTypes`.
 */
export type BadgeContext = {
  localHour: number | null
  days: DayCount[]
  distinctTypeCount: number | null
  today: LocalDate
}

export type Badge = {
  id: BadgeId
  name: string
  description: string
  /** Whether this badge's predicate reads `distinctTypeCount`. */
  needsDistinctTypes: boolean
  earned(context: BadgeContext): boolean
  /** `have / need` for counting badges, null for the rest. */
  progress(context: BadgeContext): { have: number; need: number } | null
}

export function totalDrinks(days: DayCount[]): number {
  return days.reduce((sum, day) => sum + day.count, 0)
}

/**
 * Consecutive days logged, counting back from today.
 *
 * Starts from yesterday when today is empty, so a streak is not reported as
 * broken every morning before the first coffee. Mirrors `getUserStreak` in
 * `server/stats.ts`, which makes the same allowance for the same reason.
 */
export function longestStreakEndingToday(days: DayCount[], today: LocalDate): number {
  const logged = new Set(days.filter((day) => day.count > 0).map((day) => day.localDate))

  let cursor = logged.has(today) ? today : addLocalDays(today, -1)
  let streak = 0

  while (logged.has(cursor)) {
    streak += 1
    cursor = addLocalDays(cursor, -1)
  }

  return streak
}

/** Days in a `YYYY-MM` month, by the calendar rather than by a rule of thumb. */
function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
}

/** True when some calendar month has every one of its days logged. */
export function hasCleanMonth(days: DayCount[]): boolean {
  const byMonth = new Map<string, Set<LocalDate>>()

  for (const day of days) {
    if (day.count === 0) continue
    const month = day.localDate.slice(0, 7)
    const dates = byMonth.get(month) ?? new Set<LocalDate>()
    dates.add(day.localDate)
    byMonth.set(month, dates)
  }

  for (const [month, dates] of byMonth) {
    if (dates.size >= daysInMonth(month)) return true
  }

  return false
}

/** A badge earned by logging `need` drinks in total. */
function counting(id: BadgeId, name: string, description: string, need: number): Badge {
  return {
    id,
    name,
    description,
    needsDistinctTypes: false,
    earned: (context) => totalDrinks(context.days) >= need,
    progress: (context) => ({ have: Math.min(totalDrinks(context.days), need), need }),
  }
}

/** A badge earned by a drink at a particular hour. */
function atHour(
  id: BadgeId,
  name: string,
  description: string,
  matches: (hour: number) => boolean,
): Badge {
  return {
    id,
    name,
    description,
    needsDistinctTypes: false,
    earned: (context) => context.localHour !== null && matches(context.localHour),
    progress: () => null,
  }
}

/** A badge earned by a streak of `need` days. */
function streak(id: BadgeId, name: string, description: string, need: number): Badge {
  return {
    id,
    name,
    description,
    needsDistinctTypes: false,
    earned: (context) => longestStreakEndingToday(context.days, context.today) >= need,
    progress: (context) => ({
      have: Math.min(longestStreakEndingToday(context.days, context.today), need),
      need,
    }),
  }
}

export const BADGES: Badge[] = [
  counting('first-drop', 'First drop', 'Logged your first drink.', 1),
  counting('century', 'Century', 'Logged a hundred drinks.', 100),
  counting('half-k', 'Five hundred', 'Logged five hundred drinks.', 500),
  atHour(
    'dawn-patrol',
    'Dawn patrol',
    'Logged a drink before seven in the morning.',
    (hour) => hour < 7,
  ),
  atHour('night-shift', 'Night shift', 'Logged a drink after ten at night.', (hour) => hour >= 22),
  streak('week-straight', 'Seven straight', 'Logged something every day for a week.', 7),
  streak('month-straight', 'Thirty straight', 'Logged something every day for a month.', 30),
  {
    id: 'connoisseur',
    name: 'Connoisseur',
    description: 'Logged ten different drinks.',
    needsDistinctTypes: true,
    earned: (context) => (context.distinctTypeCount ?? 0) >= 10,
    progress: (context) =>
      context.distinctTypeCount === null
        ? null
        : { have: Math.min(context.distinctTypeCount, 10), need: 10 },
  },
  {
    id: 'four-shots',
    name: 'Four in a day',
    description: 'Logged four drinks in one day.',
    needsDistinctTypes: false,
    earned: (context) => context.days.some((day) => day.count >= 4),
    progress: () => null,
  },
  {
    id: 'clean-sweep',
    name: 'Clean sweep',
    description: 'Logged something on every day of a calendar month.',
    needsDistinctTypes: false,
    earned: (context) => hasCleanMonth(context.days),
    progress: () => null,
  },
  {
    /*
     * The one badge nobody earns from their own context: it is granted to the
     * author of a drink type when somebody else logs it, by `server/badges.ts`.
     * It lives here for its name and description, and its predicate is
     * permanently false so that a member evaluation can never award it.
     */
    id: 'pioneer',
    name: 'Pioneer',
    description: 'Added a drink that somebody else went on to log.',
    needsDistinctTypes: false,
    earned: () => false,
    progress: () => null,
  },
]

const BY_ID = new Map(BADGES.map((badge) => [badge.id, badge]))

export function badgeById(id: BadgeId): Badge {
  const badge = BY_ID.get(id)
  if (!badge) throw new Error(`Unknown badge: ${id}`)
  return badge
}

/** Every badge this context satisfies right now. */
export function earnedBadgeIds(context: BadgeContext): BadgeId[] {
  return BADGES.filter((badge) => badge.earned(context)).map((badge) => badge.id)
}
