import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { ReaderContext } from "../types";
import { deviceOf, LOOKBACK_MS, makeActivityWatch, nextStart, pickBuckets } from "./activitywatch";
import { readersFor } from "./index";

// A fake ActivityWatch server on a free port: the two buckets of this computer, one synced from
// another computer, and events that answer the start and end of each request like the real one.

const NOW = Date.parse("2026-11-16T12:00:00Z");
const MIN = 60_000;
const at = (ms: number) => new Date(ms).toISOString();

type Ev = { id: number; timestamp: string; duration: number; data: Record<string, unknown> };
const ev = (id: number, startMs: number, seconds: number, data: Record<string, unknown>): Ev => ({
  id,
  timestamp: at(startMs),
  duration: seconds,
  data,
});

const WINDOW: Ev[] = [
  // Two days ago, for the backfill.
  ev(1, NOW - 2 * 24 * 60 * MIN, 600, { app: "Code.exe", title: "secret-plan.md - Visual Studio Code" }),
  // This morning.
  ev(2, NOW - 5 * 60 * MIN, 1200, { app: "chrome.exe", title: "Bank of Somewhere - Statement" }),
  // The last half hour: Code, a 5 second gap, Code again (one run), then Slack still open.
  ev(3, NOW - 30 * MIN, 600, { app: "Code.exe", title: "index.ts" }),
  ev(4, NOW - 20 * MIN + 5_000, 600, { app: "Code.exe", title: "index.ts" }),
  ev(5, NOW - 10 * MIN + 5_000, 595, { app: "slack.exe", title: "#general - Slack" }),
];
const AFK: Ev[] = [ev(10, NOW - 5 * 60 * MIN + 20 * MIN, 1800, { status: "afk" })];
const OTHER: Ev[] = [ev(20, NOW - 10 * MIN, 60, { app: "Instagram", title: "other computer" })];

const requests: string[] = [];
let server: Server;
let base = "";

const inRange = (list: Ev[], url: URL) => {
  const start = Date.parse(url.searchParams.get("start") ?? "1970-01-01T00:00:00Z");
  const end = Date.parse(url.searchParams.get("end") ?? "2100-01-01T00:00:00Z");
  return list.filter((e) => {
    const s = Date.parse(e.timestamp);
    return s < end && s + e.duration * 1000 > start;
  });
};

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push(url.pathname + url.search);
    const send = (body: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/api/0/buckets/")
      return send({
        "aw-watcher-window_LAPTOP-7Q": {
          id: "aw-watcher-window_LAPTOP-7Q",
          type: "currentwindow",
          hostname: "LAPTOP-7Q",
        },
        "aw-watcher-afk_LAPTOP-7Q": {
          id: "aw-watcher-afk_LAPTOP-7Q",
          type: "afkstatus",
          hostname: "LAPTOP-7Q",
        },
        "aw-watcher-window_other": {
          id: "aw-watcher-window_other",
          type: "currentwindow",
          hostname: "other",
        },
        "aw-watcher-web-chrome": {
          id: "aw-watcher-web-chrome",
          type: "web.tab.current",
          hostname: "LAPTOP-7Q",
        },
      });
    const m = /^\/api\/0\/buckets\/([^/]+)\/events$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1] ?? "");
      if (id === "aw-watcher-window_LAPTOP-7Q") return send(inRange(WINDOW, url));
      if (id === "aw-watcher-afk_LAPTOP-7Q") return send(inRange(AFK, url));
      if (id === "aw-watcher-window_other") return send(inRange(OTHER, url));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const logs: string[] = [];
const ctx = (cursor: string | null, backfillDays = 3): ReaderContext => ({
  cursor,
  backfillDays,
  tmpDir: "",
  log: (m) => logs.push(m),
});

type Body = { device: string; window: Ev[]; afk: Ev[] };

