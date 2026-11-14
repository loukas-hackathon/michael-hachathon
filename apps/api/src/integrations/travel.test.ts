import assert from "node:assert/strict";
import { test } from "node:test";
import { TravelData, TravelPlanResult } from "@michael/shared";
import { runAsUser } from "../context";
import { MemoryStore } from "../store";
import { geocode, type MapsDeps, routeAt } from "./maps";
import { planTravel } from "./travel";

// Mocked Google responses: no test ever calls Google.

const NOW = Date.parse("2026-11-20T06:00:00Z");
// Athens is UTC+2 in November. Rush hour on the mocked roads: departures 17:00 to 17:29 local.
const RUSH_FROM = Date.parse("2026-11-20T15:00:00Z");
const RUSH_TO = Date.parse("2026-11-20T15:30:00Z");

interface Call {
  url: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

function mockFetch(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body, headers: (init?.headers as Record<string, string>) ?? {} });
    if (url.includes("geocode")) {
      const address = new URL(url).searchParams.get("address");
      if (address === "Nowhere at all") return Response.json({ status: "ZERO_RESULTS", results: [] });
      return Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "Leof. Kifisias 1, Athina",
            place_id: "abc",
            geometry: { location: { lat: 37.99, lng: 23.75 } },
          },
        ],
      });
    }
    const depart = Date.parse(String(body?.departureTime));
    const rush = depart >= RUSH_FROM && depart < RUSH_TO;
    return Response.json({
      routes: [{ duration: `${rush ? 50 * 60 : 20 * 60}s`, staticDuration: "1200s", distanceMeters: 12_400 }],
    });
  }) as typeof fetch;
}

const deps = (calls: Call[]): MapsDeps => ({ apiKey: "test-key", fetch: mockFetch(calls), now: () => NOW });
const user = () => crypto.randomUUID();

const places = [
  { key: "home", label: "Home", address: null, lat: 38.0, lng: 23.8 },
  { key: "work", label: "Work", address: null, lat: 37.98, lng: 23.73 },
  { key: "gym", label: "Gym", address: null, lat: 38.05, lng: 23.81 },
];

const calendar = (title: string, start: string, end: string, location: string, attendees = 0) => ({
  source: "google_calendar" as const,
  type: "calendar_event" as const,
  start_at: start,
  end_at: end,
  title,
  data: { location, attendees },
  external_id: `test-${title}-${start}`,
});

const range = { from: "2026-11-19T22:00:00Z", to: "2026-11-20T22:00:00Z" };

test("routeAt sends a traffic aware request with a field mask and parses durations", async () => {
  const calls: Call[] = [];
  const r = await routeAt({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, RUSH_FROM, deps(calls));
  assert.deepEqual(r, {
    depart_at: new Date(RUSH_FROM).toISOString(),
    seconds: 3000,
    static_seconds: 1200,
    distance_meters: 12_400,
  });
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.headers["X-Goog-Api-Key"], "test-key");
  assert.equal(
    call.headers["X-Goog-FieldMask"],
    "routes.duration,routes.staticDuration,routes.distanceMeters",
  );
  assert.equal(call.body?.routingPreference, "TRAFFIC_AWARE");
  assert.equal(call.body?.travelMode, "DRIVE");
});

test("geocode caches hits per user and returns null for no result", async () => {
  const store = new MemoryStore();
  const calls: Call[] = [];
  await runAsUser(user(), async () => {
    const a = await geocode(store, "Kifisias 1, Athens", deps(calls));
    const b = await geocode(store, "  kifisias 1,   ATHENS ", deps(calls));
    assert.equal(a?.lat, 37.99);
    assert.deepEqual(a, b);
    assert.equal(calls.length, 1);
    assert.equal(await geocode(store, "Nowhere at all", deps(calls)), null);
  });
});

test("travel: degrades without a key, and needs the maps opt in", async () => {
  const store = new MemoryStore();
  await runAsUser(user(), async () => {
    const off = await planTravel(store, { ...range, deps: { now: () => NOW } });
    assert.equal(off.status, "maps_unavailable");
    const calls: Call[] = [];
    const noOptIn = await planTravel(store, { ...range, deps: deps(calls) });
    assert.equal(noOptIn.status, "travel_off");
    assert.equal(calls.length, 0);
  });
});

