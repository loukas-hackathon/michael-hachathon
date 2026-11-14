import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EventInput, IngestResponse } from "@michael/shared";
import { app } from "../app";
import { AwPayload, mapActivityWatch } from "./activitywatch";
import { ShortcutsPairer, ShortcutsPayload } from "./ios-shortcuts";
import { mapOmi } from "./omi";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const post = (path: string, body: unknown) =>
  app.request(`/v1/webhooks/${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });

// ---------- Omi ----------

test("Omi: a conversation keeps the summary and commitments, never the transcript", () => {
  const e = mapOmi(fixture("omi"));
  assert.ok(e);
  EventInput.parse(e);
  assert.equal(e.type, "conversation");
  assert.equal(e.title, "Planned the Michael demo");
  assert.equal(e.start_at, "2026-11-14T07:31:02.384Z");
  assert.equal(e.external_id, "omi:6a1f9c2e-41b7-4d0a-9e55-3c8b2f7d1a04");
  assert.deepEqual(e.data, {
    summary:
      "Agreed the demo runs on one shared timeline with the Apple Watch buzzing on stage. The Health Auto Export webhook goes live tonight.",
    category: "work",
    action_items: [
      "Ship the Health Auto Export webhook by tonight",
      "Trigger an export by hand before the pitch",
    ],
    action_items_done: 1,
    duration_min: 27,
  });
  const stored = JSON.stringify(e);
  for (const leak of ["SPEAKER", "Teammate", "transcript", "So the plan is", "notion-crm", "folder"]) {
    assert.ok(!stored.includes(leak), `stored ${leak}`);
  }
});

test("Omi: discarded conversations and transcript batches are not stored", () => {
  assert.equal(mapOmi({ ...fixture("omi"), discarded: true }), null);
  assert.equal(mapOmi([{ text: "hello", speaker: "SPEAKER_00", is_user: true, start: 0, end: 1 }]), null);
  assert.equal(mapOmi({ uid: "x", summary_json: {} }), null);
});

test("POST /v1/webhooks/omi is idempotent and accepts what it does not keep", async () => {
  const a = IngestResponse.parse(await (await post("omi?uid=ignored", fixture("omi"))).json());
  assert.equal(a.inserted, 1);
  const b = IngestResponse.parse(await (await post("omi", fixture("omi"))).json());
  assert.equal(b.duplicates, 1);
  const c = await post("omi", [{ text: "live", is_user: true }]);
  assert.equal(c.status, 200);
  assert.equal(IngestResponse.parse(await c.json()).inserted, 0);
});

// ---------- iPhone Shortcuts ----------

test("Shortcuts: opens and closes pair into sessions, a new app closes the held one", () => {
  const pairer = new ShortcutsPairer();
  const arrived = Date.parse("2026-11-14T14:00:00+02:00");
  const events = (fixture("ios-shortcuts") as unknown[]).flatMap((p) =>
    pairer.handle("user-a", ShortcutsPayload.parse(p), arrived),
  );
  for (const e of events) EventInput.parse(e);
  assert.deepEqual(
    events.map((e) => [e.title, e.data?.seconds, e.start_at]),
    [
      ["Instagram", 1500, "2026-11-14T10:22:00.000Z"],
      ["WhatsApp", 150, "2026-11-14T11:01:10.000Z"],
      ["Safari", 80, "2026-11-14T11:03:40.000Z"],
    ],
  );
  assert.equal(events[2]?.data?.bundle_id, "com.apple.mobilesafari");
  assert.equal(events[0]?.external_id, "sc:instagram:2026-11-14T10:22:00");
});

test("Shortcuts: users never share a held app; a close without an open is dropped", () => {
  const pairer = new ShortcutsPairer();
  const t = Date.parse("2026-11-14T10:00:00Z");
  pairer.handle("a", ShortcutsPayload.parse({ app: "Instagram", action: "open" }), t);
  assert.deepEqual(
    pairer.handle("b", ShortcutsPayload.parse({ app: "Instagram", action: "close" }), t + 60_000),
    [],
  );
  const [e] = pairer.handle("a", ShortcutsPayload.parse({ app: "instagram", action: "close" }), t + 60_000);
  assert.equal(e?.data?.seconds, 60);
  assert.throws(() => ShortcutsPayload.parse({ app: "X", action: "launch" }));
});

test("POST /v1/webhooks/ios-shortcuts stores a session on close", async () => {
  const open = IngestResponse.parse(
    await (await post("ios-shortcuts", { app: "Threads", action: "open" })).json(),
  );
  assert.equal(open.inserted, 0);
  await new Promise((r) => setTimeout(r, 1100));
  const close = IngestResponse.parse(
    await (await post("ios-shortcuts", { app: "Threads", action: "close" })).json(),
  );
  assert.equal(close.inserted, 1);
  assert.equal(close.events[0]?.source, "ios_shortcuts");
  assert.equal((await post("ios-shortcuts", { app: "Threads" })).status, 400);
});

// ---------- ActivityWatch ----------

test("ActivityWatch: merges runs, cuts away time, finds the focus stretch", () => {
  const now = Date.parse("2026-11-14T10:00:00Z");
  const events = mapActivityWatch(AwPayload.parse(fixture("activitywatch")), now);
  for (const e of events) EventInput.parse(e);
  const usage = events.filter((e) => e.type === "app_usage");
  assert.deepEqual(
    usage.map((e) => [e.title, e.data?.seconds]),
    [
      ["Code", 900],
      ["Terminal", 300],
      ["Google Chrome", 60],
      ["Code", 905],
      ["WhatsApp", 480],
      ["Code", 600],
      ["Slack", 355],
    ],
  );
  assert.ok(
    usage.every((e) => !("title" in (e.data ?? {}))),
    "window titles are never stored",
  );

  const focus = events.filter((e) => e.type === "focus_session");
  assert.equal(focus.length, 1);
  assert.equal(focus[0]?.title, "Deep work: Code + Terminal (36m)");
  assert.equal(focus[0]?.start_at, "2026-11-14T08:00:00.000Z");
  assert.equal(focus[0]?.end_at, "2026-11-14T08:36:05.000Z");
  assert.deepEqual(focus[0]?.data?.apps, { Code: 30.1, Terminal: 5, "Google Chrome": 1 });
});

test("ActivityWatch: reads the /api/0/export shape and waits for open runs", () => {
  const f = fixture("activitywatch");
  const payload = AwPayload.parse({
    buckets: {
      "aw-watcher-window_mac": { type: "currentwindow", events: f.window },
      "aw-watcher-afk_mac": { type: "afkstatus", events: f.afk },
    },
  });
  // At 08:55 the Slack run and the second Code run are too fresh to be final.
  const events = mapActivityWatch(payload, Date.parse("2026-11-14T08:55:00Z"));
  assert.deepEqual(
    events.filter((e) => e.type === "app_usage").map((e) => e.title),
    ["Code", "Terminal", "Google Chrome", "Code", "WhatsApp"],
  );
});

test("POST /v1/webhooks/activitywatch rejects a body that is not AW events", async () => {
  assert.equal((await post("activitywatch", { nope: [] })).status, 400);
  const res = IngestResponse.parse(await (await post("activitywatch", fixture("activitywatch"))).json());
  assert.equal(res.inserted, 8);
});

test("off the record: a Shortcuts open is not even held", async () => {
  const record = (on: boolean) =>
    app.request("/v1/privacy/off-the-record", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ off_the_record: on }),
    });
  assert.equal((await record(true)).status, 200);
  const open = IngestResponse.parse(
    await (await post("ios-shortcuts", { app: "TikTok", action: "open" })).json(),
  );
  assert.equal(open.ignored, 1);
  await record(false);
  // The open was never held, so the close has nothing to pair with.
  const close = IngestResponse.parse(
    await (await post("ios-shortcuts", { app: "TikTok", action: "close" })).json(),
  );
  assert.equal(close.inserted, 0);
});
