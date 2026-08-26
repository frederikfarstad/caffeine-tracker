'use client'

type TooltipEntry = {
  name?: unknown
  /** Recharts allows a range here, so it is narrowed at use rather than typed. */
  value?: unknown
}

function toMg(value: unknown): number {
  const scalar = Array.isArray(value) ? value.at(-1) : value
  const parsed = Number(scalar)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

/**
 * Tooltip in the app's own surface tokens, with the unit always stated.
 *
 * Props are typed loosely because Recharts passes its internal tooltip state
 * through `content`; only the three fields used here matter.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean
  payload?: readonly TooltipEntry[]
  label?: unknown
  labelFormatter?: (label: string) => string
}) {
  if (!active || !payload?.length) return null

  const rawLabel = String(label ?? '')

  return (
    <div className="rounded-md border border-hairline bg-roast px-2.5 py-1.5 shadow-lg">
      <p className="font-gauge text-[0.625rem] tracking-[0.1em] text-oat uppercase">
        {labelFormatter ? labelFormatter(rawLabel) : rawLabel}
      </p>
      {payload.map((entry, index) => (
        <p key={index} className="font-gauge text-xs text-foam">
          {toMg(entry.value)} mg
        </p>
      ))}
    </div>
  )
}
