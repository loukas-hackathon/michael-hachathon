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
// behind it and replaces the shell the moment its first bytes arrive (the rest streams in), so
// showing the shell early costs nothing: 700 ms keeps a cold open from ever looking frozen.
const NAV_TIMEOUT_MS = 700;
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
  } else if (data.type === "open-nudge" && data.nudge) {
    // The same path as tapping the notification (the e2e tests drive it from a page).
    event.waitUntil(openNudge(data.nudge));
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
    if (request.mode === "navigate") event.respondWith(passThrough(event));
    return;
  }
  if (request.method !== "GET") return; // writes always go straight to the network, never queued
  // The Michael shortcut is a file to download, never a page: the shell must not stand in for it.
  if (url.pathname.endsWith(".shortcut")) {
    if (request.mode === "navigate") event.respondWith(passThrough(event));
    return;
  }

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

/**
 * A navigation the worker leaves alone, answered with the navigation preload response. With preload
 * on, a navigation the worker does not answer reaches the server twice (the preload, thrown away,
 * then a normal fetch). /auth/callback spends a one time code and /auth/signout revokes a session,
 * so a second copy undid the first: a new Google account bounced to "didn't go through" and one
 * Sign out became three /logout calls that timed out (#459).
 */
async function passThrough(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
  } catch {
    // No preload: one normal fetch below.
  }
  return fetch(event.request);
}

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
  const key = withoutHash(url.href);

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
  // The shell reloads the moment the first bytes arrive and the page streams on from there, so a
  // slow section (a Suspense row still reading) never holds the whole screen back. The body is
  // piped while this event is kept alive: a streamed preload body would otherwise be cut off once
  // the event finishes, leaving a blank page after the hand over.
  const entry = { at: Date.now() };
  let piped = Promise.resolve();
  entry.promise = network.then((response) => {
    let handed = response;
    if (response && response.body && response.type !== "opaqueredirect" && response.status !== 304) {
      if (typeof TransformStream === "function") {
        const { readable, writable } = new TransformStream();
        piped = response.body.pipeTo(writable).catch(() => {});
        handed = new Response(readable, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } else {
        // No streams: read to the end first, as before.
        piped = response.blob().then(
          (body) => {
            entry.response = new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          },
          () => {
            entry.response = null;
          },
        );
        return piped.then(() => entry.response);
      }
    }
    entry.response = handed;
    entry.at = Date.now();
    return handed;
  });
  handoffs.set(key, entry);
  event.waitUntil(
    entry.promise.then(() => {
      setTimeout(() => {
        if (handoffs.get(key) !== entry) return;
        handoffs.delete(key);
        // Never picked up: let the network request go.
        entry.response?.body?.cancel().catch(() => {});
      }, HANDOFF_TTL_MS);
      // Alive until the page has streamed to the end (or was dropped above).
      return Promise.race([piped, new Promise((resolve) => setTimeout(resolve, HANDOFF_TTL_MS + 1000))]);
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
async function answerHandoff(href, port) {
  const url = withoutHash(href);
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

/** Handoffs are keyed without the fragment: the shell sees #nudge=..., the request may not. */
function withoutHash(href) {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
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
//
// A nudge may carry buttons (#399): "Snooze 10 min", "Mute Instagram 30 min", "Do it". Chrome,
// Android and desktop browsers show them; iPhone and the Apple Watch do not show web push buttons,
// so there the tap opens the exact card (`url`) and the button is one tap away in the app.
// A button posts { action, token } to the API (`act_url`): the token is signed for that nudge and
// user, so no session is needed here. The result comes back as a second notification.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(data.title || "Michael", nudgeOptions(data)));
});

/** What showNotification gets for a push payload (apps/api/src/nudges/push.ts PushPayload). */
function nudgeOptions(data) {
  const actions = Array.isArray(data.actions)
    ? data.actions
        .filter((a) => a && typeof a.action === "string" && typeof a.title === "string")
        .slice(0, 2)
        .map((a) => ({ action: a.action, title: a.title }))
    : [];
  const options = {
    body: data.body || "",
    tag: data.tag || "nudge",
    renotify: true,
    icon: "/icon-180.png",
    badge: "/icon-180.png",
    data: {
      url: data.url || "/",
      // What the app shows the moment it opens, before any data arrives (openNudge).
      text: data.body || "",
      kind: data.tag || "nudge",
      at: Date.now(),
      act_url: typeof data.act_url === "string" ? data.act_url : null,
      token: typeof data.token === "string" ? data.token : null,
    },
  };
  if (actions.length) options.actions = actions;
  return options;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action || "";
  if (!action || action === "open" || !data.act_url || !data.token) {
    event.waitUntil(openNudge(data));
    return;
  }
  event.waitUntil(actOnNudge(data, action));
});

/** Posts the button to the API and shows what happened, under the same tag. */
async function actOnNudge(data, action) {
  let body = "That did not work. Open Michael to do it there.";
  let url = data.url || "/";
  try {
    const res = await fetch(data.act_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: data.token }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && typeof json.text === "string") {
      body = json.text;
      if (typeof json.url === "string") url = json.url;
    } else if (json.error && typeof json.error.message === "string") {
      body = json.error.message;
    }
  } catch {
    body = "No connection. Open Michael to do it there.";
  }
  await self.registration.showNotification("Michael", {
    body,
    tag: "nudge-done",
    icon: "/icon-180.png",
    badge: "/icon-180.png",
    data: { url },
  });
}

/**
 * Where a nudge opens. The nudge itself rides in the URL fragment (#nudge=...), which never leaves
 * the device, so the app paints a "From your nudge" card from it straight away while the day loads.
 * An open window is focused and routed inside the app (no full reload); with no window the app
 * opens on the URL and the shell paints at once if the server is slow.
 */
async function openNudge(data) {
  const target = new URL(typeof data.url === "string" ? data.url : "/", self.location.origin);
  if (target.origin !== self.location.origin) target.href = self.location.origin + "/";
  const nudge = {
    text: String(data.text || "").slice(0, 300),
    kind: String(data.kind || "nudge"),
    at: data.at || Date.now(),
  };
  if (nudge.text) target.hash = `nudge=${encodeURIComponent(JSON.stringify(nudge))}`;
  const url = target.href;

  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const ours = windows.filter((w) => w.url.startsWith(self.location.origin));
  // The one the person last looked at first.
  ours.sort(
    (a, b) =>
      Number(b.focused) - Number(a.focused) ||
      Number(b.visibilityState === "visible") - Number(a.visibilityState === "visible"),
  );
  const w = ours[0];
  if (!w) return self.clients.openWindow(url);

  const focused = "focus" in w ? w.focus().catch(() => w) : Promise.resolve(w);
  // Ask the page to route itself; a page from an older build does not answer, so it navigates.
  const routed = await new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 800);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    try {
      w.postMessage({ type: "nudge-open", url, nudge }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
  if (!routed && "navigate" in w) await w.navigate(url).catch(() => null);
  return focused;
}
