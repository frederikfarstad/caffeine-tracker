import { SkeletonBlock } from '@/components/Skeleton'

export default function Loading() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[4.5rem]" />
        ))}
      </div>

      {Array.from({ length: 3 }, (_, i) => (
        <SkeletonBlock key={i} className="h-[228px] w-full" />
      ))}
    </>
  )
}
