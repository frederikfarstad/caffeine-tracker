/**
 * A pulsing placeholder rectangle, for `loading.tsx` files.
 *
 * Its own component rather than an inline `animate-pulse` div repeated in
 * every route's `loading.tsx`, so the one thing that has to stay consistent —
 * the pulse timing and the colour it pulses against — lives in one place.
 */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-hairline/40 ${className}`} />
}
