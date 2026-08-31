import Link from 'next/link'
import { WrappedSummary } from '@/components/WrappedSummary'
import { db } from '@/db'
import { localDateOf } from '@/lib/time'
import { formatMonth, isValidMonth, monthOf, previousMonth } from '@/lib/wrapped'
import { requireMember } from '@/server/auth'
import { getWrapped } from '@/server/wrapped'

export const metadata = { title: 'Your month — Buzz' }

export default async function WrappedPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const member = await requireMember()
  const params = await searchParams

  /*
   * Defaults to the last completed month. This one is not over, and a summary
   * of a month still running would say something different every time you
   * looked at it — which is the opposite of what a wrapped is for.
   *
   * The month comes off a URL, so it is validated rather than trusted. An
   * invalid one falls back rather than erroring: a mistyped query string should
   * show you last month, not a stack trace.
   */
  const thisMonth = monthOf(localDateOf(new Date()))
  const month =
    params.month && isValidMonth(params.month) ? params.month : previousMonth(thisMonth)

  const wrapped = await getWrapped(db, member.userId, month)

  return (
    <>
      <div className="space-y-1">
        <p className="legend">Your month</p>
        <h1 className="display text-3xl leading-tight tracking-tight text-foam">
          {formatMonth(month)}
        </h1>
      </div>

      {wrapped ? (
        <div className="panel p-4">
          <WrappedSummary wrapped={wrapped} />
        </div>
      ) : (
        <p className="panel px-4 py-8 text-center text-sm text-oat">
          Nothing logged in {formatMonth(month)}.
        </p>
      )}

      <p className="text-sm text-oat">
        <Link
          href={`/wrapped?month=${previousMonth(month)}`}
          className="underline decoration-hairline underline-offset-2"
        >
          The month before
        </Link>
      </p>
    </>
  )
}
