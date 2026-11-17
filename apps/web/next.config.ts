import type { NextConfig } from "next";

// One id per deploy. The service worker is registered as /sw.js?v=<id>, so each deploy installs a
// fresh worker with fresh cache names (components/service-worker.tsx).
// Saved back to the environment so build workers that load this file again agree on it.
const buildId = (
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.GIT_COMMIT_SHA ??
  process.env.NEXT_PUBLIC_BUILD_ID ??
  Date.now().toString(36)
).slice(0, 12);
process.env.NEXT_PUBLIC_BUILD_ID = buildId;

// The shortcut files are served inline as Apple's shortcut type, not as an attachment: iOS then
// previews them with Open in Shortcuts instead of saving them to Files (Loukas, 15 Nov). The
// filename stays, since iOS names an imported shortcut after it.
const SHORTCUT_TYPE = "application/x-apple-shortcut";

const config: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // packages/shared ships TypeScript source, so Next must transpile it.
  transpilePackages: ["@michael/shared"],
  // The floating dev badge sits on top of the tab bar; keep screenshots honest.
  devIndicators: false,
  experimental: {
    // Instant tabs: visited and prefetched screens stay in the browser's router cache for five
    // minutes, so switching back paints at once. The tab bar refreshes a stale copy in the
    // background (components/tab-bar.tsx); server actions that revalidate still clear it.
    staleTimes: { dynamic: 300, static: 300 },
  },
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
      {
        // The signed Michael shortcut (scripts/shortcut/build.mjs). iOS names an imported shortcut
        // after its file, and the app runs it by the name Michael, so the download keeps that name.
        // Never cached for long: a rebuilt shortcut must reach the next phone.
        source: "/Michael.shortcut",
        headers: [
          { key: "Content-Type", value: SHORTCUT_TYPE },
          { key: "Content-Disposition", value: 'inline; filename="Michael.shortcut"' },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
      {
        // The signed Michael Focus shortcut (#447), the same way. The address has no space; the
        // download is named after the shortcut, which the app and the Mac collector run by name.
        source: "/MichaelFocus.shortcut",
        headers: [
          { key: "Content-Type", value: SHORTCUT_TYPE },
          { key: "Content-Disposition", value: 'inline; filename="Michael Focus.shortcut"' },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
      {
        // The data free app shell the worker paints on a slow network: always revalidated.
        source: "/shell.html",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default config;
