import { SkeletonBlock } from '@/components/Skeleton'

/**
 * Shown the instant navigation starts, before any data has come back.
 *
 * Shaped like the real page so the swap from skeleton to content doesn't jump
 * around: a hero panel, a recent-drinks panel, a stat-tile grid, a chart.
 */
export default function Loading() {
  return (
    <>
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8">
          <SkeletonBlock className="mx-auto h-40 w-40 shrink-0 rounded-full sm:mx-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-10 w-32" />
            <SkeletonBlock className="h-3 w-40" />
          </div>
        </div>
        <div className="border-t border-hairline bg-roast/40 p-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} className="h-13 flex-1 basis-full sm:basis-[calc(50%-0.25rem)]" />
            ))}
          </div>
        </div>
      </section>

      <section className="panel space-y-3 p-4">
        <SkeletonBlock className="h-3 w-28" />
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonBlock key={i} className="h-8 w-full" />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[4.5rem]" />
        ))}
      </div>

      <SkeletonBlock className="h-[228px] w-full" />
    </>
  )
}
