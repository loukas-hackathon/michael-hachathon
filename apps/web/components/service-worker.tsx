"use client";

import { useEffect } from "react";

// The worker's script URL carries the build id, so every deploy installs a fresh worker with fresh
// cache names (public/sw.js). In development it runs push only and caches nothing.
const VERSION = process.env.NODE_ENV === "production" ? (process.env.NEXT_PUBLIC_BUILD_ID ?? "dev") : "dev";
export const SW_URL = `/sw.js?v=${encodeURIComponent(VERSION)}`;

/** The one place that registers the worker: the app shell below and the nudges switch share it. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
}

const UPDATE_EVERY_MS = 60_000;

/**
 * Registers the worker on every page so the installed app starts from the device, then hands it
 * the static files this page loaded so the whole shell is cached after one visit. A new deploy
 * activates at once; an open app picks it up quietly the next time it comes back to the front.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let registration: ServiceWorkerRegistration | undefined;
    let updated = false;
    let lastCheck = Date.now();
    const hadController = Boolean(sw.controller);

    const precache = () => {
      const urls = new Set<string>();
      for (const entry of performance.getEntriesByType("resource")) {
        if (entry.name.includes("/_next/static/")) urls.add(entry.name);
      }
      for (const el of document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
        'script[src*="/_next/static/"], link[href*="/_next/static/"]',
      )) {
        urls.add("src" in el ? el.src : el.href);
      }
      const target = sw.controller ?? registration?.active;
      target?.postMessage({ type: "precache", urls: [...urls] });
    };

    const onControllerChange = () => {
      // This page's own build taking over (first install, or the page already came from the new
      // deploy) leaves nothing stale on screen. Only a newer build than this page needs a reload.
      const current = new URL(sw.controller?.scriptURL ?? SW_URL, location.href).searchParams.get("v");
      if (hadController && current !== VERSION) updated = true;
      else precache();
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (updated) {
        // A new deploy took over while the app was in the background: reload quietly now.
        location.reload();
        return;
      }
      if (Date.now() - lastCheck > UPDATE_EVERY_MS) {
        lastCheck = Date.now();
        registration?.update().catch(() => {});
      }
    };

    sw.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisibility);

    const start = () => {
      registerServiceWorker()
        .then((reg) => {
          registration = reg;
          return sw.ready;
        })
        .then(precache)
        .catch(() => {});
    };
    // After the page has loaded, so the worker never competes with the first paint.
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });

    return () => {
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("load", start);
    };
  }, []);

  return null;
}
