/**
 * Draws the app icon once and writes every size the platforms want.
 *
 * Run with `npm run icons`. The artwork lives here rather than in a hand-edited
 * SVG because the same mark has to ship at four different croppings, and
 * keeping four copies in sync by hand is how one of them silently goes stale.
 *
 * The mark is the buzz meter's dial with the needle sitting in the marked
 * range — the app's own instrument, saying "over-caffeinated" rather than
 * merely "gauge". No ticks and no lettering: at 40px on a home screen both
 * turn to mud.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

/* Straight from globals.css — the icon must not invent colours. */
const ROAST = '#150f0d'
const GROUNDS_RAISED = '#2f221c'
const OAT = '#b79e8e'
const CREMA = '#f0a857'
const FOAM = '#f5ede4'

/* Geometry on a 64 grid. The dial's bounding box is centred vertically: the
 * arc spans cy-R to cy, and the hub adds its radius below. */
const CX = 32
const CY = 41
const RADIUS = 21
const STROKE = 5
/* Short enough to leave clear air between the tip and the dial. Drawn the
 * same length as a real manometer's needle relative to its face. */
const NEEDLE_LENGTH = 14
/* Half-width at the hub. The needle tapers from here to a point, which is what
 * separates a gauge needle from an arrow or a stick. */
const NEEDLE_HALF_WIDTH = 3.5
const HUB_RADIUS = 4.5

/**
 * Angles follow the app's own scale, so the icon and the meter agree:
 * `180 - (mg / 500) * 180`. The needle sits at 340mg, inside the marked range
 * that starts at 300 — past the point the app starts warning, which is the
 * whole idea of the mark.
 */
const angleFor = (mg: number) => 180 - (mg / 500) * 180

const MARKED_FROM_MG = 300
/* Well inside the marked range rather than just over its edge: at 40px a
 * needle near the boundary reads as touching it. */
const NEEDLE_MG = 380

function pointAt(angleDeg: number, radius: number) {
  const radians = (angleDeg * Math.PI) / 180
  return {
    x: CX + radius * Math.cos(radians),
    y: CY - radius * Math.sin(radians),
  }
}

/**
 * The needle as a tapered triangle rather than a stroked line.
 *
 * A line of even weight next to a hub of similar diameter reads as one blunt
 * lozenge — the hub disappears into it. Taper resolves that at any size, and
 * costs nothing at 40px.
 */
function needlePath(): string {
  const angle = angleFor(NEEDLE_MG)
  const tip = pointAt(angle, NEEDLE_LENGTH)
  const radians = (angle * Math.PI) / 180
  // Perpendicular to the needle's axis, in SVG's y-down space.
  const nx = Math.sin(radians) * NEEDLE_HALF_WIDTH
  const ny = Math.cos(radians) * NEEDLE_HALF_WIDTH

  const f = (n: number) => n.toFixed(2)
  return `M ${f(CX + nx)} ${f(CY + ny)} L ${f(tip.x)} ${f(tip.y)} L ${f(CX - nx)} ${f(CY - ny)} Z`
}

/** A clockwise arc between two points on the dial. */
function arc(fromMg: number, toMg: number): string {
  const start = pointAt(angleFor(fromMg), RADIUS)
  const end = pointAt(angleFor(toMg), RADIUS)
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

/**
 * @param scale Shrinks the artwork about the centre. Android crops maskable
 *   icons to a circle, so that variant needs to sit well inside the frame.
 * @param rounded Rounds the corners. Only for the browser favicon: iOS applies
 *   its own squircle and Android its own mask, and corners baked into either
 *   would be clipped twice.
 */
function buildSvg({
  size,
  scale = 1,
  rounded = false,
}: {
  size: number
  scale?: number
  rounded?: boolean
}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="face" cx="${CX}" cy="${CY}" r="40" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${GROUNDS_RAISED}"/>
      <stop offset="1" stop-color="${ROAST}"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64"${rounded ? ' rx="14"' : ''} fill="url(#face)"/>
  <g transform="translate(${CX} 32) scale(${scale}) translate(${-CX} -32)" fill="none" stroke-linecap="round">
    <path d="${arc(0, MARKED_FROM_MG)}" stroke="${OAT}" stroke-width="${STROKE}"/>
    <path d="${arc(MARKED_FROM_MG, 500)}" stroke="${CREMA}" stroke-width="${STROKE}"/>
    <!-- Pointer in foam, not crema: sharing the marked range's colour fused
         the two into one shape. Needle and hub are one object, as on a real
         gauge, so they wear one colour.

         No centre pin. It sharpened the hub at 512 and turned it to grey mush
         at 40, where the icon actually lives. -->
    <path d="${needlePath()}" fill="${FOAM}" stroke="none"/>
    <circle cx="${CX}" cy="${CY}" r="${HUB_RADIUS}" fill="${FOAM}" stroke="none"/>
  </g>
</svg>
`
}

const APP_DIR = path.join(process.cwd(), 'src/app')
const PUBLIC_DIR = path.join(process.cwd(), 'public')

const PNG_TARGETS = [
  // Next's file convention turns this into the apple-touch-icon link, which is
  // the only icon iOS reads. 180 is the size current iPhones ask for.
  { file: path.join(APP_DIR, 'apple-icon.png'), size: 180, scale: 1 },
  // Chrome will not offer to install without both of these.
  { file: path.join(PUBLIC_DIR, 'icon-192.png'), size: 192, scale: 1 },
  { file: path.join(PUBLIC_DIR, 'icon-512.png'), size: 512, scale: 1 },
  // Android adaptive icons crop to a circle inscribed in 80% of the frame.
  // 0.85 keeps the dial's corners clear of that edge with room to spare.
  { file: path.join(PUBLIC_DIR, 'icon-maskable-512.png'), size: 512, scale: 0.85 },
]

fs.mkdirSync(PUBLIC_DIR, { recursive: true })

// Browser tabs get the vector, which stays crisp at any size and is the only
// place the rounded corners belong.
const favicon = path.join(APP_DIR, 'icon.svg')
fs.writeFileSync(favicon, buildSvg({ size: 64, rounded: true }))
console.log(`${path.relative(process.cwd(), favicon)}  64x64 svg`)

for (const { file, size, scale } of PNG_TARGETS) {
  const svg = buildSvg({ size, scale })
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file)
  console.log(`${path.relative(process.cwd(), file)}  ${size}x${size} png`)
}
