/**
 * One number with its unit and period stated as an etched legend.
 *
 * The legend carries the two things needed to read the number at all, which is
 * why it is a label rather than decoration.
 */
export function StatTile({
  legend,
  value,
  detail,
  tone = 'foam',
}: {
  legend: string
  value: string
  detail?: string
  tone?: 'foam' | 'crema' | 'zap'
}) {
  const valueColor = {
    foam: 'text-foam',
    crema: 'text-crema',
    zap: 'text-zap',
  }[tone]

  return (
    <div className="panel px-4 py-3.5">
      <p className="legend">{legend}</p>
      <p className={`mt-1.5 display text-2xl leading-none tracking-tight ${valueColor}`}>
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-oat">{detail}</p>}
    </div>
  )
}
