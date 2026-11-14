import {
  type Event,
  type MoveCalendarBlockPayload,
  type Place,
  type PlaceKey,
  Profile,
  type TravelData,
  type TravelDayPlan,
  type TravelOption,
  type TravelPlanResult,
} from "@michael/shared";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { MINUTE, Zone } from "../patterns/time";
import { goalForEvent, isOwnBlock, normaliseTitle } from "../score/match";
import type { NewRecommendation, Store } from "../store";
import { type DriveFn, dayRules, type PlaceRef, planDay, type Stop } from "./day-plan";
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
  /** False: store the drives but propose nothing per block (the whole day plan proposes instead). */
  propose?: boolean;
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
    if (proposedFor.has(e.id) || opts.propose === false) continue;

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

// ---------- the whole day (#155) ----------

// Same threshold as one block at a time: propose only a change worth making.
const MIN_WIN_DAY = 10;
// Routes calls one day plan may make (each is billed). Arrangements needing more are not tried.
const MAX_DAY_ROUTES = 60;

export interface DayPlanOptions {
  /** The local day to plan ("YYYY-MM-DD"). */
  day: string;
  timezone?: string;
  deps?: MapsDeps;
  /** The user's standing instructions, in their own words ("home by 21:00"). */
  instructions?: string[];
}

const clockMinutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const placeKeyOf = (location: string) => `geo:${location.toLowerCase().replace(/\s+/g, " ").trim()}`;

/** True when the user listed this title as fixed (profile.fixed_titles), or the event says so. */
export function isFixed(e: Event, fixedTitles: string[]): boolean {
  if (e.data.fixed === true) return true;
  const title = normaliseTitle(e.title);
  return fixedTitles.some((t) => {
    const entry = normaliseTitle(t);
    if (!entry || !title.startsWith(entry)) return false;
    return title.length === entry.length || !/[\p{L}\p{N}]/u.test(title[entry.length] ?? "");
  });
}

/**
 * Plan the whole day around traffic: one recommendation that moves the user's own blocks out of
 * the rush, meetings with other people fixed. Assumes maps are available and travel is on.
 */
