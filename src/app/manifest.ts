import type { MetadataRoute } from 'next'

/**
 * Installable to a phone home screen, since the app's whole job is being
 * one tap away while standing at the coffee machine.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Buzz — how caffeinated are Ovio and Teoria?',
    short_name: 'Buzz',
    description:
      'Log every coffee and energy drink, and see who is running Ovio and Teoria today.',
    start_url: '/',
    display: 'standalone',
    background_color: '#150f0d',
    theme_color: '#150f0d',
    /*
     * PNGs, not the SVG. Chrome needs 192 and 512 before it will offer to
     * install at all, and the maskable variant is padded so Android's circular
     * adaptive-icon crop does not clip the dial. iOS reads none of this — it
     * takes `apple-icon.png` via the link tag Next generates from the filename.
     */
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
