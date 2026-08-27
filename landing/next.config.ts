import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      { source: "/brand-guideline", destination: "/brand-guideline/index.html" },
    ];
  },
};

export default nextConfig;
