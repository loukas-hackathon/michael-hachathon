import assert from "node:assert/strict";
import { test } from "node:test";
import { TravelDayPlan } from "@michael/shared";
import { runAsUser } from "../context";
import { MemoryStore } from "../store";
import { type DriveFn, dayRules, type PlaceRef, planDay, type Stop } from "./day-plan";
import type { MapsDeps } from "./maps";
import { isFixed, planWholeDay } from "./travel";

// The whole day around traffic (#155). The pure planner gets a fake drive function; the store
// path gets mocked Routes responses. No test ever calls Google.

const at = (hhmm: string) => Date.parse(`2026-11-20T${hhmm}:00Z`);
const MIN = 60_000;

const home: PlaceRef = { key: "home", label: "Home", lat: 38.0, lng: 23.8 };
const office: PlaceRef = { key: "work", label: "Office", lat: 37.98, lng: 23.73 };
const gym: PlaceRef = { key: "gym", label: "Gym", lat: 38.05, lng: 23.81 };
const errand: PlaceRef = { key: "errand", label: "Errand", lat: 37.95, lng: 23.7 };

// Rush: departures from 16:00 to 17:59 take 50 minutes, any other time 20.
const rushDrive = (calls: string[] = []): DriveFn => {
  return async (from, to, departAt) => {
    calls.push(`${from.key}>${to.key}@${new Date(departAt).toISOString().slice(11, 16)}`);
    return departAt >= at("16:00") && departAt < at("18:00") ? 50 : 20;
  };
};

const stop = (id: string, from: string, to: string, place: PlaceRef | null, movable: boolean): Stop => ({
  id,
  title: id,
  start: at(from),
  end: at(to),
  place,
  movable,
});

// A meeting with other people at noon, then two of the user's own blocks in the rush.
const day = (): Stop[] => [
  stop("Meeting", "12:00", "13:00", office, false),
  stop("Gym", "17:00", "18:00", gym, true),
  stop("Errand", "18:30", "19:00", errand, true),
];
const window = { from: at("07:00"), to: at("22:00") };

test("day plan: moving both blocks beats moving one, the meeting stays", async () => {
  const plan = await planDay({ stops: day(), home, window, drive: rushDrive() });
  assert.ok(plan);
  // Before: home 20, office to gym 50 (rush), gym to errand 50 (rush), home 20.
  assert.equal(plan.beforeMinutes, 140);
  // Every drive out of the rush.
  assert.equal(plan.afterMinutes, 80);
  assert.equal(plan.wonMinutes, 60);
  assert.deepEqual(
    plan.moves.map((m) => [m.id, new Date(m.start).toISOString().slice(11, 16)]),
    [
      ["Gym", "16:30"],
      ["Errand", "19:00"],
    ],
  );
  assert.ok(!plan.moves.some((m) => m.id === "Meeting"));

  // Moving only one block wins less: the best single move costs 110 minutes.
  const gymOnly = await planDay({
    stops: day().map((s) => (s.id === "Errand" ? { ...s, movable: false } : s)),
    home,
    window,
    drive: rushDrive(),
  });
  assert.equal(gymOnly?.afterMinutes, 110);

  // The maths per drive: into the gym, 50 minutes before and 20 after.
  const toGym = plan.drives.find((d) => d.to_event_id === "Gym");
  assert.deepEqual([toGym?.before?.minutes, toGym?.after?.minutes], [50, 20]);
  assert.equal(plan.drives.find((d) => d.to_event_id === null)?.to, "Home");
});

test("day plan: a meeting and a fixed block never move, even when that would win time", async () => {
  const stops = day().map((s) => ({ ...s, movable: false }));
  const plan = await planDay({ stops, home, window, drive: rushDrive() });
  assert.deepEqual(plan?.moves, []);
  assert.equal(plan?.wonMinutes, 0);
});

test("day plan: blocks never overlap another event and stay inside the window", async () => {
  const stops = [
    stop("Meeting", "15:00", "16:30", office, false),
    stop("Gym", "17:00", "18:00", gym, true),
    stop("Call", "18:00", "19:00", null, false),
  ];
  const plan = await planDay({
    stops,
    home,
    window: { from: at("07:00"), to: at("20:00") },
    drive: rushDrive(),
  });
  assert.ok(plan);
  for (const m of plan.moves) {
    assert.ok(m.start >= at("07:00") && m.end <= at("20:00"));
    for (const o of stops.filter((s) => s.id !== m.id)) assert.ok(m.end <= o.start || m.start >= o.end);
  }
});

test("day plan: a standing instruction (home by 19:30) is respected", async () => {
  const plan = await planDay({ stops: day(), home, window, homeBy: at("19:30"), drive: rushDrive() });
  assert.ok(plan);
  const back = plan.drives.find((d) => d.to_event_id === null)?.after;
  assert.ok(back);
  assert.ok(Date.parse(back.depart_at) + back.minutes * MIN <= at("19:30"));
  // Without the instruction the errand would move to 19:00 and get home at 19:50.
  assert.ok(!plan.moves.some((m) => m.id === "Errand" && m.end > at("19:10")));
});

test("day plan: drive answers are reused, and no answer means no plan", async () => {
  const calls: string[] = [];
  await planDay({ stops: day(), home, window, drive: rushDrive(calls) });
  assert.ok(calls.length > 0);
  const none = await planDay({ stops: day(), home, window, drive: async () => null });
  assert.equal(none, null);
});

