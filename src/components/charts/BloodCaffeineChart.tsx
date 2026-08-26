'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartTooltip } from './ChartTooltip'
import { SLEEP_THRESHOLD_MG, type CurvePoint } from '@/lib/blood-caffeine'
import { formatOsloClock } from '@/lib/format'

const AXIS_STYLE = {
  fill: 'var(--color-oat)',
  fontFamily: 'var(--font-gauge)',
  fontSize: 10,
} as const

const ANNOTATION_STYLE = {
  fill: 'var(--color-oat)',
  fontFamily: 'var(--font-gauge)',
  fontSize: 9,
} as const

/**
 * Caffeine still in the body, measured back and projected forward.
 *
 * One measure, so one colour. The split the reader needs is record versus
 * forecast, and that rides on the dash pattern rather than on a second hue:
 * making a projection a different colour reads as a second quantity, which it
 * is not. The `now` rule names where one becomes the other.
 *
 * Two series over one array, each null where the other draws, so the solid and
 * dashed halves meet exactly at the sample `bloodCaffeineCurve` guarantees at
 * `now`.
 *
 * A real time axis rather than the string buckets the other charts use: samples
 * are ten minutes apart and the interesting features — a peak forty minutes
 * after a drink, a threshold crossing — sit between whole hours.
 */
export function BloodCaffeineChart({ data, now }: { data: CurvePoint[]; now: Date }) {
  const series = data.map((point) => ({
    at: point.at,
    // The joining sample carries both, so neither line stops short of it.
    measured: point.projected ? null : point.mg,
    projected: point.projected || point.at === now.getTime() ? point.mg : null,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--color-chart-grid)" strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="at"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatOsloClock}
          tick={AXIS_STYLE}
          stroke="var(--color-chart-grid)"
          interval="preserveStartEnd"
          minTickGap={40}
          tickLine={false}
        />
        <YAxis
          tick={AXIS_STYLE}
          stroke="var(--color-chart-grid)"
          tickLine={false}
          width={44}
          allowDecimals={false}
        />

        {/*
         * Annotations, not data: both rules wear the recessive text colour and
         * carry a label, so neither borrows the status palette the meter uses
         * for how much you have had today.
         */}
        <ReferenceLine
          y={SLEEP_THRESHOLD_MG}
          stroke="var(--color-oat)"
          strokeDasharray="2 4"
          label={{
            value: `${SLEEP_THRESHOLD_MG} mg · sleep`,
            // Above the rule at the right-hand end. By the time the plot ends
            // the curve has dropped below the rule, so the space above it is
            // clear — which is not true of the space below.
            position: 'insideTopRight',
            ...ANNOTATION_STYLE,
          }}
        />
        <ReferenceLine
          x={now.getTime()}
          stroke="var(--color-oat)"
          strokeDasharray="2 4"
          label={{ value: 'now', position: 'insideTopLeft', ...ANNOTATION_STYLE }}
        />

        <Tooltip
          cursor={{ stroke: 'var(--color-oat)', strokeWidth: 1 }}
          content={(props) => (
            <ChartTooltip {...props} labelFormatter={(label) => formatOsloClock(Number(label))} />
          )}
        />

        <Line
          type="monotone"
          dataKey="measured"
          name="In your system"
          stroke="var(--color-chart-primary)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-grounds)' }}
          connectNulls={false}
          // No draw-on sweep. A hundred-odd samples animate badly, and the
          // shape of the curve is the whole content — it should be legible on
          // the first frame rather than after one.
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          name="Projected"
          stroke="var(--color-chart-primary)"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeOpacity={0.7}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-grounds)' }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
