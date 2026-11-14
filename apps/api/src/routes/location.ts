import {
  type Event,
  LocationSignalsInput,
  type LocationSignalsResponse,
  type LocationStatus,
  type Place,
  WifiMappingInput,
  type WifiNetwork,
} from "@michael/shared";
import { Hono } from "hono";
import { HttpError, jsonBody, parse } from "../http";
import {
  applySignals,
  calendarLocationAt,
  classify,
  NOW_MS,
  POINT_GAP_MS,
  plannedVisits,
  VISIT_SOURCE,
  type Visit,
  visitEvent,
  visitFromEvent,
} from "../location/visits";
import { isCollecting } from "../privacy";
import { store } from "../store";

// Where the user is (docs/location.md, docs/api.md "Location"). Signals in, place visits out.

const DAY_MS = 24 * 3600_000;
const NETWORK_DAYS = 14;
const iso = (ms: number) => new Date(ms).toISOString();

const visitsIn = async (from: number, to: number) =>
  (await store.listEvents({ from: iso(from), to: iso(to), source: [VISIT_SOURCE], type: ["location"] }))
    .map(visitFromEvent)
    .filter((v): v is Visit => v !== null)
    .sort((a, b) => a.start - b.start);

/** Turns signals into visits on the current user's timeline. Shared by the route and tests. */
export async function recordSignals(body: unknown): Promise<LocationSignalsResponse> {
  const { signals } = parse(LocationSignalsInput, body);
  if (!(await isCollecting(store, VISIT_SOURCE))) return { recorded: 0, ignored: signals.length, at: null };
  // The first signal is the opt in, as with every other source (privacy.ts).
  const rules = await store.privacyRules();
  if (rules.sources[VISIT_SOURCE] === undefined) await store.setSourceEnabled(VISIT_SOURCE, true);

  const times = signals.map((s) => Date.parse(s.at));
  const first = Math.min(...times);
  const last = Math.max(...times);
  const [places, recent, calendar] = await Promise.all([
    store.listPlaces(),
    visitsIn(first - DAY_MS, last + 60_000),
    store.listEvents({ from: iso(first - DAY_MS), to: iso(last + 60_000), type: ["calendar_event"] }),
  ]);
  // The visit going on: the newest that started before these signals and is still within reach.
  const open = recent.filter((v) => v.start <= first && first - v.end <= POINT_GAP_MS).at(-1) ?? null;
  const touched = applySignals(
    open,
    signals.map((s) => classify(s, places)),
    (at) => calendarLocationAt(at, calendar) ?? "Out",
  );
  if (touched.length) await store.upsertEvents(touched.map(visitEvent));
  return { recorded: signals.length, ignored: 0, at: touched.at(-1)?.label ?? open?.label ?? null };
}

/** The Location page: the latest signal, where the user is now, and the Wi-Fi networks seen. */
export async function locationStatus(now = Date.now()): Promise<LocationStatus> {
  const [visits, places, collecting] = await Promise.all([
    visitsIn(now - NETWORK_DAYS * DAY_MS, now + 60_000),
    store.listPlaces(),
    isCollecting(store, VISIT_SOURCE),
  ]);
  const latest = visits.reduce<Visit | null>((a, v) => (!a || v.end > a.end ? v : a), null);
  const mapped = new Map(places.flatMap((p) => (p.wifi ?? []).map((w) => [w, p.key] as const)));
  const seen = new Map<string, WifiNetwork>();
  for (const v of visits) {
    for (const network of v.data.networks) {
      const before = seen.get(network);
      const place_key = mapped.get(network) ?? null;
      // While unmapped, the place the phone put the user at while this network was on.
      const suggested = !place_key && v.data.place_key ? v.data.place_key : null;
      seen.set(network, {
        network,
        name: v.data.names?.[network] ?? before?.name ?? null,
        place_key,
        suggested_place_key: suggested ?? before?.suggested_place_key ?? null,
        last_seen_at: iso(Math.max(v.end, before ? Date.parse(before.last_seen_at) : 0)),
      });
    }
  }
  return {
    last_signal_at: latest ? iso(latest.end) : null,
    now: latest && now - latest.end <= NOW_MS ? { label: latest.label, since: iso(latest.start) } : null,
    networks: [...seen.values()].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at)),
    collecting,
  };
}

/** "This is Home's Wi-Fi": maps the network, and relabels the last two weeks of "Out" on it. */
export async function mapNetwork(body: unknown, now = Date.now()): Promise<LocationStatus> {
  const input = parse(WifiMappingInput, body);
  const places = await store.listPlaces();
  const target = input.place_key ? places.find((p) => p.key === input.place_key) : null;
  if (input.place_key && !target) throw new HttpError("not_found", "No saved place with that key");
  const next: Omit<Place, "updated_at">[] = places.map(({ updated_at: _, ...p }) => {
    const wifi = (p.wifi ?? []).filter((w) => w !== input.network);
    return { ...p, wifi: p.key === input.place_key ? [...wifi, input.network] : wifi };
  });
  await store.replacePlaces(next);
  if (target) {
    const events = await store.listEvents({
      from: iso(now - NETWORK_DAYS * DAY_MS),
      to: iso(now + 60_000),
      source: [VISIT_SOURCE],
      type: ["location"],
    });
    for (const e of events) await relabel(e, input.network, target);
  }
  return locationStatus(now);
}

async function relabel(e: Event, network: string, place: Place) {
  const v = visitFromEvent(e);
  if (!v || v.data.place_key !== null || !v.data.networks.includes(network)) return;
  const { lat: _lat, lng: _lng, ...data } = v.data;
  await store.updateEvent(e.id, { title: place.label, data: { ...data, place_key: place.key } });
}

/** Lines for agents and the chat: calendar events at saved places with no signal over them. */
export async function plannedVisitLines(from: string, to: string, clock: (ms: number) => string) {
  const [places, calendar, events] = await Promise.all([
    store.listPlaces(),
    store.listEvents({ from, to, type: ["calendar_event"] }),
    store.listEvents({ from, to, source: [VISIT_SOURCE], type: ["location"] }),
  ]);
  if (!places.length) return [];
  const visits = events.map(visitFromEvent).filter((v): v is Visit => v !== null);
  return plannedVisits(calendar, places, visits).map(
    (p) => `${clock(p.start)} to ${clock(p.end)} at ${p.label} (planned in the calendar, not confirmed)`,
  );
}

export const location = new Hono()
  .get("/location", async (c) => c.json(await locationStatus()))
  .post("/location/signals", async (c) => c.json(await recordSignals(await jsonBody(c))))
  .put("/location/networks", async (c) => c.json(await mapNetwork(await jsonBody(c))));
