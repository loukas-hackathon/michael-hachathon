import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type EventInput, MeetingsState } from "@michael/shared";
import { Hono } from "hono";
import type { z } from "zod";
import { v1Routes } from "../app";
import { type AuthMethod, runAsUser } from "../context";
import { errorResponse, HttpError } from "../http";
import { decideEvent, type PrivacyRules } from "../privacy";
import { store } from "../store";
import { plannedEnd, recapOf } from "./meetings";

// Meetings mode (#400): conversations only while the user started it, off the record still wins.

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

const sessions = new Hono()
  .use(async (c, next) => runAsUser(c.req.header("x-test-user") as string, next, "session" as AuthMethod))
  .route("/v1", v1Routes)
  .onError((err, c) =>
    err instanceof HttpError
      ? errorResponse(c, err.code, err.message)
      : errorResponse(c, "internal", String(err)),
  );

const call = (user: string, method: string, path: string, body?: unknown) =>
  sessions.request(path, {
    method,
    headers: { "x-test-user": user, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const conversation = (startMs: number, items: string[] = []): z.output<typeof EventInput> => ({
  source: "omi",
  type: "conversation",
  start_at: iso(startMs),
  end_at: iso(startMs + 20 * MIN),
  title: "Planning call",
  data: { summary: "Agreed the plan.", action_items: items },
  external_id: `omi:${randomUUID()}`,
});

// ---------- the rule ----------

test("a conversation is kept only inside a meetings mode window; off the record still wins", () => {
  const t0 = Date.parse("2026-11-15T12:00:00Z");
  const rules: PrivacyRules = {
    offTheRecord: false,
    since: null,
    sources: {},
    meetings: [{ start: iso(t0), end: iso(t0 + 60 * MIN) }],
  };
  const at = (ms: number) => ({ source: "omi" as const, type: "conversation", start_at: iso(ms) });
  assert.equal(decideEvent(rules, at(t0 + 10 * MIN)), "collect", "inside");
  assert.equal(decideEvent(rules, at(t0 - MIN)), "collect", "a breath before the tap");
  assert.equal(decideEvent(rules, at(t0 - 10 * MIN)), "no_meeting", "before");
  assert.equal(decideEvent(rules, at(t0 + 61 * MIN)), "no_meeting", "after");
  assert.equal(
    decideEvent({ ...rules, meetings: undefined }, at(t0 + 10 * MIN)),
    "no_meeting",
    "never started",
  );
  // Any conversation needs it, whatever sent it; other events never do; the user's own typing is theirs.
  assert.equal(
    decideEvent(rules, { source: "agent", type: "conversation", start_at: iso(t0 - HOUR) }),
    "no_meeting",
  );
  assert.equal(
    decideEvent(rules, { source: "chrome", type: "web_visit", start_at: iso(t0 - HOUR) }),
    "collect",
  );
  assert.equal(
    decideEvent(rules, { source: "manual", type: "conversation", start_at: iso(t0 - HOUR) }),
    "collect",
  );
  assert.equal(decideEvent({ ...rules, offTheRecord: true }, at(t0 + 10 * MIN)), "off_the_record");
  assert.equal(
    decideEvent({ ...rules, sources: { omi: { enabled: false, updated_at: iso(t0) } } }, at(t0 + 10 * MIN)),
    "source_disabled",
  );
});

test("it ends by itself after 2 hours, or at the end of the calendar block it began in", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const block = (s: number, e: number, data: Record<string, unknown> = {}) => ({
    start_at: iso(s),
    end_at: iso(e),
    data,
  });
  assert.equal(plannedEnd(now, []), iso(now + 2 * HOUR));
  assert.equal(
    plannedEnd(now, [block(now - 30 * MIN, now + 30 * MIN)]),
    iso(now + 30 * MIN),
    "current block",
  );
  assert.equal(
    plannedEnd(now, [block(now + 10 * MIN, now + 70 * MIN)]),
    iso(now + 70 * MIN),
    "about to start",
  );
  assert.equal(
    plannedEnd(now, [block(now - HOUR, now + 5 * MIN)]),
    iso(now + 2 * HOUR),
    "a tail is not the meeting",
  );
  assert.equal(
    plannedEnd(now, [block(now - HOUR, now + 5 * HOUR)]),
    iso(now + 2 * HOUR),
    "never past 2 hours",
  );
  assert.equal(plannedEnd(now, [block(now - HOUR, now + 30 * MIN, { all_day: true })]), iso(now + 2 * HOUR));
});

test("the recap keeps the user's commitments and a lesson, from conversations inside the session only", () => {
  const t0 = Date.parse("2026-11-15T12:00:00Z");
  const session = {
    id: randomUUID(),
    started_at: iso(t0),
    ends_at: iso(t0 + 2 * HOUR),
    ended_at: iso(t0 + HOUR),
  };
  const ev = (ms: number, data: Record<string, unknown>) => ({ id: randomUUID(), start_at: iso(ms), data });
  const r = recapOf(session, [
    ev(t0 + 5 * MIN, {
      action_items: ["Send the deck by Friday", "Book the rehearsal"],
      lesson: "Lead with the ask.",
    }),
    ev(t0 + 30 * MIN, { action_items: ["Send the deck by Friday"] }),
    ev(t0 + 90 * MIN, { action_items: ["After it ended"] }),
  ]);
  assert.deepEqual(
    r.commitments.map((c) => c.text),
    ["Send the deck by Friday", "Book the rehearsal"],
  );
  assert.equal(r.lesson, "Lead with the ask.");
  assert.equal(r.conversation_ids.length, 2);
  assert.equal(r.ended_at, iso(t0 + HOUR));
});

// ---------- ingest, through the store ----------

test("ingest drops a conversation outside a session, keeps one inside, and off the record wins", () =>
  runAsUser(randomUUID(), async () => {
    const now = Date.now();
    const before = await store.insertEvents([conversation(now - 3 * HOUR, ["Outside"])]);
    assert.equal(before.inserted.length, 0);
    assert.equal(before.ignored, 1);

    const s = await store.createMeetingSession({ started_at: iso(now - HOUR), ends_at: iso(now + HOUR) });
    const inside = await store.insertEvents([conversation(now - 30 * MIN, ["Inside"])]);
    assert.equal(inside.inserted.length, 1);
    // Still outside: a session never reaches back before its own start.
    assert.equal((await store.insertEvents([conversation(now - 3 * HOUR)])).ignored, 1);

    // Off the record ends the session and drops everything, even inside the window.
    await store.setOffTheRecord(true);
    const [ended] = await store.listMeetingSessions({ limit: 1 });
    assert.equal(ended?.id, s.id);
    assert.ok(ended?.ended_at, "off the record ended the session");
    const off = await store.insertEvents([conversation(now - 20 * MIN)]);
    assert.equal(off.inserted.length, 0);
    await store.setOffTheRecord(false);
    // Back on the record, the session already ended: a conversation from after it stays out.
    assert.equal((await store.insertEvents([conversation(Date.now() + MIN)])).ignored, 1);
  }));

// ---------- the API ----------

test("start needs consent the first time, then start, active, end and the recap", async () => {
  const user = randomUUID();
  const first = await call(user, "POST", "/v1/meetings/start", {});
  assert.equal(first.status, 409, "consent first");
  const empty = MeetingsState.parse(await (await call(user, "GET", "/v1/meetings/active")).json());
  assert.deepEqual(empty, { consented: false, active: null, last: null });

  const started = MeetingsState.parse(
    await (await call(user, "POST", "/v1/meetings/start", { consent: true })).json(),
  );
  assert.equal(started.consented, true);
  assert.ok(started.active);
  assert.equal(started.active.ended_at, null);
  // Twice is the same session.
  const again = MeetingsState.parse(await (await call(user, "POST", "/v1/meetings/start")).json());
  assert.equal(again.active?.id, started.active.id);

  // A conversation while it runs is kept, with the user's commitments.
  await runAsUser(user, () =>
    store.insertEvents([conversation(Date.now() - MIN, ["Send the deck by Friday"])]),
  );

  const ended = MeetingsState.parse(await (await call(user, "POST", "/v1/meetings/end")).json());
  assert.equal(ended.active, null);
  assert.equal(ended.last?.session_id, started.active.id);
  assert.deepEqual(
    ended.last?.commitments.map((c) => c.text),
    ["Send the deck by Friday"],
  );

  // One tap puts it on today's outcomes.
  const added = await call(user, "POST", "/v1/meetings/commitments", { text: "Send the deck by Friday" });
  assert.equal(added.status, 201);
  // Ending again changes nothing; a new start needs no consent body.
  assert.equal((await call(user, "POST", "/v1/meetings/end")).status, 200);
  const next = MeetingsState.parse(await (await call(user, "POST", "/v1/meetings/start")).json());
  assert.ok(next.active && next.active.id !== started.active.id);
  await call(user, "POST", "/v1/meetings/end");
});

test("off the record refuses a start", async () => {
  const user = randomUUID();
  await call(user, "PUT", "/v1/privacy/off-the-record", { off_the_record: true });
  assert.equal((await call(user, "POST", "/v1/meetings/start", { consent: true })).status, 409);
});

test("one account's meeting never opens another's conversations", async () => {
  const a = randomUUID();
  const b = randomUUID();
  await call(a, "POST", "/v1/meetings/start", { consent: true });
  const bState = MeetingsState.parse(await (await call(b, "GET", "/v1/meetings/active")).json());
  assert.deepEqual(bState, { consented: false, active: null, last: null });
  const dropped = await runAsUser(b, () => store.insertEvents([conversation(Date.now() - MIN)]));
  assert.equal(dropped.ignored, 1, "B's conversation is dropped while A is in a meeting");
  // B ending does not end A's.
  await call(b, "POST", "/v1/meetings/end");
  const aState = MeetingsState.parse(await (await call(a, "GET", "/v1/meetings/active")).json());
  assert.ok(aState.active);
  await call(a, "POST", "/v1/meetings/end");
});
