import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EventInput, IngestResponse } from "@michael/shared";
import { app } from "../app";
import { currentUserId, runAsUser } from "../context";
import { env } from "../env";
import { updateProfile } from "../routes/profile";
import { store } from "../store";
import { createPersonalToken } from "../tokens";
import { writeVersion } from "../writes";
import { AwPayload, mapActivityWatch } from "./activitywatch";
import { ShortcutsPairer, ShortcutsPayload, UNKNOWN_APP } from "./ios-shortcuts";
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
  // Kept only inside meetings mode (#400): the demo key's account had it on at the time.
  const conversation = fixture("omi");
  await runAsUser(env.DEMO_USER_ID, () =>
    store.createMeetingSession({
      started_at: conversation.started_at,
      ends_at: new Date(Date.parse(conversation.started_at) + 3600_000).toISOString(),
    }),
  );
  const a = IngestResponse.parse(await (await post("omi?uid=ignored", fixture("omi"))).json());
  assert.equal(a.inserted, 1);
  const b = IngestResponse.parse(await (await post("omi", fixture("omi"))).json());
  assert.equal(b.duplicates, 1);
  const c = await post("omi", [{ text: "live", is_user: true }]);
  assert.equal(c.status, 200);
  assert.equal(IngestResponse.parse(await c.json()).inserted, 0);
});

// ---------- iPhone Shortcuts ----------

// Each test on its own fresh account in the in-memory store; a new pairer stands for a restart.
const asNewUser = <T>(fn: () => Promise<T>) => runAsUser(randomUUID(), fn);
const shortcutEvents = async (from = "2026-11-15T00:00:00Z", to = "2026-11-16T00:00:00Z") =>
  (await store.listEvents({ from, to, source: ["ios_shortcuts"] }))
    .filter((e) => e.external_id?.startsWith("sc:"))
    .map((e) => [e.title, e.data?.seconds, e.start_at, e.data?.open ?? false]);
const signal = (pairer: ShortcutsPairer, body: unknown, at = Date.parse("2026-11-15T11:00:00Z")) =>
  pairer.handle(ShortcutsPayload.parse(body), at);

test("Shortcuts: a single open is stored at once, with a provisional minute", () =>
  asNewUser(async () => {
    const before = writeVersion(currentUserId());
    const r = await signal(new ShortcutsPairer(), { app: "Instagram", at: "2026-11-15T11:02:57Z" });
    assert.equal(r.inserted, 1);
    const [e] = r.events;
    assert.equal(e?.start_at, "2026-11-15T11:02:57.000Z");
    assert.equal(e?.end_at, "2026-11-15T11:03:57.000Z");
    assert.deepEqual(e?.data, { app: "Instagram", device: "iphone", seconds: 60, open: true });
    assert.equal(e?.external_id, "sc:instagram:2026-11-15T11:02:57");
    // Chat context and memos read again (writes.ts).
    assert.notEqual(writeVersion(currentUserId()), before);
    // A duplicate automation run of the same app keeps the first open.
    const again = await signal(new ShortcutsPairer(), { app: "instagram", at: "2026-11-15T11:03:10Z" });
    assert.equal(again.events.length, 0);
    assert.equal((await shortcutEvents()).length, 1);
  }));

test("Shortcuts: a close extends the open to its real end", () =>
  asNewUser(async () => {
    const pairer = new ShortcutsPairer();
    await signal(pairer, { app: "Instagram", at: "2026-11-15T11:00:00Z" });
    const r = await signal(pairer, { app: "instagram", action: "close", at: "2026-11-15T11:25:00Z" });
    assert.equal(r.inserted, 0);
    assert.equal(r.events[0]?.end_at, "2026-11-15T11:25:00.000Z");
    assert.deepEqual(await shortcutEvents(), [["Instagram", 1500, "2026-11-15T11:00:00.000Z", false]]);
    // Another user's close finds nothing open: dropped.
    await asNewUser(async () => {
      const other = await signal(pairer, { app: "Instagram", action: "close", at: "2026-11-15T11:30:00Z" });
      assert.equal(other.events.length, 0);
      assert.deepEqual(await shortcutEvents(), []);
    });
  }));

test("Shortcuts: a restart between open and close still extends the open", () =>
  asNewUser(async () => {
    await signal(new ShortcutsPairer(), { app: "WhatsApp", at: "2026-11-15T11:00:00Z" });
    // A deploy: a new process, a new pairer with nothing in memory.
    const r = await signal(new ShortcutsPairer(), {
      app: "WhatsApp",
      action: "close",
      at: "2026-11-15T11:02:30Z",
    });
    assert.equal(r.events.length, 1);
    assert.deepEqual(await shortcutEvents(), [["WhatsApp", 150, "2026-11-15T11:00:00.000Z", false]]);
  }));

