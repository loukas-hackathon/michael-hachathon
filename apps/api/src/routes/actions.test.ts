import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DEMO_RECOMMENDATION_IDS,
  mockRecommendations,
  type Recommendation,
  type RecommendationAction,
} from "@michael/shared";

// env.ts reads process.env on import, so configure Google before loading the app.
process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret-xyz";

const { app } = await import("../app");
const { runAsUser } = await import("../context");
const { store } = await import("../store");
const { setGoogleFetch } = await import("../integrations/google");
const { syncGoogleCalendar } = await import("../integrations/calendar-sync");
const { executeRecommendation, undoRecommendation } = await import("../actions/calendar");
const { fakeGoogle, gEvent } = await import("../integrations/fake-google");

const HOUR = 3600_000;
const auth = { Authorization: "Bearer dev-key" };
const [MOVE_ID, CREATE_ID, NO_ACTION_ID] = mockRecommendations.map((r) => r.id) as [string, string, string];
const iso = (ms: number) => new Date(ms).toISOString();

// Each test acts as a fresh user with its own copy of the mock recommendations.
const asNewUser = <T>(fn: () => Promise<T>) => runAsUser(randomUUID(), fn);

async function connect(events: Parameters<typeof fakeGoogle>[0] = []) {
  const g = fakeGoogle(events);
  setGoogleFetch(g.fetch);
  await store.saveIntegration("google_calendar", {
    status: "connected",
    access_token: "live",
    refresh_token: "refresh-1",
    expires_at: iso(Date.now() + HOUR),
  });
  return g;
}

// The memory store hands out live objects, so a test can give a recommendation the action it needs.
async function withAction(
  id: string,
  action: Partial<RecommendationAction> & Pick<RecommendationAction, "payload">,
) {
  const rec = (await store.getRecommendation(id)) as Recommendation;
  rec.status = "proposed";
  rec.action = {
    kind: rec.action?.kind ?? "create_focus_block",
    involves_others: false,
    undo_until: null,
    ...action,
  };
  return rec;
}

async function mirrorOf(googleId: string) {
  const events = await store.listEvents({
    from: iso(Date.now() - 8 * 24 * HOUR),
    to: iso(Date.now() + 8 * 24 * HOUR),
    source: ["google_calendar"],
  });
  return events.find((e) => e.external_id === googleId) ?? null;
}

test("create_focus_block: a tagged block in Google and on the timeline, and undo removes only that", () =>
  asNewUser(async () => {
    const g = await connect();
    const start = Date.now() + 2 * HOUR;
    await withAction(CREATE_ID, {
      payload: { start_at: iso(start), end_at: iso(start + HOUR), title: "Focus: pitch" },
    });

    const done = await executeRecommendation(CREATE_ID);
    assert.equal(done.status, "done");
    assert.ok(done.executed_at);
    const [created] = [...g.events.values()];
    assert.equal(created?.summary, "Focus: pitch");
    assert.equal(created?.extendedProperties?.private?.michael, "1");
    const local = await mirrorOf(created?.id ?? "");
    assert.equal(local?.data.michael, true);
    assert.equal(local?.data.with_others, false);

    await assert.rejects(executeRecommendation(CREATE_ID), /Already done/);

    const undone = await undoRecommendation(CREATE_ID);
    assert.equal(undone.status, "undone");
    assert.ok(undone.undone_at);
    assert.equal(g.events.size, 0);
    assert.equal(await mirrorOf(created?.id ?? ""), null);
  }));

test("move_calendar_block: moves the user's solo block keeping its length, undo puts it back", () =>
  asNewUser(async () => {
    const start = Date.now() + 3 * HOUR;
    const g = await connect([gEvent("gym", start, 90, { summary: "Gym: legs" })]);
    await syncGoogleCalendar();
    const block = await mirrorOf("gym");
    assert.ok(block);
    const to = Date.now() + 5 * HOUR;
    await withAction(MOVE_ID, {
      kind: "move_calendar_block",
      payload: { event_id: block.id, start_at: iso(to) },
    });

    await executeRecommendation(MOVE_ID);
    const moved = g.events.get("gym");
    assert.equal(moved?.start?.dateTime, iso(to));
    assert.equal(moved?.end?.dateTime, iso(to + 90 * 60_000));
    assert.equal((await mirrorOf("gym"))?.start_at, iso(to));

    await undoRecommendation(MOVE_ID);
    const back = g.events.get("gym");
    assert.equal(Date.parse(back?.start?.dateTime ?? ""), start);
    assert.equal(back?.summary, "Gym: legs");
    assert.equal(Date.parse((await mirrorOf("gym"))?.start_at ?? ""), start);
    assert.ok(g.events.has("gym"), "undo never deletes the user's own event");
  }));

