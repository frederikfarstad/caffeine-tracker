'use client'

import { useEffect, useState } from 'react'
import {
  APPROACHING_MG,
  DAILY_MAX_MG,
  formatMg,
  fractionOfDailyMax,
  limitStatus,
} from '@/lib/caffeine'

/**
 * The buzz meter: today's caffeine, drawn as an espresso machine's pressure
 * gauge — and it gets the jitters.
 *
 * Every espresso machine has a manometer with an etched dial and a marked
 * operating range, which makes it the right instrument for "where am I against
 * the reference", and readable across a kitchen in a way a progress bar is not.
 *
 * The needle's tremor scales with how close the day is to the daily reference,
 * so the shake is a second reading of the same number rather than decoration: a
 * still needle at 50 mg, a visibly nervous one at 400. Reduced-motion users get
 * the position without the shake, and the number and label say the same thing in
 * text either way.
 *
 * The scale runs past 400 mg on purpose. A gauge ending at the limit can only
 * say "at maximum"; this one shows how far past you are, then pegs at the stop
 * like a real one.
 */
const SCALE_MAX_MG = 500
const TICK_STEP_MG = 50
const LABEL_STEP_MG = 100

const CX = 120
const CY = 122
const DIAL_RADIUS = 92
const NEEDLE_LENGTH = 74

/** Tremor at the daily reference, in degrees. Small on purpose. */
const MAX_TREMOR_DEG = 1.5

function angleFor(mg: number): number {
  const fraction = Math.min(1, Math.max(0, mg / SCALE_MAX_MG))
  return 180 - fraction * 180
}

function pointAt(angleDeg: number, radius: number) {
  const radians = (angleDeg * Math.PI) / 180
  return { x: CX + radius * Math.cos(radians), y: CY - radius * Math.sin(radians) }
}

function arcPath(fromMg: number, toMg: number, radius: number): string {
  const start = pointAt(angleFor(fromMg), radius)
  const end = pointAt(angleFor(toMg), radius)
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`
}

const ZONE_COLORS = {
  ok: 'var(--color-oat)',
  approaching: 'var(--color-crema)',
  over: 'var(--color-scald)',
} as const

export function BuzzMeter({ todayMg }: { todayMg: number }) {
  const status = limitStatus(todayMg)

  // The needle sweeps up from rest on load, the way a machine's does when it
  // comes under pressure. Starting at the real value would spend the one
  // orchestrated moment on the page for nothing.
  const [sweptMg, setSweptMg] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSweptMg(todayMg))
    return () => cancelAnimationFrame(frame)
  }, [todayMg])

  const tremorDeg = fractionOfDailyMax(todayMg) * MAX_TREMOR_DEG

  const ticks = []
  for (let mg = 0; mg <= SCALE_MAX_MG; mg += TICK_STEP_MG) {
    const isLabelled = mg % LABEL_STEP_MG === 0
    const angle = angleFor(mg)
    ticks.push({
      mg,
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
      aria-label={`${formatMg(todayMg)} of caffeine today, against a ${formatMg(DAILY_MAX_MG)} daily reference.`}
    >
      <path
        d={arcPath(0, SCALE_MAX_MG, DIAL_RADIUS)}
        fill="none"
        stroke="var(--color-hairline)"
        strokeWidth="1"
      />

      {/* Marked ranges, the way a brew-pressure zone is marked on a real dial */}
      <path
        d={arcPath(APPROACHING_MG, DAILY_MAX_MG, DIAL_RADIUS - 5)}
        fill="none"
        stroke="var(--color-crema)"
        strokeWidth="3"
        opacity="0.85"
      />
      <path
        d={arcPath(DAILY_MAX_MG, SCALE_MAX_MG, DIAL_RADIUS - 5)}
        fill="none"
        stroke="var(--color-scald)"
        strokeWidth="3"
        opacity="0.85"
      />

      {ticks.map((tick) => (
        <g key={tick.mg}>
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
              {tick.mg}
            </text>
          )}
        </g>
      ))}

      {/*
       * Two nested rotations: the outer one carries the reading, the inner one
       * the tremor. Keeping them separate means the shake never drags the
       * needle off the value it is pointing at.
       */}
      <g
        style={{
          // SVG rotates clockwise, and the needle rests pointing left at 0.
          transform: `rotate(${angleFor(0) - angleFor(sweptMg)}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transition: 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <g
          style={
            {
              '--jitter': `${tremorDeg}deg`,
              transformOrigin: `${CX}px ${CY}px`,
              animation: tremorDeg > 0.05 ? 'jitter 110ms ease-in-out infinite' : undefined,
            } as React.CSSProperties
          }
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
