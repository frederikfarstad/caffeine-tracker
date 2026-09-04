/**
 * The optimistic reducer shared by `RecentDrinks` and `RecentAlcohol`.
 *
 * Both lists support the same two edits — change a row's time, or remove it —
 * so one reducer, tested once, backs `useOptimistic` in both components
 * rather than two copies of the same delete/patch logic.
 *
 * An edit carries the raw `HH:MM` the person typed, not a resolved `Date`:
 * reproducing the server's anchor-to-today resolution
 * (`resolveConsumedAt`/`instantFromLocalTime`) purely for a one-render-cycle
 * optimistic display isn't worth coupling this to that logic. The real,
 * resolved value takes over once the server's re-render lands.
 */
export type OptimisticListAction =
  | { type: 'edit'; id: number; timeLabel: string }
  | { type: 'delete'; id: number }

export type WithOptimisticTime<T> = T & { optimisticTimeLabel?: string }

export function applyOptimisticListAction<T extends { id: number }>(
  current: WithOptimisticTime<T>[],
  action: OptimisticListAction,
): WithOptimisticTime<T>[] {
  if (action.type === 'delete') return current.filter((item) => item.id !== action.id)

  return current.map((item) =>
    item.id === action.id ? { ...item, optimisticTimeLabel: action.timeLabel } : item,
  )
}
