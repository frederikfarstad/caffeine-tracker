import { SkeletonBlock } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="panel space-y-3 px-4 py-4">
      {Array.from({ length: 6 }, (_, i) => (
        <SkeletonBlock key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}
