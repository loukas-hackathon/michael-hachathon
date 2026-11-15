import { LocationSignalsInput, type LocationSignalsResponse, type LocationStatus } from "@michael/shared";
import { Hono } from "hono";
import { jsonBody, parse } from "../http";
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
// How far back the Location page looks for the latest visit.
const STATUS_DAYS = 14;
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

/** The Location page: the latest signal and where the user is now. */
export async function locationStatus(now = Date.now()): Promise<LocationStatus> {
  const [visits, collecting] = await Promise.all([
    visitsIn(now - STATUS_DAYS * DAY_MS, now + 60_000),
    isCollecting(store, VISIT_SOURCE),
  ]);
  const latest = visits.reduce<Visit | null>((a, v) => (!a || v.end > a.end ? v : a), null);
  return {
    last_signal_at: latest ? iso(latest.end) : null,
    now: latest && now - latest.end <= NOW_MS ? { label: latest.label, since: iso(latest.start) } : null,
    collecting,
  };
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
  .post("/location/signals", async (c) => c.json(await recordSignals(await jsonBody(c))));
