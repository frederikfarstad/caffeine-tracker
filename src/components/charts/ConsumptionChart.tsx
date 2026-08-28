'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip } from './ChartTooltip'
import { formatBucketLabel } from '@/lib/format'
import type { Period } from '@/lib/time'
import type { SeriesPoint } from '@/server/stats'

const AXIS_STYLE = {
  fill: 'var(--color-oat)',
  fontFamily: 'var(--font-gauge)',
  fontSize: 10,
} as const

/**
 * Caffeine over time — one series, so no legend: the title names it.
 *
 * Hour buckets for a single day, day buckets for anything longer. Empty
 * buckets arrive as explicit zeroes from `stats.ts`, so the line shows the real
 * shape rather than joining across gaps.
 *
 * Straight segments, not a smoothed curve: these are discrete daily and hourly
 * totals, and a spline would draw caffeine at times nobody recorded any.
 */
export function ConsumptionChart({
  data,
  period,
  color = 'var(--color-chart-primary)',
}: {
  data: SeriesPoint[]
  period: Period
  color?: string
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--color-chart-grid)" strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={(bucket: string) => formatBucketLabel(bucket, period)}
          tick={AXIS_STYLE}
          stroke="var(--color-chart-grid)"
          interval="preserveStartEnd"
          minTickGap={24}
          tickLine={false}
        />
        <YAxis
          tick={AXIS_STYLE}
          stroke="var(--color-chart-grid)"
          tickLine={false}
          width={44}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: 'var(--color-oat)', strokeWidth: 1 }}
          content={(props) => (
            <ChartTooltip
              {...props}
              labelFormatter={(label) => formatBucketLabel(label, period)}
            />
          )}
        />
        <Line
          type="linear"
          dataKey="mg"
          name="Caffeine"
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-grounds)' }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
