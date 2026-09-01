'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip } from './ChartTooltip'
import { formatWeekday } from '@/lib/format'
import type { WeekdayBar } from '@/server/stats'

const AXIS_STYLE = {
  fill: 'var(--color-oat)',
  fontFamily: 'var(--font-gauge)',
  fontSize: 10,
} as const

/**
 * Which day of the week hits hardest, summed across the period.
 *
 * A bar chart for the same reason `HourOfDayChart` is one: the question is
 * magnitude across a fixed, ordinal set of slots, and a day with nothing
 * logged should read as an honest gap rather than a line dipping to the axis.
 */
export function WeekdayChart({ data }: { data: WeekdayBar[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
        <CartesianGrid stroke="var(--color-chart-grid)" strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="weekday"
          tickFormatter={(weekday: number) => formatWeekday(weekday)}
          tick={AXIS_STYLE}
          stroke="var(--color-chart-grid)"
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
            <ChartTooltip {...props} labelFormatter={(weekday) => formatWeekday(Number(weekday))} />
          )}
        />
        <Bar dataKey="mg" name="Caffeine" fill="var(--color-chart-primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