test("travel: leave later to skip the rush, stored on the timeline and proposed", async () => {
  const store = new MemoryStore();
  const calls: Call[] = [];
  await runAsUser(user(), async () => {
    await store.replacePlaces(places);
    await store.setSourceEnabled("maps", true);
    await store.insertEvents([
      calendar("Deep work", "2026-11-20T13:00:00Z", "2026-11-20T15:00:00Z", "Work"),
      calendar("Gym: upper body", "2026-11-20T16:30:00Z", "2026-11-20T17:30:00Z", "Local gym"),
      calendar("Standup", "2026-11-20T09:00:00Z", "2026-11-20T09:15:00Z", "Google Meet", 4),
    ]);
    const out = TravelPlanResult.parse(await planTravel(store, { ...range, deps: deps(calls) }));
    assert.equal(out.status, "ok");

    // Deep work: from home at 13:30 local (no rush); gym: from work.
    assert.equal(out.travel.length, 2);
    const gym = out.travel.find((t) => t.title.startsWith("Drive to Gym"));
    assert.ok(gym);
    const data = TravelData.parse(gym.data);
    assert.equal(data.from.place_key, "work");
    assert.equal(data.to.place_key, "gym");
    assert.equal(data.naive_minutes, 50);
    assert.equal(data.minutes, 20);
    assert.equal(data.won_minutes, 30);
    // Latest of the fastest departures that still arrive by 18:25 local.
    assert.equal(gym.start_at, "2026-11-20T16:00:00.000Z");

    assert.equal(out.recommendations.length, 1);
    const rec = out.recommendations[0];
    assert.ok(rec);
    assert.equal(rec.title, "Leave at 18:00 instead of 17:00, win 30 minutes");
    assert.equal(rec.action?.kind, "reminder");
    assert.equal(rec.status, "proposed");
    const goals = await store.listGoals();
    assert.equal(rec.goal_id, goals.find((g) => g.title.startsWith("70.3 training"))?.id);

    // Planning again adds nothing and calls Google no more.
    const before = calls.length;
    const again = await planTravel(store, { ...range, deps: deps(calls) });
    assert.deepEqual([again.travel.length, again.recommendations.length, calls.length], [0, 0, before]);
    const timeline = await store.listEvents({ ...range, type: ["travel"] });
    assert.equal(timeline.length, 2);
  });
});

test("travel: when leaving later cannot work, move the user's own block past the rush", async () => {
  const store = new MemoryStore();
  const calls: Call[] = [];
  await runAsUser(user(), async () => {
    await store.replacePlaces(places);
    await store.setSourceEnabled("maps", true);
    await store.insertEvents([
      calendar("Deep work", "2026-11-20T13:00:00Z", "2026-11-20T15:00:00Z", "Work"),
      calendar("Gym: legs", "2026-11-20T15:40:00Z", "2026-11-20T16:40:00Z", "Gym"),
    ]);
    const out = await planTravel(store, { ...range, deps: deps(calls) });
    const rec = out.recommendations.find((r) => r.action?.kind === "move_calendar_block");
    assert.ok(rec);
    assert.equal(rec.title, "Move Gym: legs to 17:55, win 30 minutes");
    assert.equal(rec.action?.involves_others, false);
    assert.equal(rec.action?.payload.start_at, "2026-11-20T15:55:00.000Z");
    assert.ok(rec.action?.payload.event_id);
    assert.equal(rec.action?.payload.end_at, "2026-11-20T16:55:00.000Z");
    assert.equal(rec.action?.undo_until, "2026-11-20T15:40:00Z");
  });
});

test("travel: never proposes moving a meeting with other people", async () => {
  const store = new MemoryStore();
  const calls: Call[] = [];
  await runAsUser(user(), async () => {
    await store.replacePlaces(places);
    await store.setSourceEnabled("maps", true);
    await store.insertEvents([
      calendar("Deep work", "2026-11-20T13:00:00Z", "2026-11-20T15:00:00Z", "Work"),
      calendar("Client review", "2026-11-20T15:40:00Z", "2026-11-20T16:40:00Z", "Gym", 3),
    ]);
    const out = await planTravel(store, { ...range, deps: deps(calls) });
    assert.equal(out.travel.length, 2);
    assert.equal(out.recommendations.length, 0);
  });
});
