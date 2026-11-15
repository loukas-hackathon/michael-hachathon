import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// The service worker (public/sw.js) run in a sandbox: its push and notification click handlers
// with a fake registration, clients and fetch. Covers the nudge buttons (#399).

const SOURCE = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
const ORIGIN = "https://michael.example";
// Objects made inside the sandbox belong to another realm: compare them as plain JSON.
const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

type Shown = { title: string; options: Record<string, unknown> & { data?: Record<string, unknown> } };
type Listener = (event: unknown) => void;

function worker(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const listeners = new Map<string, Listener>();
  const shown: Shown[] = [];
  const opened: string[] = [];
  const fetched: { url: string; body: unknown }[] = [];
  const self = {
    location: { href: `${ORIGIN}/sw.js?v=test`, origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: {
      showNotification: async (title: string, options: Shown["options"]) => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  const sandbox = {
    self,
    URL,
    JSON,
    Map,
    Set,
    Promise,
    Response,
    setTimeout,
    clearTimeout,
    caches: { open: async () => ({}), keys: async () => [] },
    fetch: async (url: string, init: RequestInit) => {
      fetched.push({ url, body: JSON.parse(String(init.body)) });
      return fetchImpl(url, init);
    },
  };
  vm.runInNewContext(SOURCE, sandbox);

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let wait: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  const push = (payload: unknown) => dispatch("push", { data: { json: () => payload, text: () => "" } });
  const click = (data: unknown, action = "") =>
    dispatch("notificationclick", { action, notification: { data, close: () => {} } });
  return { shown, opened, fetched, push, click };
}

const PAYLOAD = {
  title: "Michael",
  body: "Gym at 18:00. Wrap up in 12 min.",
  tag: "block_soon",
  url: "/timeline?day=2026-11-15&block=evt1",
  actions: [
    { action: "snooze", title: "Snooze 10 min" },
    { action: "open", title: "Open" },
    { action: "extra", title: "Never shown" },
  ],
  act_url: "https://api.example/v1/nudges/n1/act",
  token: "signed-token",
};

test("sw: a nudge shows its buttons (two at most) and keeps the card and token for the tap", async () => {
  const w = worker(async () => Response.json({}));
  await w.push(PAYLOAD);
  const [note] = w.shown;
  assert.equal(note?.title, "Michael");
  assert.deepEqual(plain(note?.options.actions), PAYLOAD.actions.slice(0, 2));
  const { at, ...data } = plain(note?.options.data) as Record<string, unknown>;
  assert.equal(typeof at, "number");
  assert.deepEqual(data, {
    url: PAYLOAD.url,
    // What the app paints the moment it opens (#405).
    text: PAYLOAD.body,
    kind: PAYLOAD.tag,
    act_url: PAYLOAD.act_url,
    token: PAYLOAD.token,
  });
  // An older payload without buttons still shows, with no actions at all.
  await w.push({ title: "Michael", body: "Hi", tag: "goal_behind", url: "/" });
  assert.equal(w.shown[1]?.options.actions, undefined);
});

test("sw: tapping the body opens the exact card, never another site", async () => {
  const w = worker(async () => Response.json({}));
  await w.click({ url: PAYLOAD.url, act_url: PAYLOAD.act_url, token: PAYLOAD.token });
  await w.click({ url: PAYLOAD.url, act_url: PAYLOAD.act_url, token: PAYLOAD.token }, "open");
  await w.click({ url: "https://evil.example/x" });
  assert.deepEqual(w.opened, [`${ORIGIN}${PAYLOAD.url}`, `${ORIGIN}${PAYLOAD.url}`, `${ORIGIN}/`]);
  assert.equal(w.fetched.length, 0);
});

test("sw: the tap carries the nudge in the fragment, so the app shows it before any data (#405)", async () => {
  const w = worker(async () => Response.json({}));
  await w.click({ url: PAYLOAD.url, text: PAYLOAD.body, kind: PAYLOAD.tag, at: 5 });
  const opened = new URL(w.opened[0] ?? "");
  assert.equal(opened.origin + opened.pathname + opened.search, `${ORIGIN}${PAYLOAD.url}`);
  assert.deepEqual(JSON.parse(decodeURIComponent(opened.hash.slice("#nudge=".length))), {
    text: PAYLOAD.body,
    kind: PAYLOAD.tag,
    at: 5,
  });
});

test("sw: a button posts the action with the token and shows the result", async () => {
  const w = worker(async () =>
    Response.json({ text: "Snoozed. Back at 17:58.", url: "/timeline?day=2026-11-15" }),
  );
  await w.click({ url: PAYLOAD.url, act_url: PAYLOAD.act_url, token: PAYLOAD.token }, "snooze");
  assert.deepEqual(w.fetched, [{ url: PAYLOAD.act_url, body: { action: "snooze", token: "signed-token" } }]);
  assert.equal(w.shown[0]?.options.body, "Snoozed. Back at 17:58.");
  assert.deepEqual(plain(w.shown[0]?.options.data), { url: "/timeline?day=2026-11-15" });
  assert.equal(w.opened.length, 0);
});

test("sw: a refused or failed button says so plainly", async () => {
  const refused = worker(async () =>
    Response.json({ error: { code: "conflict", message: "Already done." } }, { status: 409 }),
  );
  await refused.click({ url: "/", act_url: PAYLOAD.act_url, token: "t" }, "do_it");
  assert.equal(refused.shown[0]?.options.body, "Already done.");

  const offline = worker(async () => {
    throw new TypeError("Failed to fetch");
  });
  await offline.click({ url: "/", act_url: PAYLOAD.act_url, token: "t" }, "do_it");
  assert.equal(offline.shown[0]?.options.body, "No connection. Open Michael to do it there.");
});
