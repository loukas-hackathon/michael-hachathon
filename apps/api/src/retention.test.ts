import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DataDeleteResult, type Event } from "@michael/shared";
import { app } from "./app";
import { runAsUser } from "./context";
import { retentionCutoff, rollUpCurrentUser, runRetention } from "./retention";
import { meData } from "./routes/me-data";
import { store } from "./store";
import { mergeSummaries, summariseEvents } from "./summaries";
import { USER_TABLES } from "./supabase-store";
import { createPersonalToken, listPersonalTokens } from "./tokens";

// Runs against the in-memory store (no Supabase env in tests).
const OWNER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const ev = (p: Partial<Event> & Pick<Event, "start_at">): Event => ({
  id: crypto.randomUUID(),
  source: "macos_usage",
  type: "app_usage",
  end_at: null,
  title: "Some app",
  data: {},
  external_id: null,
  created_at: p.start_at,
  ...p,
});

test("summariseEvents: one row per UTC day, source, type and category, with counts and time", () => {
  const rows = summariseEvents([
    ev({ start_at: "2026-08-01T09:00:00Z", data: { bundle_id: "com.microsoft.VSCode", seconds: 600 } }),
    ev({ start_at: "2026-08-01T10:00:00Z", data: { bundle_id: "com.apple.Terminal", seconds: 300 } }),
    ev({ start_at: "2026-08-01T23:30:00-02:00", data: { bundle_id: "com.microsoft.VSCode", seconds: 60 } }),
    ev({
      start_at: "2026-08-01T06:00:00Z",
      end_at: "2026-08-01T07:30:00Z",
      source: "health_auto_export",
      type: "workout",
      title: "Strength",
    }),
    ev({
      start_at: "2026-08-01T12:00:00Z",
      source: "chrome",
      type: "web_visit",
      data: { host: "x.com", seconds: 90 },
    }),
    ev({
      start_at: "2026-08-01T12:05:00Z",
      source: "chrome",
      type: "web_visit",
      data: { category: "news", seconds: -5 },
    }),
  ]);
  assert.deepEqual(rows, [
    { day: "2026-08-01", source: "chrome", type: "web_visit", category: "news", events: 1, seconds: 0 },
    { day: "2026-08-01", source: "chrome", type: "web_visit", category: "social", events: 1, seconds: 90 },
    {
      day: "2026-08-01",
      source: "health_auto_export",
      type: "workout",
      category: "",
      events: 1,
      seconds: 5400,
    },
    {
      day: "2026-08-01",
      source: "macos_usage",
      type: "app_usage",
      category: "work",
      events: 2,
      seconds: 900,
    },
    // 23:30 at -02:00 is the next UTC day.
    { day: "2026-08-02", source: "macos_usage", type: "app_usage", category: "work", events: 1, seconds: 60 },
  ]);
  // No titles survive.
  assert.ok(rows.every((r) => !("title" in r) && !("data" in r)));
});

test("mergeSummaries adds onto rows already stored for the same key", () => {
  const old = summariseEvents([ev({ start_at: "2026-08-01T09:00:00Z", data: { seconds: 60 } })]);
  const fresh = summariseEvents([
    ev({ start_at: "2026-08-01T10:00:00Z", data: { seconds: 30 } }),
    ev({ start_at: "2026-08-03T10:00:00Z", data: { seconds: 30 } }),
  ]);
  const merged = mergeSummaries(old, fresh);
  assert.deepEqual(
    merged.map((m) => [m.day, m.events, m.seconds]),
    [
      ["2026-08-01", 2, 90],
      ["2026-08-03", 1, 30],
    ],
  );
});

test("retentionCutoff is the start of the UTC day 90 days back", () => {
  assert.equal(retentionCutoff(Date.parse("2026-11-14T15:42:00Z")), "2026-08-16T00:00:00.000Z");
});

test("every table with user rows is deleted by DELETE /v1/me/data", () => {
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  const tables = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
    const sql = readFileSync(new URL(f, dir), "utf8");
    for (const m of sql.matchAll(/create table (?:if not exists )?(\w+)/gi)) if (m[1]) tables.add(m[1]);
  }
  // Shared by every user of a client / deleted by tokens.ts / deleted by setup-tokens.ts.
  // The waiting list holds people without an account, so no user owns its rows.
  const elsewhere = new Set(["oauth_clients", "personal_tokens", "setup_tokens", "waitlist"]);
  const missing = [...tables].filter(
    (t) => !elsewhere.has(t) && !(USER_TABLES as readonly string[]).includes(t),
  );
  assert.deepEqual(missing, [], "add new user tables to USER_TABLES in supabase-store.ts");
});

