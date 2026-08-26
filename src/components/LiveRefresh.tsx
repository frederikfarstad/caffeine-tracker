'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Keeps a page reasonably fresh without polling around the clock.
 *
 * Three guards, all load-bearing rather than decorative. Vercel's free tier
 * allows 4 function-CPU-hours a month, and a handful of leaderboard tabs left
 * open all day on a naive interval would consume most of it — a re-render per
 * poll is a server render.
 *
 *   1. Refresh when the tab becomes visible, so returning to it is current.
 *   2. Poll only while the tab is actually visible.
 *   3. Stop polling entirely after a stretch with no interaction, so a tab
 *      forgotten on a second monitor costs nothing.
 */
export function LiveRefresh({
  intervalMs = 30_000,
  idleAfterMs = 10 * 60_000,
}: {
  intervalMs?: number
  idleAfterMs?: number
}) {
  const router = useRouter()
  // Seeded in the effect rather than here: reading the clock during render is
  // impure and gives an unstable value across re-renders.
  const lastInteractionAt = useRef(0)

  useEffect(() => {
    const noteInteraction = () => {
      lastInteractionAt.current = Date.now()
    }

    noteInteraction()

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      noteInteraction()
      router.refresh()
    }

    const events = ['pointerdown', 'keydown'] as const
    events.forEach((event) => window.addEventListener(event, noteInteraction, { passive: true }))
    document.addEventListener('visibilitychange', onVisibilityChange)

    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastInteractionAt.current > idleAfterMs) return
      router.refresh()
    }, intervalMs)

    return () => {
      clearInterval(timer)
      events.forEach((event) => window.removeEventListener(event, noteInteraction))
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [router, intervalMs, idleAfterMs])

  return null
}
