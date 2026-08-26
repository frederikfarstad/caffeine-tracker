import type { MetadataRoute } from 'next'

/**
 * Installable to a phone home screen, since the app's whole job is being
 * one tap away while standing at the coffee machine.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ovio Buzz — how caffeinated is the team?',
    short_name: 'Ovio Buzz',
    description: 'Log every coffee and energy drink, and see who is running Ovio today.',
    start_url: '/',
    display: 'standalone',
    background_color: '#150f0d',
    theme_color: '#150f0d',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
