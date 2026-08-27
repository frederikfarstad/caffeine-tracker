import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter_Tight, JetBrains_Mono } from 'next/font/google'
import './globals.css'

/*
 * Display: Fraunces, with its SOFT and WONK axes exposed. The wonk is where
 * the personality lives — letterforms that lean and wobble slightly, which
 * suits a tracker for over-caffeinated colleagues better than a neutral
 * grotesque does.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
})

/* Body: compact and quiet, legible at 13px on a phone in a kitchen. */
const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  display: 'swap',
})

/* Gauge: tabular figures for readouts, tick labels and league tables. */
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Buzz — how caffeinated are Ovio and Teoria?',
  description:
    'Log every coffee and energy drink, and see who is running Ovio and Teoria today.',
  /*
   * Without this iOS opens the home-screen shortcut in a Safari tab with its
   * chrome, rather than as a standalone app. The manifest's `display` field
   * governs Android only.
   */
  appleWebApp: { capable: true, title: 'Buzz' },
}

export const viewport: Viewport = {
  themeColor: '#150f0d',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${interTight.variable} ${jetbrains.variable} min-h-dvh antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