test("the retention job rolls old events into summaries and deletes the raw rows", async () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  await runAsUser(OWNER, async () => {
    await store.deleteMyData({ everything: true }); // start empty, not on the sample day
    await store.insertEvents([
      { source: "manual", type: "note", start_at: "2026-07-01T10:00:00Z", title: "Old note", data: {} },
      {
        source: "manual",
        type: "meal",
        start_at: "2026-07-01T12:00:00Z",
        end_at: "2026-07-01T12:30:00Z",
        title: "Old lunch",
        data: {},
      },
      { source: "manual", type: "note", start_at: "2026-11-13T10:00:00Z", title: "Fresh note", data: {} },
    ]);
  });
  const result = await runRetention(now);
  assert.ok(result);
  await runAsUser(OWNER, async () => {
    const left = await store.listEvents({ from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" });
    assert.deepEqual(
      left.map((e) => e.title),
      ["Fresh note"],
    );
    const sums = await store.listEventSummaries();
    assert.deepEqual(
      sums.map((s) => [s.day, s.type, s.events, s.seconds]),
      [
        ["2026-07-01", "meal", 1, 1800],
        ["2026-07-01", "note", 1, 0],
      ],
    );
    // A second pass finds nothing.
    assert.deepEqual(await rollUpCurrentUser(retentionCutoff(now)), { summarised: 0, deleted: 0 });
  });
});

test("DELETE /v1/me/data refuses the demo API key", async () => {
  const res = await app.request("/v1/me/data", {
    method: "DELETE",
    headers: { authorization: "Bearer dev-key" },
  });
  assert.equal(res.status, 403);
});

test("DELETE /v1/events/:id really deletes one event", async () => {
  const headers = { authorization: "Bearer dev-key", "content-type": "application/json" };
  const made = await app.request("/v1/events", {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "manual",
      type: "note",
      start_at: "2026-11-14T09:00:00Z",
      title: "Delete me",
    }),
  });
  const id = ((await made.json()) as { events: Event[] }).events[0]?.id;
  assert.ok(id);
  assert.equal((await app.request(`/v1/events/${id}`, { method: "DELETE", headers })).status, 204);
  assert.equal((await app.request(`/v1/events/${id}`, { method: "DELETE", headers })).status, 404);
});

const asSession = (userId: string, path: string) =>
  runAsUser(userId, () => meData.request(path, { method: "DELETE" }), "session");

test("a scoped delete removes only the matching events", async () => {
  await runAsUser(OWNER, async () => {
    await store.deleteMyData({ everything: true });
    await store.insertEvents([
      { source: "chrome", type: "web_visit", start_at: "2026-11-10T10:00:00Z", title: "a", data: {} },
      { source: "chrome", type: "web_visit", start_at: "2026-11-12T10:00:00Z", title: "b", data: {} },
      { source: "manual", type: "note", start_at: "2026-11-10T10:00:00Z", title: "c", data: {} },
    ]);
  });
  const res = await asSession(
    OWNER,
    "/me/data?source=chrome&from=2026-11-09T00:00:00Z&to=2026-11-11T00:00:00Z",
  );
  assert.equal(res.status, 200);
  const body = DataDeleteResult.parse(await res.json());
  assert.equal(body.scope, "timeline");
  assert.equal(body.deleted.events, 1);
  assert.equal(body.account_deleted, false);
  const left = await runAsUser(OWNER, () =>
    store.listEvents({ from: "2026-11-01T00:00:00Z", to: "2026-11-30T00:00:00Z" }),
  );
  assert.deepEqual(left.map((e) => e.title).sort(), ["b", "c"]);
});

test("a full delete removes every row of the user, device keys included, and nobody else's", async () => {
  await runAsUser(OTHER, () =>
    store.insertEvents([
      { source: "manual", type: "note", start_at: "2026-11-14T08:00:00Z", title: "theirs", data: {} },
    ]),
  );
  await runAsUser(
    OWNER,
    async () => {
      await store.insertEvents([
        { source: "manual", type: "note", start_at: "2026-11-14T08:00:00Z", title: "mine", data: {} },
      ]);
      const thread = await store.createChatThread("Sleep this week");
      await store.addChatMessage(thread.id, "user", "hello");
      await store.addEventSummaries(summariseEvents([ev({ start_at: "2026-07-01T10:00:00Z" })]));
      await createPersonalToken("Mac collector");
    },
    "session",
  );
  const res = await asSession(OWNER, "/me/data");
  assert.equal(res.status, 200);
  const body = DataDeleteResult.parse(await res.json());
  assert.equal(body.scope, "everything");
  assert.ok((body.deleted.events ?? 0) >= 1);
  assert.equal(body.deleted.chat_messages, 1);
  assert.equal(body.deleted.chat_threads, 1);
  assert.equal(body.deleted.event_summaries, 1);
  assert.equal(body.deleted.personal_tokens, 1);
  assert.equal(body.account_deleted, false); // no Supabase Auth in tests

  await runAsUser(
    OWNER,
    async () => {
      assert.equal(
        (await store.listEvents({ from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" })).length,
        0,
      );
      assert.equal((await store.listGoals()).length, 0);
      assert.equal((await store.listChatThreads()).length, 0);
      assert.equal((await store.listEventSummaries()).length, 0);
      assert.equal((await listPersonalTokens()).length, 0);
    },
    "session",
  );
  const theirs = await runAsUser(OTHER, () =>
    store.listEvents({ from: "2026-11-14T00:00:00Z", to: "2026-11-15T00:00:00Z" }),
  );
  assert.ok(theirs.some((e) => e.title === "theirs"));
});
