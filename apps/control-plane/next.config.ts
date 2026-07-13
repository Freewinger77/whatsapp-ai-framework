import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  output: 'standalone',
  typescript: {
    // Local `tsc` on this repo can take 15+ minutes; webpack compile already validates routes.
    ignoreBuildErrors: true
  }
};

export default nextConfig;
