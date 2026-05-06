import type { NextConfig } from "next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("./package.json");

// Build-time injected so the running bundle can show its own version
// and a build identifier without needing a server roundtrip. The
// timestamp acts as a poor-man's build hash — distinct on every
// `next build` so we can verify "did the deployed bundle pick up my
// changes?" without computing file hashes.
const BUILD_TIME = new Date().toISOString();

const nextConfig: NextConfig = {
  // Enable Turbopack explicitly (Next.js 16 default)
  turbopack: {},

  env: {
    NEXT_PUBLIC_DAPP_VERSION: pkg.version,
    NEXT_PUBLIC_DAPP_BUILD_TIME: BUILD_TIME,
  },

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
