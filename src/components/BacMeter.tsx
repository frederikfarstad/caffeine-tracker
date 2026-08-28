'use client'

import { useEffect, useState } from 'react'
import {
  DRIVING_LIMIT_PERMILLE,
  HEAVY_PERMILLE,
  SCALE_MAX_PERMILLE,
  bacStatus,
  formatPermille,
} from '@/lib/alcohol'

/**
 * Blood alcohol on the same dial the caffeine meter uses.
 *
 * The instrument is borrowed on purpose: two readings on two gauges of the same
 * make are comparable at a glance, and party mode should look like part of the
 * app rather than a bolted-on second app.
 *
 * **No tremor.** `BuzzMeter`'s needle shakes harder as the day's caffeine
 * climbs, and there it earns its place — the shake is a second reading of the
 * same number. Repeating it here would produce a needle that gets visibly drunk,
 * which turns a legal limit into a joke and makes the one number people might
 * act on harder to read at exactly the point it matters most. If you are
 * tempted to add it back, that is the reason not to.
 *
 * The scale runs to 2 permille, well past the limit, for the same reason the
 * caffeine dial runs past 400 mg: a gauge that ends at the line can only say
 * "at maximum", where this one shows how far past you are.
 */
const SCALE_MAX = SCALE_MAX_PERMILLE
const TICK_STEP = 0.2
const LABEL_STEP = 0.5

const CX = 120
const CY = 122
const DIAL_RADIUS = 92
const NEEDLE_LENGTH = 74

function angleFor(bac: number): number {
  const fraction = Math.min(1, Math.max(0, bac / SCALE_MAX))
  return 180 - fraction * 180
}

function pointAt(angleDeg: number, radius: number) {
  const radians = (angleDeg * Math.PI) / 180
  return { x: CX + radius * Math.cos(radians), y: CY - radius * Math.sin(radians) }
}

function arcPath(from: number, to: number, radius: number): string {
  const start = pointAt(angleFor(from), radius)
  const end = pointAt(angleFor(to), radius)
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`
}

const ZONE_COLORS = {
  clear: 'var(--color-oat)',
  'over-limit': 'var(--color-crema)',
  heavy: 'var(--color-scald)',
} as const

/** Ticks land on tenths, so trim the float noise 0.1 * n produces. */
function tickLabel(bac: number): string {
  return bac.toFixed(1)
}

export function BacMeter({ bac }: { bac: number }) {
  const status = bacStatus(bac)

  // The needle sweeps up from rest on load, the way a machine's does when it
  // comes under pressure — the same orchestrated moment as the caffeine gauge.
  const [sweptBac, setSweptBac] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSweptBac(bac))
    return () => cancelAnimationFrame(frame)
  }, [bac])

  const ticks = []
  for (let step = 0; step * TICK_STEP <= SCALE_MAX + 1e-9; step++) {
    const value = step * TICK_STEP
    // Compared in tenths rather than by modulo on a float: 0.2 * 5 is not
    // exactly 1 in binary, and the 1.0 tick would lose its label.
    const isLabelled = Math.round(value * 10) % Math.round(LABEL_STEP * 10) === 0
    const angle = angleFor(value)
    ticks.push({
      value,
      isLabelled,
      outer: pointAt(angle, DIAL_RADIUS),
      inner: pointAt(angle, DIAL_RADIUS - (isLabelled ? 11 : 6)),
      label: pointAt(angle, DIAL_RADIUS + 12),
    })
  }

  return (
    <svg
      viewBox="4 6 232 134"
      className="w-full max-w-[20rem]"
      role="img"
      aria-label={`${formatPermille(bac)} estimated blood alcohol, against a ${DRIVING_LIMIT_PERMILLE} permille legal driving limit.`}
    >
      <path
        d={arcPath(0, SCALE_MAX, DIAL_RADIUS)}
        fill="none"
        stroke="var(--color-hairline)"
        strokeWidth="1"
      />

      {/*
       * The marked range starts at the limit, not at some fraction of it. On
       * the caffeine dial the amber band is "getting close to a guideline";
       * here there is nothing to get close to — you are under the limit or you
       * are over it, and the dial should not imply a gradient that the law
       * does not have.
       */}
      <path
        d={arcPath(DRIVING_LIMIT_PERMILLE, HEAVY_PERMILLE, DIAL_RADIUS - 5)}
        fill="none"
        stroke="var(--color-crema)"
        strokeWidth="3"
        opacity="0.85"
      />
      <path
        d={arcPath(HEAVY_PERMILLE, SCALE_MAX, DIAL_RADIUS - 5)}
        fill="none"
        stroke="var(--color-scald)"
        strokeWidth="3"
        opacity="0.85"
      />

      {/* The limit itself, drawn across the full dial depth so it reads as a line. */}
      <line
        x1={pointAt(angleFor(DRIVING_LIMIT_PERMILLE), DIAL_RADIUS + 2).x}
        y1={pointAt(angleFor(DRIVING_LIMIT_PERMILLE), DIAL_RADIUS + 2).y}
        x2={pointAt(angleFor(DRIVING_LIMIT_PERMILLE), DIAL_RADIUS - 16).x}
        y2={pointAt(angleFor(DRIVING_LIMIT_PERMILLE), DIAL_RADIUS - 16).y}
        stroke="var(--color-scald)"
        strokeWidth="2"
      />

      {ticks.map((tick) => (
        <g key={tick.value}>
          <line
            x1={tick.inner.x}
            y1={tick.inner.y}
            x2={tick.outer.x}
            y2={tick.outer.y}
            stroke={tick.isLabelled ? 'var(--color-oat)' : 'var(--color-hairline)'}
            strokeWidth={tick.isLabelled ? 1.5 : 1}
          />
          {tick.isLabelled && (
            <text
              x={tick.label.x}
              y={tick.label.y}
              fill="var(--color-oat)"
              fontFamily="var(--font-gauge)"
              fontSize="9"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {tickLabel(tick.value)}
            </text>
          )}
        </g>
      ))}

      <g
        style={{
          // SVG rotates clockwise, and the needle rests pointing left at 0.
          transform: `rotate(${angleFor(0) - angleFor(sweptBac)}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transition: 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <line
          x1={CX}
          y1={CY}
          x2={CX - NEEDLE_LENGTH}
          y2={CY}
          stroke={ZONE_COLORS[status]}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>

      <circle
        cx={CX}
        cy={CY}
        r="5"
        fill="var(--color-grounds-raised)"
        stroke={ZONE_COLORS[status]}
        strokeWidth="1.5"
      />
    </svg>
  )
}
