'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip } from './ChartTooltip'
import type { HourBar } from '@/server/stats'

const AXIS_STYLE = {
  fill: 'var(--color-oat)',
  fontFamily: 'var(--font-gauge)',
  fontSize: 10,
} as const

/**
 * When the office drinks, by hour of the local day.
 *
 * A bar chart because the question is magnitude across 24 ordinal slots, and
 * because gaps between bars read as "no drinks at 03:00" far more honestly than
 * a line dipping to the axis.
 */
export function HourOfDayChart({ data }: { data: HourBar[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
        <CartesianGrid stroke="var(--color-chart-grid)" strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="hour"
          tickFormatter={(hour: number) => String(hour).padStart(2, '0')}
          tick={AXIS_STYLE}
          stroke="var(--color-chart-grid)"
          interval={2}
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
          cursor={{ fill: 'var(--color-grounds-raised)' }}
          content={(props) => (
            <ChartTooltip
              {...props}
              labelFormatter={(hour) => `${hour.padStart(2, '0')}:00`}
            />
          )}
        />
        <Bar
          dataKey="mg"
          name="Caffeine"
          fill="var(--color-chart-primary)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
