import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable Turbopack explicitly (Next.js 16 default)
  turbopack: {},

  webpack: (config) => {
    // Add polyfills for Node.js modules in browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

export default nextConfig;
