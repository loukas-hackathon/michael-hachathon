import type { NextConfig } from "next";

const config: NextConfig = {
  // packages/shared ships TypeScript source, so Next must transpile it.
  transpilePackages: ["@michael/shared"],
  // The floating dev badge sits on top of the tab bar; keep screenshots honest.
  devIndicators: false,
  // Old names for Connections: links and docs that say Devices still land on the list.
  async redirects() {
    return [
      { source: "/you/devices", destination: "/you#connections", permanent: false },
      { source: "/you/connections", destination: "/you#connections", permanent: false },
    ];
  },
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
