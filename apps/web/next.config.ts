import type { NextConfig } from "next";

const config: NextConfig = {
  // packages/shared ships TypeScript source, so Next must transpile it.
  transpilePackages: ["@michael/shared"],
  // The floating dev badge sits on top of the tab bar; keep screenshots honest.
  devIndicators: false,
  // The service worker (public/sw.js) must never be cached, so a fix reaches phones at once.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default config;
