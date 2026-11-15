import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { BlockChange, Event } from "@michael/shared";

// env.ts reads process.env on import, so configure Google before loading the app.
process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret-xyz";

const { Hono } = await import("hono");
const { v1Routes: routes } = await import("../app");
const { errorResponse, HttpError } = await import("../http");
const { runAsUser } = await import("../context");
const { store } = await import("../store");
const { setGoogleFetch } = await import("../integrations/google");
const { syncGoogleCalendar } = await import("../integrations/calendar-sync");
const { fakeGoogle, gEvent } = await import("../integrations/fake-google");
const { withoutInstructions } = await import("../instructions/testkit");

// The /v1 routes with the API's error shape, run as whichever user the test is in.
const v1Routes = new Hono()
  .route("/v1", routes)
  .onError((err, c) =>
    err instanceof HttpError
      ? errorResponse(c, err.code, err.message)
      : errorResponse(c, "internal", String(err)),
  );

const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
// Tomorrow at a round hour, so nothing has started.
const at = (hour: number) => {
  const d = new Date(Date.now() + 24 * HOUR);
  d.setUTCHours(hour, 0, 0, 0);
  return d.getTime();
};

const asNewUser = <T>(fn: () => Promise<T>) =>
  runAsUser(randomUUID(), async () => {
    await withoutInstructions(store);
    return fn();
  });

async function call(method: string, path: string, body?: unknown) {
  const res = await v1Routes.request(`/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as BlockChange & { error?: { message: string } } };
}

const day = async () =>
  store.listEvents({ from: iso(Date.now()), to: iso(Date.now() + 3 * 24 * HOUR), type: ["calendar_event"] });

test("without Google: create with a goal, move, rename, remove, and undo each", () =>
  asNewUser(async () => {
    const goal = await store.createGoal({
      category: "business",
      title: "Ship it",
      weekly_budget_minutes: 300,
      active: true,
    });
    const created = await call("POST", "/blocks", {
      start_at: iso(at(9)),
      end_at: iso(at(10)),
      title: "Deep work",
      goal_id: goal.id,
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const ev = created.json.event as Event;
    assert.equal(ev.title, "Deep work");
    assert.equal(ev.data.goal_id, goal.id);
    assert.equal(ev.data.michael, true);
    assert.equal(created.json.undo_until, iso(at(9)));

    // Move keeps the length; the change is undoable, and is not listed as advice.
    const moved = await call("PATCH", `/blocks/${ev.id}`, { start_at: iso(at(15)) });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(moved.json.event?.start_at, iso(at(15)));
    assert.equal(moved.json.event?.end_at, iso(at(16)));
    const recs = await v1Routes.request("/v1/recommendations");
    const { recommendations } = (await recs.json()) as { recommendations: { id: string }[] };
    assert.ok(!recommendations.some((r) => r.id === moved.json.recommendation_id));
    const undo = await v1Routes.request(`/v1/recommendations/${moved.json.recommendation_id}/undo`, {
      method: "POST",
    });
    assert.equal(undo.status, 200);
    assert.equal((await store.getEvent(ev.id))?.start_at, iso(at(9)));

    // Resize and rename, then a goal change that undo puts back.
    const renamed = await call("PATCH", `/blocks/${ev.id}`, { end_at: iso(at(11)), title: "Write the deck" });
    assert.equal(renamed.json.event?.title, "Write the deck");
    assert.equal(renamed.json.event?.end_at, iso(at(11)));
    const cleared = await call("PATCH", `/blocks/${ev.id}`, { goal_id: null });
    assert.equal(cleared.json.event?.data.goal_id, undefined);
    await v1Routes.request(`/v1/recommendations/${cleared.json.recommendation_id}/undo`, { method: "POST" });
    assert.equal((await store.getEvent(ev.id))?.data.goal_id, goal.id);

    // Remove, then undo puts it back.
    const removed = await call("DELETE", `/blocks/${ev.id}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.equal(removed.json.event, null);
    assert.equal((await day()).length, 0);
    await v1Routes.request(`/v1/recommendations/${removed.json.recommendation_id}/undo`, { method: "POST" });
    const back = await day();
    assert.equal(back.length, 1);
    assert.equal(back[0]?.title, "Write the deck");
    assert.equal(back[0]?.data.goal_id, goal.id);
  }));

test("refuses the past, events with other people, and removing the user's own events", () =>
  asNewUser(async () => {
    const past = await call("POST", "/blocks", { start_at: iso(Date.now() - HOUR), end_at: iso(Date.now()) });
    assert.equal(past.status, 409);
    const { inserted } = await store.insertEvents([
      {
        source: "google_calendar",
        type: "calendar_event",
        start_at: iso(at(12)),
        end_at: iso(at(13)),
        title: "Board meeting",
        data: { with_others: true, attendees: 4 },
        external_id: "board",
      },
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(at(14)),
        end_at: iso(at(15)),
        title: "My own thing",
        data: {},
        external_id: "mine",
      },
    ]);
    const [board, mine] = inserted as [Event, Event];
    const move = await call("PATCH", `/blocks/${board.id}`, { start_at: iso(at(16)) });
    assert.equal(move.status, 409);
    assert.match(move.json.error?.message ?? "", /other people/);
    const remove = await call("DELETE", `/blocks/${mine.id}`);
    assert.equal(remove.status, 409);
    assert.ok(await store.getEvent(mine.id), "never deletes the user's own events");
    // The user's own solo block still moves.
    const ok = await call("PATCH", `/blocks/${mine.id}`, { start_at: iso(at(17)) });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  }));

test("with Google: the block, its goal and the move land in Google; remove and undo too", () =>
  asNewUser(async () => {
    const g = fakeGoogle([gEvent("solo", at(8), 30)]);
    setGoogleFetch(g.fetch);
    await store.saveIntegration("google_calendar", {
      status: "connected",
      access_token: "live",
      refresh_token: "refresh-1",
      expires_at: iso(Date.now() + HOUR),
    });
    const goal = await store.createGoal({
      category: "health",
      title: "Run",
      weekly_budget_minutes: 120,
      active: true,
    });
    const created = await call("POST", "/blocks", {
      start_at: iso(at(7)),
      end_at: iso(at(8)),
      title: "Run",
      goal_id: goal.id,
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const ev = created.json.event as Event;
    const gid = ev.external_id as string;
    assert.equal(g.events.get(gid)?.extendedProperties?.private?.goal_id, goal.id);
    // A sync keeps the goal on the mirror.
    await syncGoogleCalendar();
    const mirrored = (await day()).find((e) => e.external_id === gid);
    assert.equal(mirrored?.data.goal_id, goal.id);

    const moved = await call("PATCH", `/blocks/${ev.id}`, { start_at: iso(at(18)) });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(Date.parse(g.events.get(gid)?.start?.dateTime ?? ""), at(18));
    assert.equal(g.events.get(gid)?.extendedProperties?.private?.michael, "1");

    const removed = await call("DELETE", `/blocks/${moved.json.event?.id ?? ev.id}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.equal(g.events.has(gid), false);
    await v1Routes.request(`/v1/recommendations/${removed.json.recommendation_id}/undo`, { method: "POST" });
    const back = [...g.events.values()].find((e) => e.summary === "Run");
    assert.ok(back, "undo puts the block back in Google");
    assert.equal(back?.extendedProperties?.private?.goal_id, goal.id);
    // The user's own solo event in Google is never removed.
    const solo = (await day()).find((e) => e.external_id === "solo");
    if (solo) assert.equal((await call("DELETE", `/blocks/${solo.id}`)).status, 409);
    assert.ok(g.events.has("solo"));
  }));
