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
        <div className="flex min-h-[213px] flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8">
          <SkeletonBlock className="mx-auto h-[173px] w-[220px] shrink-0 sm:mx-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-10 w-32" />
            <SkeletonBlock className="h-3 w-40" />
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="h-3 w-3/4" />
          </div>
        </div>
        <div className="border-t border-hairline bg-roast/40 p-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} className="h-13 flex-1 basis-full sm:basis-[calc(50%-0.25rem)]" />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <SkeletonBlock className="h-7 w-28" />
            <SkeletonBlock className="h-7 w-36" />
          </div>
          <SkeletonBlock className="mt-3 h-6 w-full" />
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
          <SkeletonBlock key={i} className="h-[6rem]" />
        ))}
      </div>

      <SkeletonBlock className="h-[320px] w-full" />
    </>
  )
}
