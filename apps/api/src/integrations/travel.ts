import type {
  Event,
  MoveCalendarBlockPayload,
  Place,
  PlaceKey,
  TravelData,
  TravelOption,
  TravelPlanResult,
} from "@michael/shared";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { MINUTE, Zone } from "../patterns/time";
import { goalForEvent, isOwnBlock } from "../score/match";
import type { NewRecommendation, Store } from "../store";
import {
  geocode,
  type LatLng,
  type MapsDeps,
  mapsAvailable,
  metresBetween,
  type RouteEstimate,
  routeAt,
  travelTimes,
} from "./maps";

// Travel between calendar events: for each event with a location, the drive from the previous
// place (the event before it that day, else home) at several departure times. The best one goes
// on the timeline as a travel event (source maps); when leaving later, or moving the user's own
// block, saves real time in traffic, Michael proposes it, tied to the goal the block serves.

// Arrive this early.
const BUFFER = 5 * MINUTE;
// Departure samples after the first: every STEP, at most EXTRA_SAMPLES more.
const STEP = 15 * MINUTE;
const EXTRA_SAMPLES = 5;
// With no event before it, the trip is planned from home starting this long before the event.
const FROM_HOME_WINDOW = 90 * MINUTE;
// Only propose a change worth making.
const MIN_WIN_LEAVE = 10;
const MIN_WIN_MOVE = 15;
const MOVE_SHIFTS = [30, 60, 90].map((m) => m * MINUTE);
// Closer than this is the same place: no trip.
const SAME_PLACE_METRES = 300;

const VIRTUAL =
  /\b(google meet|meet\.google|zoom|teams|webex|skype|hangouts|online|virtual|call)\b|https?:\/\//i;

export interface PlanOptions {
  from: string;
  to: string;
  timezone?: string;
  deps?: MapsDeps;
}

interface Resolved extends LatLng {
  label: string;
  place_key: PlaceKey | null;
}

const minutes = (seconds: number) => Math.round(seconds / 60);
const roundUp = (ms: number, step = 5 * MINUTE) => Math.ceil(ms / step) * step;
const iso = (ms: number) => new Date(ms).toISOString();

const locationOf = (e: Event): string | null => {
  const l = e.data.location;
  return typeof l === "string" && l.trim() && !VIRTUAL.test(l) ? l.trim() : null;
};

const located = (p: Place): p is Place & { lat: number; lng: number } => p.lat !== null && p.lng !== null;

/** A saved place the location names: "Gym", "Home" or "Local gym" all reach the place keyed gym. */
export function matchPlace(location: string, places: Place[]): Place | null {
  const text = location.toLowerCase();
  const exact = places.find((p) => p.label.toLowerCase() === text || p.key === text);
  if (exact) return exact;
  return (
    places.find((p) => {
      const word = p.key.replace(/_/g, " ");
      return new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, "u").test(text);
    }) ?? null
  );
}

async function resolve(
  store: Store,
  location: string,
  places: Place[],
  deps: MapsDeps,
): Promise<Resolved | null> {
  const place = matchPlace(location, places);
  if (place && located(place))
    return { lat: place.lat, lng: place.lng, label: place.label, place_key: place.key };
  const hit = await geocode(store, location, deps);
  return hit ? { lat: hit.lat, lng: hit.lng, label: location, place_key: place?.key ?? null } : null;
}

const option = (r: RouteEstimate): TravelOption => {
  const depart = Date.parse(r.depart_at);
  return { depart_at: r.depart_at, arrive_at: iso(depart + r.seconds * 1000), minutes: minutes(r.seconds) };
};

/** Fewest minutes on the road among trips that arrive in time; on a tie the later departure. */
export function bestOption(options: TravelOption[], arriveBy: number): TravelOption | null {
  const inTime = options.filter((o) => Date.parse(o.arrive_at) <= arriveBy);
  let best: TravelOption | null = null;
  for (const o of inTime) {
    if (!best || o.minutes < best.minutes || (o.minutes === best.minutes && o.depart_at > best.depart_at))
      best = o;
  }
  return best;
}

