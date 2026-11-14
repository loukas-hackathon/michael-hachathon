import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Event,
  type MapsQuery,
  type Place,
  PlaceSuggestionsResponse,
  TimelineResponse,
} from "@michael/shared";
import { app } from "../app";
import { suggestPlaces } from "../integrations/place-suggestions";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const stop = (name: string | null, lat: number | null = null, lng: number | null = null) => ({
  name,
  lat,
  lng,
});
const place = (name: string, lat: number | null = null, lng: number | null = null): MapsQuery => ({
  kind: "place",
  place: stop(name, lat, lng),
  from: null,
  to: null,
});
const dir = (from: string, to: string): MapsQuery => ({
  kind: "directions",
  place: null,
  from: stop(from),
  to: stop(to),
});

const searchEvent = (n: number, maps: MapsQuery) => ({
  source: "chrome",
  type: "search",
  start_at: hoursAgo(n),
  title: "maps",
  external_id: `maps-suggest-${n}`,
  data: { engine: "google_maps", term: "maps", origin: "history", maps },
});

test("suggestPlaces: counts places and directions, skips generic and saved ones, hints keys", () => {
  const events = [
    place("Ironworks Gym", 37.97, 23.73),
    place("Ironworks Gym"),
    dir("Pagrati", "Ironworks Gym"),
    dir("Pagrati", "Athens Tech Offices"),
    dir("Pagrati", "Athens Tech Offices"),
    place("coffee near me"),
    place("coffee near me"),
    place("Acropolis Museum", 37.9684, 23.7285),
    place("Acropolis Museum"),
    place("Seen once"),
  ].map((maps, i) => ({ id: `e${i}`, start_at: hoursAgo(20 - i), data: { maps } }) as unknown as Event);
  const saved = [
    { key: "museum", label: "Museum", address: null, lat: 37.9685, lng: 23.7286 },
  ] as unknown as Place[];

  const out = suggestPlaces(events, saved);
  assert.deepEqual(
    out.map((s) => [s.label, s.key, s.count]),
    [
      // Same count: the one seen last comes first.
      ["Pagrati", "home", 3],
      ["Ironworks Gym", "gym", 3],
      ["Athens Tech Offices", "work", 2],
    ],
  );
  assert.deepEqual([out[1]?.lat, out[1]?.lng], [37.97, 23.73]);
});

test("places suggestions: off without maps, coordinates only stored with maps on", async () => {
  let res = await call("GET", "/v1/places/suggestions");
  assert.equal(res.status, 200);
  assert.deepEqual(PlaceSuggestionsResponse.parse(await res.json()), { enabled: false, suggestions: [] });

  // Maps not switched on: names arrive, coordinates are stored as null.
  res = await call("POST", "/v1/events/batch", {
    events: [
      searchEvent(5, place("Ironworks Gym", 37.97, 23.73)),
      searchEvent(4, { kind: "nonsense" } as never),
    ],
  });
  assert.equal(res.status, 201);
  const timeline = TimelineResponse.parse(
    await (
      await call(
        "GET",
        `/v1/timeline?from=${encodeURIComponent(hoursAgo(6))}&to=${encodeURIComponent(hoursAgo(0))}&source=chrome&type=search`,
      )
    ).json(),
  );
  const stored = timeline.events.map((e) => e.data.maps);
  assert.deepEqual(stored[0], place("Ironworks Gym"));
  assert.equal(stored[1], undefined);

  // Switched on: coordinates kept and suggestions offered.
  res = await call("PATCH", "/v1/privacy/sources/maps", { enabled: true });
  assert.equal(res.status, 200);
  await call("POST", "/v1/events/batch", { events: [searchEvent(3, place("Ironworks Gym", 37.97, 23.73))] });
  res = await call("GET", "/v1/places/suggestions");
  const body = PlaceSuggestionsResponse.parse(await res.json());
  assert.equal(body.enabled, true);
  assert.deepEqual(
    body.suggestions.map((s) => [s.label, s.key, s.count, s.lat]),
    [["Ironworks Gym", "gym", 2, 37.97]],
  );

  // Nothing was saved on its own.
  const places = (await (await call("GET", "/v1/places")).json()) as { places: unknown[] };
  assert.equal(places.places.length, 0);
});