test("refuses events with other people, even when they were invited after the last sync", () =>
  asNewUser(async () => {
    const start = Date.now() + 3 * HOUR;
    const meeting = gEvent("meet", start, 30, {
      attendees: [{ email: "me@example.com", self: true }, { email: "vc@example.com" }],
    });
    const g = await connect([meeting, gEvent("solo", start + HOUR, 30)]);
    await syncGoogleCalendar();

    const m = await mirrorOf("meet");
    await withAction(MOVE_ID, {
      kind: "move_calendar_block",
      payload: { event_id: m?.id, start_at: iso(start + 6 * HOUR) },
    });
    await assert.rejects(executeRecommendation(MOVE_ID), /other people/);

    // Mirror says solo, but someone was invited in Google since: Google wins.
    const solo = g.events.get("solo");
    if (solo) solo.attendees = [{ email: "me@example.com", self: true }, { email: "friend@example.com" }];
    const s = await mirrorOf("solo");
    await withAction(MOVE_ID, {
      kind: "move_calendar_block",
      payload: { event_id: s?.id, start_at: iso(start + 6 * HOUR) },
    });
    await assert.rejects(executeRecommendation(MOVE_ID), /other people/);
    assert.equal(Date.parse(g.events.get("solo")?.start?.dateTime ?? ""), start + HOUR);

    await withAction(CREATE_ID, {
      involves_others: true,
      payload: { start_at: iso(start), end_at: iso(start + HOUR) },
    });
    await assert.rejects(executeRecommendation(CREATE_ID), /other people/);
    assert.equal(g.events.size, 2);
  }));

test("undo is refused once undo_until has passed, and never deletes a block that is not Michael's", () =>
  asNewUser(async () => {
    const g = await connect();
    const start = Date.now() + 2 * HOUR;
    await withAction(CREATE_ID, {
      // Already passed: no sleep, so a slow machine cannot make this race.
      undo_until: iso(Date.now() - 1000),
      payload: { start_at: iso(start), end_at: iso(start + HOUR) },
    });
    await executeRecommendation(CREATE_ID);
    await assert.rejects(undoRecommendation(CREATE_ID), /Too late/);
    assert.equal(g.events.size, 1);

    await withAction(CREATE_ID, { payload: { start_at: iso(start + HOUR), end_at: iso(start + 2 * HOUR) } });
    await executeRecommendation(CREATE_ID);
    const mine = [...g.events.values()].find((e) => Date.parse(e.start?.dateTime ?? "") === start + HOUR);
    if (mine) mine.extendedProperties = {};
    await assert.rejects(undoRecommendation(CREATE_ID), /not mine/);
    assert.equal(g.events.size, 2);
  }));

test("past times and other action kinds are refused", () =>
  asNewUser(async () => {
    await connect();
    await withAction(CREATE_ID, {
      payload: { start_at: iso(Date.now() - HOUR), end_at: iso(Date.now() + HOUR) },
    });
    await assert.rejects(executeRecommendation(CREATE_ID), /already started/);
    await withAction(CREATE_ID, { kind: "block_mac_app", payload: { app: "com.apple.Safari" } });
    await assert.rejects(executeRecommendation(CREATE_ID), /cannot be carried out yet/);
  }));

test("without Google Calendar: Michael's block lives on the timeline only, and undo removes it", () =>
  asNewUser(async () => {
    const start = Date.now() + 2 * HOUR;
    await withAction(CREATE_ID, { payload: { start_at: iso(start), end_at: iso(start + HOUR) } });
    await executeRecommendation(CREATE_ID);
    const range = { from: iso(start - HOUR), to: iso(start + 2 * HOUR), source: ["agent" as const] };
    const [block] = await store.listEvents(range);
    assert.equal(block?.data.michael, true);

    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(start + 3 * HOUR),
        end_at: iso(start + 4 * HOUR),
        title: "Read",
        data: {},
      },
    ]);
    const read = inserted[0];
    assert.ok(read);
    await withAction(MOVE_ID, {
      kind: "move_calendar_block",
      payload: { event_id: read.id, new_title: "Read: book" },
    });
    await executeRecommendation(MOVE_ID);
    assert.equal((await store.getEvent(read.id))?.title, "Read: book");
    await undoRecommendation(MOVE_ID);
    assert.equal((await store.getEvent(read.id))?.title, "Read");

    await undoRecommendation(CREATE_ID);
    assert.deepEqual(await store.listEvents(range), []);
  }));

test("routes: bad id, unknown id, nothing to do, undo before execute", async () => {
  assert.equal((await app.request(`/v1/recommendations/${MOVE_ID}/execute`, { method: "POST" })).status, 401);
  const bad = await app.request("/v1/recommendations/nope/execute", { method: "POST", headers: auth });
  assert.equal(bad.status, 400);
  const unknown = await app.request(`/v1/recommendations/${randomUUID()}/execute`, {
    method: "POST",
    headers: auth,
  });
  assert.equal(unknown.status, 404);
  const empty = await app.request(`/v1/recommendations/${NO_ACTION_ID}/execute`, {
    method: "POST",
    headers: auth,
  });
  assert.equal(empty.status, 409);
  const early = await app.request(`/v1/recommendations/${CREATE_ID}/undo`, { method: "POST", headers: auth });
  assert.equal(early.status, 409);
});

test("the demo always has blocks ahead to carry out, and advice with other people stays advice", () =>
  asNewUser(async () => {
    const [focus, run, sync] = DEMO_RECOMMENDATION_IDS;
    for (const id of [focus, run]) {
      assert.equal((await executeRecommendation(id)).status, "done");
      assert.equal((await undoRecommendation(id)).status, "undone");
    }
    await assert.rejects(executeRecommendation(sync), /other people/);
  }));
