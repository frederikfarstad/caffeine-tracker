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
import type { CurvePoint } from '@/lib/blood-caffeine'
import { formatOsloClock } from '@/lib/format'

const AXIS_STYLE = {
  fill: 'var(--color-oat)',
  fontFamily: 'var(--font-gauge)',
  fontSize: 10,
} as const

/**
 * How much caffeine the office is carrying, right now and for the rest of the
 * day.
 *
 * The personal chart's smaller sibling, and deliberately so: it is a curiosity
 * rather than something to act on, so it gets less height and fewer marks. No
 * sleep threshold line — a threshold is a personal number and means nothing
 * against thirty bloodstreams added together.
 *
 * Each member's own clearance rate is applied before the sum, in
 * `getTeamIntakeEvents` and `combinedLoadAt`; this only draws the result.
 */
export function TeamBloodstreamChart({ data, now }: { data: CurvePoint[]; now: Date }) {
  const series = data.map((point) => ({
    at: point.at,
    measured: point.projected ? null : point.mg,
    projected: point.projected || point.at === now.getTime() ? point.mg : null,
  }))

  return (
    <ResponsiveContainer width="100%" height={120}>
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
          minTickGap={48}
          tickLine={false}
        />
        <YAxis
          tick={AXIS_STYLE}
          stroke="var(--color-chart-grid)"
          tickLine={false}
          width={44}
          allowDecimals={false}
        />
        <ReferenceLine x={now.getTime()} stroke="var(--color-oat)" strokeDasharray="2 4" />
        <Tooltip
          cursor={{ stroke: 'var(--color-oat)', strokeWidth: 1 }}
          content={(props) => (
            <ChartTooltip {...props} labelFormatter={(label) => formatOsloClock(Number(label))} />
          )}
        />
        <Line
          type="monotone"
          dataKey="measured"
          name="Team caffeine"
          stroke="var(--color-chart-primary)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-grounds)' }}
          connectNulls={false}
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