test("backfill: this computer's buckets only, day by day, app names without window titles", async () => {
  const reader = makeActivityWatch({
    baseUrl: base,
    hostname: "laptop-7q",
    platform: "win32",
    now: () => NOW,
  });
  const result = await reader.read(ctx(null));
  assert.equal(result.events.length, 0, "events go to the ActivityWatch route, not the batch");
  const posts = result.posts ?? [];
  assert.ok(posts.length >= 2, "a day at a time");
  assert.ok(posts.every((p) => p.path === "/v1/webhooks/activitywatch"));
  const bodies = posts.map((p) => p.body as Body);
  assert.ok(bodies.every((b) => b.device === "windows"));
  const apps = bodies.flatMap((b) => b.window.map((w) => w.data.app));
  assert.deepEqual(apps, ["Code.exe", "chrome.exe", "Code.exe", "Code.exe", "slack.exe"]);
  assert.ok(!apps.includes("Instagram"), "another computer's synced bucket is left out");
  const sent = JSON.stringify(bodies);
  assert.ok(!sent.includes("title"), "no window title leaves the computer");
  assert.ok(!sent.includes("secret-plan") && !sent.includes("Bank of"), "no window title text at all");
  assert.deepEqual(
    bodies.flatMap((b) => b.afk.map((a) => a.data)),
    [{ status: "afk" }],
  );
  assert.equal(
    posts.reduce((n, p) => n + p.count, 0),
    5,
  );
  // Read only, and never the web watcher's bucket (tab titles and addresses).
  assert.ok(requests.every((r) => !r.includes("aw-watcher-web")));

  // The next pass starts at the start of a run, three hours back at the latest: the Code run that
  // began 30 minutes ago is sent again whole, never cut.
  assert.equal(result.cursor, at(NOW - 3 * 60 * MIN));
});

test("the next start never cuts a run: it walks back over the same app", () => {
  const sent = WINDOW.map((e) => ({
    timestamp: e.timestamp,
    duration: e.duration,
    data: { app: String(e.data.app) },
  }));
  // Ten minutes after the look back reaches the first Code piece, the pass starts where the run began.
  const later = NOW - 30 * MIN + LOOKBACK_MS + 5 * MIN;
  assert.equal(nextStart(sent, later), Date.parse(WINDOW[2]?.timestamp ?? ""));
  // Later still, past both Code pieces: the open Slack event.
  const muchLater = NOW + LOOKBACK_MS - 5 * MIN;
  assert.equal(nextStart(sent, muchLater), Date.parse(WINDOW[4]?.timestamp ?? ""));
  // Nothing recent: the look back itself.
  assert.equal(nextStart([], NOW), NOW - LOOKBACK_MS);
});

test("an incremental pass asks only from the cursor", async () => {
  requests.length = 0;
  const reader = makeActivityWatch({
    baseUrl: base,
    hostname: "LAPTOP-7Q",
    platform: "win32",
    now: () => NOW,
  });
  const cursor = at(NOW - 30 * MIN);
  const result = await reader.read(ctx(cursor));
  const posts = result.posts ?? [];
  assert.equal(posts.length, 1);
  const body = posts[0]?.body as Body;
  assert.deepEqual(
    body.window.map((w) => w.data.app),
    ["Code.exe", "Code.exe", "slack.exe"],
  );
  const asked = requests.find((r) => r.includes("aw-watcher-window_LAPTOP-7Q"));
  assert.ok(asked?.includes(`start=${encodeURIComponent(cursor)}`));
  assert.ok(asked?.includes("limit=-1"));
  assert.ok(result.cursor && result.cursor >= cursor, "the position never goes back");
});

test("ActivityWatch not running: no error, the position stays, one line in the log", async () => {
  logs.length = 0;
  const reader = makeActivityWatch({ baseUrl: "http://127.0.0.1:9", hostname: "x", now: () => NOW });
  const cursor = at(NOW - MIN);
  for (let i = 0; i < 3; i++) {
    const r = await reader.read(ctx(cursor));
    assert.equal(r.cursor, cursor);
    assert.equal((r.posts ?? []).length, 0);
  }
  assert.equal(logs.length, 1, "said once, not every minute");
  assert.match(logs[0] ?? "", /not running/);
});

test("buckets: by host name, else the only one of its kind", () => {
  const b = {
    "aw-watcher-window_a": { type: "currentwindow", hostname: "Desk.local" },
    "aw-watcher-window_b": { type: "currentwindow", hostname: "laptop" },
    "aw-watcher-afk_b": { type: "afkstatus", hostname: "laptop" },
  };
  assert.deepEqual(pickBuckets(b, "desk"), { window: ["aw-watcher-window_a"], afk: ["aw-watcher-afk_b"] });
  assert.deepEqual(pickBuckets(b, "LAPTOP"), { window: ["aw-watcher-window_b"], afk: ["aw-watcher-afk_b"] });
  assert.deepEqual(pickBuckets(b, "unknown"), { window: [], afk: ["aw-watcher-afk_b"] });
});

test("on Windows only the readers that work there run", () => {
  assert.deepEqual(
    readersFor("win32").map((r) => r.name),
    ["claude-code", "activitywatch"],
  );
  assert.deepEqual(
    readersFor("darwin").map((r) => r.name),
    ["mac-usage", "iphone-usage", "chrome", "claude-code", "activitywatch"],
  );
  assert.equal(deviceOf("win32"), "windows");
  assert.equal(deviceOf("darwin"), "mac");
  assert.equal(deviceOf("linux"), "linux");
});
