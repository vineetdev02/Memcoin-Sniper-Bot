import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sniperbot/shared"],
  typedRoutes: true,
  webpack: (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    // Allow imports written as "./foo.js" to resolve to "./foo.ts" — required
    // because @sniperbot/shared uses ESM-style explicit extensions.
    cfg.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return cfg;
  },
};

export default config;
