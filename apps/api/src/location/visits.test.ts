import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, LocationSignal, Place } from "@michael/shared";
import {
  applySignals,
  calendarLocationAt,
  classify,
  placeProof,
  placeRole,
  plannedVisits,
  type Visit,
  visitEvent,
  visitFromEvent,
} from "./visits";

const U = "2026-11-16T";
const at = (hm: string) => `${U}${hm}:00.000Z`;
const ms = (hm: string) => Date.parse(at(hm));

const place = (key: string, label: string, lat: number, lng: number, wifi: string[] = []): Place => ({
  key,
  label,
  address: null,
  lat,
  lng,
  wifi,
  updated_at: at("00:00"),
});
const HOME = place("home", "Home", 37.9838, 23.7275, ["net-home"]);
const GYM = place("gym", "Gym", 38.0, 23.8);
const WORK = place("work", "Office", 37.97, 23.73);
const PLACES = [HOME, GYM, WORK];

const point = (hm: string, lat: number, lng: number): LocationSignal => ({ kind: "point", at: at(hm), lat, lng });
const wifi = (hm: string, network: string, name?: string): LocationSignal => ({
  kind: "wifi",
  at: at(hm),
  network,
  name,
});
const run = (open: Visit | null, signals: LocationSignal[], label?: (at: number) => string) =>
  applySignals(
    open,
    signals.map((s) => classify(s, PLACES)),
    label,
  );

test("a point within 150 m of a saved place is that place; further out it is Out, rounded", () => {
  // About 100 m north of the gym.
  assert.equal(classify(point("10:00", 38.0009, 23.8), PLACES).place?.key, "gym");
  // About 300 m away: not the gym.
  const far = classify(point("10:00", 38.0027, 23.8), PLACES);
  assert.equal(far.place, null);
  assert.deepEqual(far.coarse, { lat: 38, lng: 23.8 });
});

test("phone points at the gym make one visit from the first to the last", () => {
  const [v] = run(null, [point("18:05", 38.0, 23.8), point("19:20", 38.0001, 23.8)]);
  assert.equal(v?.label, "Gym");
  assert.equal(v?.start, ms("18:05"));
  assert.equal(v?.end, ms("19:20"));
  assert.deepEqual(v?.data.evidence, ["phone"]);
});

test("a mapped Wi-Fi network extends Home; a silence over 20 minutes starts a new visit", () => {
  const visits = run(null, [wifi("08:00", "net-home"), wifi("08:01", "net-home"), wifi("08:40", "net-home")]);
  assert.equal(visits.length, 2);
  assert.deepEqual(
    visits.map((v) => [v.label, v.start, v.end]),
    [
      ["Home", ms("08:00"), ms("08:01")],
      ["Home", ms("08:40"), ms("08:40")],
    ],
  );
});

test("an unmapped network joins the visit the phone placed, which is how a mapping is suggested", () => {
  const [v] = run(null, [point("09:00", 37.97, 23.73), wifi("09:01", "net-office", "Acme"), wifi("09:15", "net-office")]);
  assert.equal(v?.label, "Office");
  assert.deepEqual(v?.data.networks, ["net-office"]);
  assert.deepEqual(v?.data.names, { "net-office": "Acme" });
  assert.deepEqual(v?.data.evidence, ["phone", "wifi"]);
  assert.equal(v?.end, ms("09:15"));
});

test("a different unmapped network after the first is somewhere else", () => {
  const visits = run(null, [wifi("09:00", "net-a"), wifi("09:05", "net-b")]);
  assert.deepEqual(
    visits.map((v) => [v.label, v.data.networks]),
    [
      ["Out", ["net-a"]],
      ["Out", ["net-b"]],
    ],
  );
});

test("Out takes the calendar event's location when one covers the moment", () => {
  const calendar = [
    {
      type: "calendar_event",
      start_at: at("13:00"),
      end_at: at("14:00"),
      data: { location: "Taverna Kostas, Plaka, Athens" },
    } as unknown as Event,
  ];
  const label = (t: number) => calendarLocationAt(t, calendar) ?? "Out";
  const [v] = run(null, [point("13:10", 37.9, 23.6)], label);
  assert.equal(v?.label, "Taverna Kostas");
  assert.equal(v?.data.lat, 37.9);
});

test("the open visit is extended, and only changed visits come back", () => {
  const open: Visit = {
    start: ms("18:00"),
    end: ms("18:30"),
    label: "Gym",
    data: { place_key: "gym", evidence: ["phone"], networks: [] },
  };
  assert.deepEqual(run(open, []), []);
  const [v] = run(open, [point("19:00", 38.0, 23.8)]);
  assert.equal(v?.start, ms("18:00"));
  assert.equal(v?.end, ms("19:00"));
  // Same start, same external id: the stored event is updated in place.
  assert.equal(visitEvent(v as Visit).external_id, visitEvent(open).external_id);
  // Leaving: the open visit is untouched, a new one starts.
  const moved = run(open, [point("19:10", 37.9838, 23.7275)]);
  assert.deepEqual(
    moved.map((x) => x.label),
    ["Home"],
  );
});

test("a visit survives the trip to an event and back", () => {
  const [v] = run(null, [point("18:05", 38.0, 23.8), point("19:20", 38.0, 23.8)]);
  const e = { ...visitEvent(v as Visit), id: "x", created_at: at("19:20") } as Event;
  assert.deepEqual(visitFromEvent(e), v);
});

test("calendar events at a saved place are planned visits, unless a signal covers them", () => {
  const cal = (title: string, from: string, to: string, location: string) =>
    ({ type: "calendar_event", title, start_at: at(from), end_at: at(to), data: { location } }) as unknown as Event;
  const calendar = [
    cal("Gym", "07:00", "08:00", "Gym"),
    cal("Standup", "09:00", "09:15", "https://meet.google.com/abc"),
    cal("Lecture", "11:00", "13:00", "University"),
    cal("Deep work", "14:00", "16:00", "Office"),
  ];
  const confirmed: Visit[] = [
    { start: ms("14:10"), end: ms("15:50"), label: "Office", data: { place_key: "work", evidence: ["wifi"], networks: [] } },
  ];
  const planned = plannedVisits(calendar, PLACES, confirmed);
  // No university saved, the call is online, the office block is confirmed by Wi-Fi.
  assert.deepEqual(
    planned.map((p) => [p.label, p.title]),
    [["Gym", "Gym"]],
  );
});

test("gyms back training goals, work and university back business goals", () => {
  assert.equal(placeRole({ key: "gym", label: "Gym" }), "training");
  assert.equal(placeRole({ key: "pool", label: "OAKA pool" }), "training");
  assert.equal(placeRole({ key: "work", label: "Office" }), "business");
  assert.equal(placeRole({ key: "university", label: "University" }), "business");
  assert.equal(placeRole({ key: "home", label: "Home" }), null);

  const [gym] = run(null, [point("18:05", 38.0, 23.8), point("19:20", 38.0, 23.8)]);
  const e = { ...visitEvent(gym as Visit), id: "x", created_at: at("19:20") } as Event;
  const proof = placeProof([e], PLACES);
  assert.deepEqual(proof.training, [{ start: ms("18:05"), end: ms("19:20") }]);
  assert.deepEqual(proof.business, []);
});
