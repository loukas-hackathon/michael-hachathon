import type { NextConfig } from "next";

const config: NextConfig = {
  // packages/shared ships TypeScript source, so Next must transpile it.
  transpilePackages: ["@michael/shared"],
  // The floating dev badge sits on top of the tab bar; keep screenshots honest.
  devIndicators: false,
};

export default config;