export async function planWholeDay(store: Store, opts: DayPlanOptions): Promise<TravelDayPlan> {
  const deps = opts.deps ?? {};
  const now = (deps.now ?? Date.now)();
  const zone = new Zone(opts.timezone ?? DEFAULT_TIMEZONE);
  const dayStart = zone.startOfDay(opts.day);
  const dayEnd = zone.startOfDay(zone.nextDay(opts.day));
  const plan: TravelDayPlan = {
    day: opts.day,
    before_minutes: 0,
    after_minutes: 0,
    won_minutes: 0,
    moves: [],
    drives: [],
    recommendation_id: null,
    note: null,
  };
  const note = (text: string): TravelDayPlan => ({ ...plan, note: text });

  const [calendar, places, goals, open, rawProfile] = await Promise.all([
    store.listEvents({ from: iso(dayStart), to: iso(dayEnd), type: ["calendar_event"] }),
    store.listPlaces(),
    store.listGoals(),
    store.listRecommendations({ status: "proposed" }),
    store.getProfile(),
  ]);
  const profile = Profile.partial().safeParse(rawProfile ?? {});
  const fixedTitles = (profile.success && profile.data.fixed_titles) || [];
  const quiet = (profile.success && profile.data.quiet_hours) || { start: "22:00", end: "07:00" };
  const weekday = new Date(`${opts.day}T12:00:00Z`).getUTCDay();
  const rules = dayRules(opts.instructions ?? [], weekday);

  const homePlace = places.find((p) => p.key === "home");
  const home: PlaceRef | null =
    homePlace && located(homePlace)
      ? { key: "home", label: homePlace.label, lat: homePlace.lat, lng: homePlace.lng }
      : null;
  if (!home) return note("Save your home first, so I know where the day starts.");

  const stops: Stop[] = [];
  const byId = new Map<string, Event>();
  for (const e of calendar) {
    if (!e.end_at || e.data.all_day === true) continue;
    const start = Date.parse(e.start_at);
    if (zone.dayOf(start) !== opts.day) continue;
    const location = locationOf(e);
    const dest = location ? await resolve(store, location, places, deps) : null;
    const place: PlaceRef | null = dest
      ? { key: dest.place_key ?? placeKeyOf(location ?? ""), label: dest.label, lat: dest.lat, lng: dest.lng }
      : null;
    stops.push({
      id: e.id,
      title: e.title,
      start,
      end: Date.parse(e.end_at),
      place,
      movable: Boolean(place) && isOwnBlock(e) && !isFixed(e, fixedTitles) && start > now + 10 * MINUTE,
    });
    byId.set(e.id, e);
  }
  if (!stops.some((s) => s.place)) return note("No drives that day: nothing has a place.");
  if (rules.keepClear) return note("You asked to keep this day clear, so I leave it as it is.");

  const quietEnd = clockMinutes(quiet.end);
  const quietStart = clockMinutes(quiet.start);
  const window = {
    from: Math.max(zone.at(opts.day, quietEnd), now + 10 * MINUTE),
    to: zone.at(opts.day, quietStart > quietEnd ? quietStart : 1440 + quietStart),
  };

  let calls = 0;
  const memo = new Map<string, Promise<number | null>>();
  const drive: DriveFn = (from, to, departAt) => {
    const key = `${from.key}|${to.key}|${departAt}`;
    let hit = memo.get(key);
    if (!hit) {
      if (calls >= MAX_DAY_ROUTES) return Promise.resolve(null);
      calls++;
      hit = routeAt(from, to, departAt, deps).then((r) => (r ? minutes(r.seconds) : null));
      memo.set(key, hit);
    }
    return hit;
  };

  const result = await planDay({
    stops,
    home,
    window,
    homeBy: rules.homeBy ? zone.at(opts.day, clockMinutes(rules.homeBy)) : null,
    drive,
  });
  if (!result) return note("I could not get drive times for that day.");

  const filled: TravelDayPlan = {
    ...plan,
    before_minutes: result.beforeMinutes,
    after_minutes: result.afterMinutes,
    won_minutes: result.wonMinutes,
    moves: result.moves.map((m) => ({
      event_id: m.id,
      title: m.title,
      from_start_at: iso(m.fromStart),
      start_at: iso(m.start),
      end_at: iso(m.end),
    })),
    drives: result.drives,
  };
  if (result.moves.length === 0 || result.wonMinutes < MIN_WIN_DAY) {
    return { ...filled, note: "The day is already planned well around traffic." };
  }

  // One open day plan per set of blocks: never propose the same thing twice.
  const ids = new Set(result.moves.map((m) => m.id));
  const twin = open.find(
    (r) =>
      r.action?.kind === "move_calendar_blocks" &&
      Array.isArray(r.action.payload.moves) &&
      (r.action.payload.moves as { event_id?: string }[]).some((m) => m.event_id && ids.has(m.event_id)),
  );
  if (twin) return { ...filled, recommendation_id: twin.id };

  const rec = await store.createRecommendation(dayRecommendation(filled, zone, now, byId, goals));
  return { ...filled, recommendation_id: rec.id };
}

/** The one recommendation for a day plan: every move, the maths, one undo. */
export function dayRecommendation(
  plan: TravelDayPlan,
  zone: Zone,
  now: number,
  events: Map<string, Event>,
  goals: Awaited<ReturnType<Store["listGoals"]>>,
): NewRecommendation {
  const dayStart = zone.startOfDay(plan.day);
  const dayName =
    zone.dayOf(now) === plan.day
      ? "today"
      : new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: zone.name }).format(
          dayStart + 12 * 3600_000,
        );
  const words = plan.moves.map((m) => `${m.title} to ${zone.clock(Date.parse(m.start_at))}`);
  const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : (words[0] ?? "");
  const goal = plan.moves
    .map((m) => events.get(m.event_id))
    .map((e) => (e ? goalForEvent(e, goals)?.goal : undefined))
    .find(Boolean);
  const firstStart = Math.min(
    ...plan.moves.flatMap((m) => [Date.parse(m.from_start_at), Date.parse(m.start_at)]),
  );
  return {
    goal_id: goal?.id ?? null,
    title: `Plan ${dayName} around traffic: win ${plan.won_minutes} minutes`,
    rationale:
      `Move ${list}. ${plan.before_minutes} minutes on the road becomes ${plan.after_minutes}; ` +
      "meetings with other people stay where they are.",
    action: {
      kind: "move_calendar_blocks",
      payload: {
        moves: plan.moves.map((m) => ({
          event_id: m.event_id,
          start_at: m.start_at,
          end_at: m.end_at,
          from_start_at: m.from_start_at,
          title: m.title,
        })),
        before_minutes: plan.before_minutes,
        after_minutes: plan.after_minutes,
        won_minutes: plan.won_minutes,
        drives: plan.drives,
      },
      involves_others: false,
      undo_until: iso(firstStart),
    },
  };
}
