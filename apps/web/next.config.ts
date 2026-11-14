import type { NextConfig } from "next";

const config: NextConfig = {
  // packages/shared ships TypeScript source, so Next must transpile it.
  transpilePackages: ["@michael/shared"],
};

export default config;
