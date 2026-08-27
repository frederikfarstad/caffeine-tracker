import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from './manifest'

const PUBLIC_DIR = path.join(process.cwd(), 'public')
const APP_DIR = path.join(process.cwd(), 'src/app')

/**
 * The manifest and the files it names are edited separately, so nothing stops
 * them drifting apart — and a 404 in `icons` fails silently: the install
 * prompt just quietly stops offering, or the home screen falls back to a
 * screenshot of the page. Cheap to assert, invisible to catch by hand.
 */
describe('web app manifest', () => {
  const icons = manifest().icons ?? []

  it('names icons that exist in public/', () => {
    for (const icon of icons) {
      const file = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ''))
      expect(fs.existsSync(file), `${icon.src} is missing from public/`).toBe(true)
    }
  })

  // Chrome will not offer to install without both of these sizes.
  it('offers the 192 and 512 PNGs Chrome requires to install', () => {
    const pngSizes = icons
      .filter((icon) => icon.type === 'image/png' && icon.purpose?.includes('any'))
      .map((icon) => icon.sizes)

    expect(pngSizes).toContain('192x192')
    expect(pngSizes).toContain('512x512')
  })

  // Android crops adaptive icons to a circle. Without a maskable icon it
  // crops the "any" one instead, clipping the dial.
  it('provides a maskable icon for Android adaptive icons', () => {
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('keeps the standalone display and dark surface colours', () => {
    expect(manifest().display).toBe('standalone')
    expect(manifest().background_color).toBe('#150f0d')
    expect(manifest().theme_color).toBe('#150f0d')
  })
})

/**
 * iOS reads neither the manifest nor SVG icons: without this exact filename,
 * adding Buzz to an iPhone home screen produces a screenshot of the page.
 * Next's file convention turns it into the `apple-touch-icon` link.
 */
describe('apple touch icon', () => {
  it('exists as a PNG where Next expects it', () => {
    expect(fs.existsSync(path.join(APP_DIR, 'apple-icon.png'))).toBe(true)
  })
})
