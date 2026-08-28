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
import { DRIVING_LIMIT_PERMILLE } from '@/lib/alcohol'
import type { BacPoint } from '@/lib/blood-alcohol'
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
 * Blood alcohol over the evening, measured back and projected forward.
 *
 * Built on the same rules as `BloodCaffeineChart`: one measure so one colour,
 * the record/forecast split carried by the dash pattern rather than a second
 * hue, and two series over one array so the solid and dashed halves meet
 * exactly at the sample `bloodAlcoholCurve` guarantees at `now`.
 *
 * Two things differ, both because the quantity does.
 *
 * The y-axis has a floor. An evening of two beers peaks near 0.3, and an axis
 * scaled to its own data would draw that as a dramatic mountain — the same
 * shape a serious night produces, which is exactly the reading this chart must
 * not give. A fixed floor keeps a small night looking small.
 *
 * The reference line is red, where the caffeine chart's sleep threshold is
 * drawn in the recessive text colour. A sleep threshold is a preference the
 * reader chose; the driving limit is not either of those things.
 */
export function BloodAlcoholChart({ data, now }: { data: BacPoint[]; now: Date }) {
  const series = data.map((point) => ({
    at: point.at,
    // The joining sample carries both, so neither line stops short of it.
    measured: point.projected ? null : point.bac,
    projected: point.projected || point.at === now.getTime() ? point.bac : null,
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
          tickFormatter={(value: number) => value.toFixed(1)}
          // The floor is 0.4 so the 0.2 limit line always has air above it;
          // a domain that stopped at the data would push the rule to the top
          // of the plot on a quiet evening.
          domain={[0, (max: number) => Math.max(0.4, Math.ceil(max * 10) / 10)]}
        />

        <ReferenceLine
          y={DRIVING_LIMIT_PERMILLE}
          stroke="var(--color-scald)"
          strokeDasharray="2 4"
          label={{
            value: '0.2 ‰ · legal limit',
            position: 'insideTopRight',
            ...ANNOTATION_STYLE,
            fill: 'var(--color-scald)',
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
          name="In your blood"
          stroke="var(--color-chart-primary)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-grounds)' }}
          connectNulls={false}
          // No draw-on sweep, for the same reason as the caffeine curve: the
          // shape is the content, and it should be legible on the first frame.
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
