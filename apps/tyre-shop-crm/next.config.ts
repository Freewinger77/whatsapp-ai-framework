import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/testimonials", destination: "/", permanent: false }];
  },
};

export default nextConfig;