test("Shortcuts: the next app's open ends the one before; opens and closes pair as before", () =>
  asNewUser(async () => {
    const pairer = new ShortcutsPairer();
    for (const p of fixture("ios-shortcuts") as unknown[]) await signal(pairer, p);
    const events = await store.listEvents({
      from: "2026-11-14T00:00:00Z",
      to: "2026-11-14T12:00:00Z",
      source: ["ios_shortcuts"],
    });
    const mine = events.filter((e) => e.external_id?.startsWith("sc:"));
    for (const e of mine) EventInput.parse(e);
    assert.deepEqual(
      mine.map((e) => [e.title, e.data?.seconds, e.start_at, e.data?.open ?? false]),
      [
        ["Instagram", 1500, "2026-11-14T10:22:00.000Z", false],
        ["WhatsApp", 150, "2026-11-14T11:01:10.000Z", false],
        ["Safari", 80, "2026-11-14T11:03:40.000Z", false],
      ],
    );
    assert.equal(mine[2]?.data?.bundle_id, "com.apple.mobilesafari");
    assert.equal(mine[0]?.external_id, "sc:instagram:2026-11-14T10:22:00");
    // An open never ended keeps its minute; one over two hours old is left alone by the next open.
    await signal(pairer, { app: "Threads", at: "2026-11-14T15:00:00Z" });
    await signal(pairer, { app: "Mail", at: "2026-11-14T17:30:00Z" });
    assert.deepEqual(await shortcutEvents("2026-11-14T14:00:00Z", "2026-11-15T00:00:00Z"), [
      ["Threads", 60, "2026-11-14T15:00:00.000Z", true],
      ["Mail", 60, "2026-11-14T17:30:00.000Z", true],
    ]);
    assert.throws(() => ShortcutsPayload.parse({ app: "X", action: "launch" }));
    assert.equal(ShortcutsPayload.parse({ app: "X" }).action, "open");
  }));

test("POST /v1/webhooks/ios-shortcuts stores an open at once and extends it on close", async () => {
  const open = IngestResponse.parse(
    await (await post("ios-shortcuts", { app: "Threads", action: "open" })).json(),
  );
  assert.equal(open.inserted, 1);
  assert.equal(open.events[0]?.source, "ios_shortcuts");
  assert.equal(open.events[0]?.data.open, true);
  await new Promise((r) => setTimeout(r, 1100));
  const close = IngestResponse.parse(
    await (await post("ios-shortcuts", { app: "Threads", action: "close" })).json(),
  );
  assert.equal(close.events.length, 1);
  assert.equal(close.events[0]?.id, open.events[0]?.id);
  assert.equal(close.events[0]?.data.open, undefined);
  // No action means open (one "Is Opened" automation is enough).
  assert.equal((await post("ios-shortcuts", { app: "Threads" })).status, 200);
  // No app: the shortcut run by hand, the test (#466). Answered, nothing stored, never a 400.
  for (const body of [{ action: "open" }, { app: "", action: "open" }, { app: "  " }]) {
    const res = await post("ios-shortcuts", body);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { test?: boolean; inserted: number };
    assert.equal(json.test, true);
    assert.equal(json.inserted, 0);
  }
});

test("iPhone key: the first call with no app is the test, later ones are opens of an unnamed app", async () => {
  const owner = randomUUID();
  const { secret } = await runAsUser(owner, () => createPersonalToken("iPhone Shortcuts"), "session");
  const send = async (body: unknown) => {
    const res = await app.request("/v1/webhooks/ios-shortcuts", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 200);
    return (await res.json()) as {
      test?: boolean;
      inserted: number;
      events: { title: string; data: Record<string, unknown> }[];
    };
  };
  // The hand run from Send a test: answered, nothing stored.
  const first = await send({ app: "", action: "open" });
  assert.equal(first.test, true);
  assert.equal(first.inserted, 0);
  // The App automation, which on current iOS passes no input: an open of an unnamed app.
  const auto = await send({ app: "", action: "open" });
  assert.equal(auto.test, undefined);
  assert.equal(auto.inserted, 1);
  assert.equal(auto.events[0]?.title, UNKNOWN_APP);
  assert.equal(auto.events[0]?.data.app_unknown, true);
  // The same automation fired twice within a minute is one open.
  assert.equal((await send({ app: "" })).inserted, 0);
  // A Text action before Run Shortcut names the app: the text is the app.
  const named = await send({ app: "Instagram" });
  assert.equal(named.events.find((e) => e.data.open === true)?.title, "Instagram");
  assert.equal(named.events.find((e) => e.data.open === true)?.data.app_unknown, undefined);
  // An empty variable's placeholder name is no app either.
  assert.equal(ShortcutsPayload.parse({ app: "Text" }).app, "");
  // The app from any field a shortcut may carry it in.
  assert.equal(ShortcutsPayload.parse({ app: "", name: "Threads" }).app, "Threads");
  assert.equal(ShortcutsPayload.parse({ text: "TikTok" }).app, "TikTok");
});

