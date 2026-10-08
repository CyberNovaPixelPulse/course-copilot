import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/og-image.png", destination: "/opengraph-image" }];
  },
};

export default nextConfig;
