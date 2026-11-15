// Michael's service worker. Two jobs:
// 1. Web Push: shows nudges sent by the API. On iPhone (Michael on the Home Screen, iOS 16.4+) the
//    notification mirrors to the Apple Watch.
// 2. Instant start: keeps the app shell (hashed JS and CSS, fonts, icons, a neutral skeleton page)
//    on the device so the installed app paints at once and stays calm on a bad network.
//
// Privacy rule: nothing personal ever goes into Cache Storage. Pages, RSC payloads, API calls and
// anything under /auth are rendered per person, so they always come from the network. The only
// HTML kept is public/shell.html, which holds no data at all. The one exception is in memory only:
// a page that arrived after the shell was shown is handed over once, to the same browser, within
// 30 seconds, and dropped on sign out.
//
// The build id arrives as ?v= on the script URL (components/service-worker.tsx), so every deploy
// installs a fresh worker with fresh cache names and deletes the old ones.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC_CACHE = `michael-static-${VERSION}`; // hashed /_next/static files: immutable
const SHELL_CACHE = `michael-shell-${VERSION}`; // shell page, icons, manifest, launch images
const SHELL_URL = "/shell.html";
const PRECACHE = [SHELL_URL, "/manifest.webmanifest", "/icon-180.png", "/icon-512.png"];

// How long a page may take before the skeleton shell paints instead. The real page still loads
// behind it and replaces the shell the moment it arrives.
const NAV_TIMEOUT_MS = 1200;
const HANDOFF_TTL_MS = 30_000;

/** url -> { promise: Promise<Response|null>, response?: Response|null, at: number } */
const handoffs = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // The shell must be there; the rest is best effort.
      await cache.add(new Request(SHELL_URL, { cache: "reload" }));
      await Promise.all(
        PRECACHE.slice(1).map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, SHELL_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith("michael-") && !keep.has(name)) await caches.delete(name);
      }
      // Lets the page request start while the worker boots: no added latency on a cold start.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "precache" && Array.isArray(data.urls)) {
    // The page lists the static files it loaded, so the whole shell is on the device after one visit.
    event.waitUntil(precacheStatic(data.urls));
  } else if (data.type === "handoff" && typeof data.url === "string" && event.ports[0]) {
    event.waitUntil(answerHandoff(data.url, event.ports[0]));
  } else if (data.type === "forget") {
    event.waitUntil(forgetPersonal());
  }
});

self.addEventListener("fetch", (event) => {
  if (VERSION === "dev") return; // development: push only, every request goes to the dev server
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Signing in, out, starting a demo visit or switching account (any method): drop anything held
  // for the previous person, and let the request through untouched.
  if (url.pathname.startsWith("/auth/") || url.pathname === "/login") {
    event.waitUntil(forgetPersonal());
    return;
  }
  if (request.method !== "GET") return; // writes always go straight to the network, never queued
  // The Michael shortcut is a file to download, never a page: the shell must not stand in for it.
  if (url.pathname.endsWith(".shortcut")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(event, url));
    return;
  }

  if (isRsc(request, url)) return; // per person payloads: network only
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (isShellAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request, SHELL_CACHE));
  }
});

function isRsc(request, url) {
  return url.searchParams.has("_rsc") || request.headers.get("RSC") === "1";
}

function isShellAsset(path) {
  return (
    path === SHELL_URL ||
    path === "/manifest.webmanifest" ||
    path.startsWith("/splash/") ||
    /^\/(icon|apple-icon)[^/]*\.png$/.test(path)
  );
}

/** Only plain, public, successful responses are worth keeping. */
function cacheable(response) {
  if (!response?.ok || response.type !== "basic") return false;
  const cc = response.headers.get("Cache-Control") || "";
  return !/no-store|private/i.test(cc);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: request.url.includes("/manifest") });
  const fresh = fetch(request)
    .then((response) => {
      if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(fresh);
    return hit;
  }
  return (await fresh) || Response.error();
}

async function precacheStatic(urls) {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    urls.slice(0, 200).map(async (raw) => {
      try {
        const url = new URL(raw, self.location.origin);
        if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) return;
        if (await cache.match(url.href)) return;
        const response = await fetch(url.href);
        if (cacheable(response)) await cache.put(url.href, response);
      } catch {
        // Best effort: the next visit fills it in.
      }
    }),
  );
}

/**
 * Network first with a short timeout. The page itself is never stored. If the network is slow the
 * skeleton shell paints and the real page is handed over the moment it lands; offline, the shell
 * shows the calm offline message.
 */
async function navigate(event, url) {
  const key = url.href;

  // The shell asked to reload because the real page has arrived: serve it once, then forget it.
  const held = handoffs.get(key);
  if (held && "response" in held && Date.now() - held.at < HANDOFF_TTL_MS) {
    handoffs.delete(key);
    if (held.response) return held.response;
  }

  const network = (async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
    } catch {
      // Fall through to a normal fetch.
    }
    try {
      return await fetch(event.request);
    } catch {
      return null; // offline or the connection dropped
    }
  })();

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), NAV_TIMEOUT_MS);
  });
  const first = await Promise.race([network, timeout]);
  clearTimeout(timer);
  if (first && first !== "timeout") return first;

  // Slow or offline: keep the request alive in memory for the shell to pick up, and paint the shell.
  // The body is read to the end while this event is still alive: a streamed preload body would be
  // cut off once the event finishes, leaving a blank page after the hand over.
  const buffered = network.then(async (response) => {
    if (!response || response.type === "opaqueredirect" || !response.body || response.status === 304) {
      return response;
    }
    try {
      const body = await response.blob();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return null;
    }
  });
  const entry = { promise: buffered, at: Date.now() };
  handoffs.set(key, entry);
  event.waitUntil(
    buffered.then((response) => {
      entry.response = response;
      entry.at = Date.now();
      setTimeout(() => {
        if (handoffs.get(key) === entry) handoffs.delete(key);
      }, HANDOFF_TTL_MS);
    }),
  );
  return shellResponse();
}

async function shellResponse() {
  const cache = await caches.open(SHELL_CACHE);
  const shell = await cache.match(SHELL_URL);
  if (shell) return shell;
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Michael</title><p style='font:17px system-ui;padding:24px'>I can't reach your day right now. I'll update when you're back online.</p><script>addEventListener('online',function(){location.reload()})</script>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Tells the shell page whether its real page arrived ("ready"), the network is gone ("offline"), or
 * the request was lost and is worth one more try ("retry").
 */
async function answerHandoff(url, port) {
  const entry = handoffs.get(url);
  if (!entry) {
    // The worker restarted and lost the request: the shell tries the page once more.
    port.postMessage({ status: "retry" });
    return;
  }
  const response = await entry.promise;
  port.postMessage({ status: response ? "ready" : "offline" });
  if (!response) handoffs.delete(url);
}

async function forgetPersonal() {
  handoffs.clear();
  // No personal cache exists today; this keeps the promise if one is ever added under this prefix.
  for (const name of await caches.keys()) {
    if (name.startsWith("michael-user-")) await caches.delete(name);
  }
}

// ---------------------------------------------------------------------------------------------
// Web Push

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Michael";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "nudge",
      renotify: true,
      icon: "/icon-180.png",
      badge: "/icon-180.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