test("iPhone default app: saving it renames today's unnamed opens, later ones take it, others untouched", async () => {
  const owner = randomUUID();
  const other = randomUUID();
  const now = Date.now();
  const { secret } = await runAsUser(owner, () => createPersonalToken("iPhone Shortcuts"), "session");
  const send = async (body: unknown) => {
    const res = await app.request("/v1/webhooks/ios-shortcuts", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 200);
    return (await res.json()) as {
      inserted: number;
      events: { title: string; data: Record<string, unknown> }[];
    };
  };
  const today = () =>
    store.listEvents({
      from: new Date(now - 3600_000).toISOString(),
      to: new Date(now + 3600_000).toISOString(),
      source: ["ios_shortcuts"],
    });
  await send({ app: "" }); // the hand run test
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  assert.equal((await send({ app: "", at: at(5) })).events[0]?.title, UNKNOWN_APP);
  // Another user's unnamed open stays theirs, unnamed.
  await runAsUser(other, () =>
    new ShortcutsPairer().handle(ShortcutsPayload.parse({ app: "" }), now - 4 * 60_000),
  );

  const saved = await runAsUser(owner, () => updateProfile({ default_app: "Instagram" }), "session");
  assert.equal(saved.default_app, "Instagram");
  const renamed = await runAsUser(owner, today);
  assert.deepEqual(
    renamed.map((e) => [e.title, e.data.app_unknown, e.data.app_assumed]),
    [["Instagram", undefined, true]],
  );
  const theirs = await runAsUser(other, today);
  assert.deepEqual(
    theirs.map((e) => [e.title, e.data.app_unknown]),
    [[UNKNOWN_APP, true]],
  );

  // A later unnamed open, minutes after the last: a new open of the default app.
  const later = await send({ app: "", at: at(2) });
  const open = later.events.find((e) => e.data.open === true);
  assert.equal(open?.title, "Instagram");
  assert.equal(open?.data.app_assumed, true);
  assert.equal(open?.data.app_unknown, undefined);
  assert.equal((await runAsUser(owner, today)).length, 2);
});

test("Shortcuts pairer: unnamed opens a minute or more apart are two opens", () =>
  runAsUser(randomUUID(), async () => {
    const pairer = new ShortcutsPairer();
    await signal(pairer, { app: "", at: "2026-11-14T13:08:00Z" });
    await signal(pairer, { app: "", at: "2026-11-14T13:10:43Z" });
    const events = await store.listEvents({
      from: "2026-11-14T13:00:00Z",
      to: "2026-11-14T14:00:00Z",
      source: ["ios_shortcuts"],
    });
    assert.deepEqual(
      events.map((e) => [e.title, e.data.app_unknown, e.data.seconds, e.data.open ?? false]),
      [
        [UNKNOWN_APP, true, 163, false],
        [UNKNOWN_APP, true, 60, true],
      ],
    );
  }));

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

test("ActivityWatch on Windows: process names read as the apps people know, and focus still counts", () => {
  const f = fixture("activitywatch");
  const exe: Record<string, string> = {
    Code: "Code.exe",
    Terminal: "WindowsTerminal.exe",
    "Google Chrome": "chrome.exe",
    WhatsApp: "WhatsApp.exe",
    Slack: "slack.exe",
  };
  const window = (f.window as { data: { app: string; title?: string } }[]).map((e) => ({
    ...e,
    data: { ...e.data, app: exe[e.data.app] ?? e.data.app },
  }));
  const events = mapActivityWatch(
    AwPayload.parse({ window, afk: f.afk, device: "windows" }),
    Date.parse("2026-11-14T10:00:00Z"),
  );
  const usage = events.filter((e) => e.type === "app_usage");
  assert.deepEqual(
    usage.map((e) => e.title),
    [
      "Visual Studio Code",
      "Windows Terminal",
      "Google Chrome",
      "Visual Studio Code",
      "WhatsApp",
      "Visual Studio Code",
      "Slack",
    ],
  );
  assert.ok(usage.every((e) => e.data?.device === "windows"));
  assert.ok(
    usage.every((e) => !("title" in (e.data ?? {}))),
    "window titles are never stored",
  );
  assert.equal(usage[0]?.external_id?.startsWith("aw:visual studio code:"), true);
  const focus = events.filter((e) => e.type === "focus_session");
  assert.equal(focus[0]?.title, "Deep work: Visual Studio Code + Windows Terminal (36m)");

  // Left out, the computer is a Mac, as before.
  const mac = mapActivityWatch(AwPayload.parse(f), Date.parse("2026-11-14T10:00:00Z"));
  assert.equal(mac.find((e) => e.type === "app_usage")?.data?.device, "mac");
});

test("POST /v1/webhooks/activitywatch rejects a body that is not AW events", async () => {
  assert.equal((await post("activitywatch", { nope: [] })).status, 400);
  const res = IngestResponse.parse(await (await post("activitywatch", fixture("activitywatch"))).json());
  assert.equal(res.inserted, 8);
});

test("off the record: a Shortcuts open stores nothing", async () => {
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
  assert.equal(open.inserted, 0);
  await record(false);
  // The open was never stored, so the close has nothing to extend.
  const close = IngestResponse.parse(
    await (await post("ios-shortcuts", { app: "TikTok", action: "close" })).json(),
  );
  assert.equal(close.inserted, 0);
});