export async function planTravel(store: Store, opts: PlanOptions): Promise<TravelPlanResult> {
  const deps = opts.deps ?? {};
  const now = (deps.now ?? Date.now)();
  const zone = new Zone(opts.timezone ?? DEFAULT_TIMEZONE);
  const result: TravelPlanResult = {
    status: "ok",
    from: opts.from,
    to: opts.to,
    travel: [],
    recommendations: [],
    skipped: [],
  };
  if (!mapsAvailable(deps)) return { ...result, status: "maps_unavailable" };
  // Location is opt in: the user switches source maps on (saving places does it for them).
  const rules = await store.privacyRules();
  if (rules.offTheRecord || rules.sources.maps?.enabled !== true) return { ...result, status: "travel_off" };

  const [calendar, planned, places, goals, open] = await Promise.all([
    store.listEvents({ from: opts.from, to: opts.to, type: ["calendar_event"] }),
    store.listEvents({ from: opts.from, to: opts.to, source: ["maps"], type: ["travel"] }),
    store.listPlaces(),
    store.listGoals(),
    store.listRecommendations({ status: "proposed" }),
  ]);
  const alreadyPlanned = new Set(planned.map((e) => e.data.calendar_event_id));
  const proposedFor = new Set(open.map((r) => r.action?.payload.event_id).filter(Boolean));
  const home = places.find((p) => p.key === "home");
  const skip = (e: Event, reason: string) => result.skipped.push({ calendar_event_id: e.id, reason });
  const cache = new Map<string, Resolved | null>();
  const where = async (location: string) => {
    if (!cache.has(location)) cache.set(location, await resolve(store, location, places, deps));
    return cache.get(location) ?? null;
  };

  const events = [...calendar].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  for (const [i, e] of events.entries()) {
    const location = locationOf(e);
    if (!location) continue;
    const start = Date.parse(e.start_at);
    if (alreadyPlanned.has(e.id)) continue;
    if (start <= now + 10 * MINUTE) {
      skip(e, "already started");
      continue;
    }
    const dest = await where(location);
    if (!dest) {
      skip(e, "location not found");
      continue;
    }

    // Where the user comes from: the last event that day with a place, else home.
    let origin: Resolved | null = null;
    let freeFrom: number | null = null;
    for (const p of events.slice(0, i).reverse()) {
      const end = p.end_at ? Date.parse(p.end_at) : null;
      const loc = locationOf(p);
      if (!end || end > start || !loc || zone.dayOf(Date.parse(p.start_at)) !== zone.dayOf(start)) continue;
      origin = await where(loc);
      if (origin) {
        freeFrom = end;
        break;
      }
    }
    if (!origin && home && located(home)) {
      origin = { lat: home.lat, lng: home.lng, label: home.label, place_key: "home" };
    }
    if (!origin) {
      skip(e, "no place before it: save home");
      continue;
    }
    if (metresBetween(origin, dest) < SAME_PLACE_METRES) continue;

    const arriveBy = start - BUFFER;
    const first = roundUp(Math.max(freeFrom ?? start - FROM_HOME_WINDOW, now + MINUTE));
    const naiveRoute = await routeAt(origin, dest, first, deps);
    if (!naiveRoute) {
      skip(e, "no route");
      continue;
    }
    const naive = option(naiveRoute);
    const later: number[] = [];
    for (let k = 1; k <= EXTRA_SAMPLES; k++) {
      const d = first + k * STEP;
      if (d + naiveRoute.static_seconds * 1000 > arriveBy) break;
      later.push(d);
    }
    const sampled = [naive, ...(await travelTimes(origin, dest, later, deps)).map(option)];
    const best = bestOption(sampled, arriveBy) ?? naive;
    const won = Math.max(0, naive.minutes - best.minutes);

    const data: TravelData = {
      calendar_event_id: e.id,
      from: { label: origin.label, place_key: origin.place_key },
      to: { label: dest.label, place_key: dest.place_key },
      mode: "drive",
      minutes: best.minutes,
      free_flow_minutes: minutes(naiveRoute.static_seconds),
      distance_km: Math.round(naiveRoute.distance_meters / 100) / 10,
      naive_depart_at: naive.depart_at,
      naive_minutes: naive.minutes,
      won_minutes: won,
      options: sampled,
    };
    const inserted = await store.insertEvents([
      {
        source: "maps",
        type: "travel",
        start_at: best.depart_at,
        end_at: best.arrive_at,
        title: `Drive to ${dest.label}, ${best.minutes} min`,
        data,
        external_id: `travel:${e.id}:${e.start_at}`,
      },
    ]);
    result.travel.push(...inserted.inserted);
    if (proposedFor.has(e.id)) continue;

    const goal = goalForEvent(e, goals)?.goal ?? null;
    let rec: NewRecommendation | null = null;
    if (won >= MIN_WIN_LEAVE) {
      rec = {
        goal_id: goal?.id ?? null,
        title: `Leave at ${zone.clock(Date.parse(best.depart_at))} instead of ${zone.clock(first)}, win ${won} minutes`,
        rationale:
          `Leaving at ${zone.clock(first)} means ${naive.minutes} minutes on the road to ${dest.label}; ` +
          `at ${zone.clock(Date.parse(best.depart_at))} it is ${best.minutes} and you still arrive by ` +
          `${zone.clock(Date.parse(best.arrive_at))} for ${e.title} at ${zone.clock(start)}.`,
        action: {
          kind: "reminder",
          payload: { event_id: e.id, at: best.depart_at, text: `Leave now for ${dest.label}.` },
          involves_others: false,
          undo_until: best.depart_at,
        },
      };
    } else if (isOwnBlock(e) && naive.minutes - data.free_flow_minutes >= MIN_WIN_MOVE) {
      // Leaving later is not enough: move the user's own block past the rush instead.
      const end = Date.parse(e.end_at as string);
      const next = events.slice(i + 1).find((n) => Date.parse(n.start_at) >= end);
      const shifts = (
        await travelTimes(
          origin,
          dest,
          MOVE_SHIFTS.map((s) => first + s),
          deps,
        )
      ).map(option);
      const move = shifts.reduce<TravelOption | null>((b, o) => (!b || o.minutes < b.minutes ? o : b), null);
      if (move && naive.minutes - move.minutes >= MIN_WIN_MOVE) {
        const newStart = roundUp(Date.parse(move.arrive_at) + BUFFER);
        const newEnd = newStart + (end - start);
        const fits = !next || newEnd <= Date.parse(next.start_at);
        const sameDay = zone.dayOf(newEnd - 1) === zone.dayOf(start);
        if (fits && sameDay && newStart > start) {
          const saved = naive.minutes - move.minutes;
          rec = {
            goal_id: goal?.id ?? null,
            title: `Move ${e.title} to ${zone.clock(newStart)}, win ${saved} minutes`,
            rationale:
              `At ${zone.clock(first)} the drive to ${dest.label} takes ${naive.minutes} minutes; ` +
              `after the rush, leaving ${zone.clock(Date.parse(move.depart_at))}, it takes ${move.minutes}.`,
            action: {
              kind: "move_calendar_block",
              // MoveCalendarBlockPayload (executed by actions/calendar.ts), plus where it came from.
              payload: {
                event_id: e.id,
                start_at: iso(newStart),
                end_at: iso(newEnd),
                from_start_at: e.start_at,
              } satisfies MoveCalendarBlockPayload & { from_start_at: string },
              involves_others: false,
              undo_until: e.start_at,
            },
          };
        }
      }
    }
    if (rec) result.recommendations.push(await store.createRecommendation(rec));
  }
  return result;
}