test("standing instructions: home by and keep a day clear", () => {
  assert.deepEqual(dayRules(["Home by 21:00 on weekdays", "home by 20"], 3), {
    homeBy: "20:00",
    keepClear: false,
  });
  assert.equal(dayRules(["Keep Sundays clear"], 0).keepClear, true);
  assert.equal(dayRules(["Keep Sundays clear"], 1).keepClear, false);
  assert.equal(dayRules(["keep weekends free"], 6).keepClear, true);
});

// ---------- through the store, with mocked Routes ----------

const NOW = Date.parse("2026-11-20T06:00:00Z");

function routesMock(calls: string[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("geocode")) {
      return Response.json({
        status: "OK",
        results: [{ formatted_address: "Somewhere", geometry: { location: { lat: 37.95, lng: 23.7 } } }],
      });
    }
    const body = JSON.parse(String(init?.body)) as { departureTime: string };
    calls.push(body.departureTime);
    const depart = Date.parse(body.departureTime);
    const rush = depart >= at("16:00") && depart < at("18:00");
    return Response.json({
      routes: [{ duration: `${rush ? 3000 : 1200}s`, staticDuration: "1200s", distanceMeters: 12_000 }],
    });
  }) as typeof fetch;
}

const deps = (calls: string[]): MapsDeps => ({
  apiKey: "test-key",
  fetch: routesMock(calls),
  now: () => NOW,
});

const calendar = (title: string, start: string, end: string, location: string, attendees = 0) => ({
  source: "google_calendar" as const,
  type: "calendar_event" as const,
  start_at: `2026-11-20T${start}:00Z`,
  end_at: `2026-11-20T${end}:00Z`,
  title,
  data: { location, attendees },
  external_id: `test-${title}`,
});

async function seed(store: MemoryStore) {
  await store.replacePlaces([
    { key: "home", label: "Home", address: null, lat: 38.0, lng: 23.8 },
    { key: "work", label: "Work", address: null, lat: 37.98, lng: 23.73 },
    { key: "gym", label: "Gym", address: null, lat: 38.05, lng: 23.81 },
  ]);
  // Times are UTC; Athens is UTC+2, so 17:00Z is 19:00 local.
  await store.insertEvents([
    calendar("Client meeting", "12:00", "13:00", "Work", 2),
    calendar("Gym", "17:00", "18:00", "Gym"),
    calendar("Pick up parcel", "18:30", "19:00", "Kifisias 12, Marousi"),
  ]);
}

test("whole day: one recommendation moves both own blocks, the meeting stays, one undo deadline", async () => {
  const store = new MemoryStore();
  const calls: string[] = [];
  await runAsUser(crypto.randomUUID(), async () => {
    await seed(store);
    const plan = TravelDayPlan.parse(await planWholeDay(store, { day: "2026-11-20", deps: deps(calls) }));
    assert.equal(plan.won_minutes, 60);
    assert.deepEqual(plan.moves.map((m) => m.title).sort(), ["Gym", "Pick up parcel"]);
    assert.ok(plan.recommendation_id);
    assert.ok(calls.length <= 60);

    const rec = await store.getRecommendation(plan.recommendation_id);
    assert.equal(rec?.title, "Plan today around traffic: win 60 minutes");
    assert.equal(rec?.action?.kind, "move_calendar_blocks");
    assert.equal(rec?.action?.involves_others, false);
    const moves = rec?.action?.payload.moves as { event_id: string }[];
    assert.equal(moves.length, 2);
    // Undo until the earliest of the original and new starts.
    assert.equal(rec?.action?.undo_until, "2026-11-20T16:30:00.000Z");
    assert.match(rec?.rationale ?? "", /140 minutes on the road becomes 80/);

    // Planning again proposes nothing new.
    const again = await planWholeDay(store, { day: "2026-11-20", deps: deps(calls) });
    assert.equal(again.recommendation_id, plan.recommendation_id);
    const open = await store.listRecommendations({ status: "proposed" });
    assert.equal(open.filter((r) => r.action?.kind === "move_calendar_blocks").length, 1);
  });
});

test("whole day: a block the user marked fixed never moves", async () => {
  const store = new MemoryStore();
  await runAsUser(crypto.randomUUID(), async () => {
    await seed(store);
    const profile = await store.getProfile();
    await store.saveProfile({ ...(profile as object), fixed_titles: ["gym"] } as never);
    const plan = await planWholeDay(store, { day: "2026-11-20", deps: deps([]) });
    assert.ok(!plan.moves.some((m) => m.title === "Gym"));
    assert.ok(!plan.moves.some((m) => m.title === "Client meeting"));
  });
});

test("whole day: needs home, and a kept clear day stays as it is", async () => {
  const store = new MemoryStore();
  await runAsUser(crypto.randomUUID(), async () => {
    await store.insertEvents([calendar("Gym", "17:00", "18:00", "Gym")]);
    const noHome = await planWholeDay(store, { day: "2026-11-20", deps: deps([]) });
    assert.match(noHome.note ?? "", /home/);
    await seed(store);
    const clear = await planWholeDay(store, {
      day: "2026-11-20",
      deps: deps([]),
      instructions: ["Keep Fridays clear"],
    });
    assert.deepEqual([clear.moves.length, clear.recommendation_id], [0, null]);
  });
});

test("isFixed: the event flag or a listed title", () => {
  const e = (title: string, data: Record<string, unknown> = {}) =>
    ({ title, data, type: "calendar_event" }) as Parameters<typeof isFixed>[0];
  assert.equal(isFixed(e("PT session", { fixed: true }), []), true);
  assert.equal(isFixed(e("PT session 07:00"), ["PT session"]), true);
  assert.equal(isFixed(e("Gymnastics"), ["Gym"]), false);
  assert.equal(isFixed(e("Gym"), []), false);
});
