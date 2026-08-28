import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    // Google account avatars are the only remote images the app renders.
    remotePatterns: [{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }],
  },
}

export default nextConfig
