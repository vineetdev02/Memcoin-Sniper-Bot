import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sniperbot/shared"],
  typedRoutes: true,
};

export default config;
