import type { Place, TravelData, TravelOption } from "@michael/shared";
import { metresBetween } from "../integrations/maps";
import { matchPlace } from "../integrations/travel";
import { iso, localDate, weekday } from "./time";
import { DEMO_PREFIX, type EventRow } from "./week";

// Travel for the demo week, precomputed: the demo never calls Google. Drive times come from a
// simple Athens traffic model (distance, plus the rush hours), in exactly the shape the travel
// planner stores (integrations/travel.ts), so Today and Timeline show drives on stage. The
// demo's places are neighbourhoods, never a real address.

export const DEMO_PLACES: Omit<Place, "updated_at">[] = [
  { key: "home", label: "Home", address: "Chalandri, Athens", lat: 38.0213, lng: 23.7986 },
  { key: "work", label: "Work", address: "Marousi, Athens", lat: 38.0496, lng: 23.8066 },
  { key: "gym", label: "Gym", address: "Neo Psychiko, Athens", lat: 38.0008, lng: 23.7795 },
  { key: "university", label: "University", address: "Patision, Athens", lat: 37.9941, lng: 23.7323 },
  { key: "venue", label: "Hackathon venue", address: "Gazi, Athens", lat: 37.9785, lng: 23.7136 },
];

const MIN = 60_000;
const STEP = 15 * MIN;
const BUFFER = 5 * MIN;
const FROM_HOME = 90 * MIN;

/** Local minutes since midnight in Athens. */
function athensMinutes(ms: number): number {
  const [h = 0, m = 0] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(ms)
    .split(":")
    .map(Number);
  return h * 60 + m;
}

/** How much slower than empty roads at this departure: Athens rush hours, lighter at the weekend. */
export function rushFactor(departAt: number): number {
  const m = athensMinutes(departAt);
  const weekend = [0, 6].includes(weekday(localDate(departAt)));
  if (!weekend && m >= 8 * 60 && m < 9 * 60 + 45) return 1.8;
  if (weekend) return m >= 17 * 60 && m < 19 * 60 ? 1.6 : 1;
  return m >= 16 * 60 + 30 && m < 19 * 60 + 30 ? 2 : 1;
}

/** Minutes on empty roads between two places: city driving, about 25 km/h plus parking. */
export function freeFlowMinutes(a: Place | Omit<Place, "updated_at">, b: Place | Omit<Place, "updated_at">) {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return 0;
  const km = (metresBetween({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) / 1000) * 1.3;
  return Math.round((km / 25) * 60 + 6);
}

export const demoDrive = (a: Omit<Place, "updated_at">, b: Omit<Place, "updated_at">, departAt: number) =>
  Math.round(freeFlowMinutes(a, b) * rushFactor(departAt));

const roundUp = (ms: number, step = 5 * MIN) => Math.ceil(ms / step) * step;

export interface DemoTrip {
  /** The calendar event's external id (the demo's stand in for its timeline id). */
  calendarExternalId: string;
  title: string;
  start: number;
  naive: TravelOption;
  best: TravelOption;
  wonMinutes: number;
  to: string;
}

/**
 * The drives of one day's calendar, as `planTravel` would store them, plus what leaving later
 * wins. Only events whose location is one of the demo places count.
 */
export function demoTravel(calendar: EventRow[]): { rows: EventRow[]; trips: DemoTrip[] } {
  const places = DEMO_PLACES as Place[];
  const home = places.find((p) => p.key === "home") as Place;
  const sorted = [...calendar].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const rows: EventRow[] = [];
  const trips: DemoTrip[] = [];
  let prev: { place: Place; freeAt: number; day: string } | null = null;

  for (const e of sorted) {
    const location = typeof e.data?.location === "string" ? e.data.location : null;
    const dest = location ? matchPlace(location, places) : null;
    if (!dest || !e.external_id) continue;
    const start = Date.parse(e.start_at);
    const day = localDate(start);
    const from = prev && prev.day === day && prev.freeAt <= start ? prev : null;
    const origin = from?.place ?? home;
    prev = { place: dest, freeAt: Date.parse(e.end_at ?? e.start_at), day };
    if (origin.key === dest.key) continue;

    const arriveBy = start - BUFFER;
    const first = roundUp(from ? from.freeAt : start - FROM_HOME);
    const options: TravelOption[] = [];
    for (let k = 0; k <= 5; k++) {
      const depart = first + k * STEP;
      const minutes = demoDrive(origin, dest, depart);
      if (k > 0 && depart + freeFlowMinutes(origin, dest) * MIN > arriveBy) break;
      options.push({ depart_at: iso(depart), arrive_at: iso(depart + minutes * MIN), minutes });
    }
    const naive = options[0] as TravelOption;
    const inTime = options.filter((o) => Date.parse(o.arrive_at) <= arriveBy);
    const best = inTime.reduce<TravelOption>(
      (b, o) => (o.minutes < b.minutes || (o.minutes === b.minutes && o.depart_at > b.depart_at) ? o : b),
      inTime[0] ?? naive,
    );
    const won = Math.max(0, naive.minutes - best.minutes);
    const data: TravelData = {
      calendar_event_id: e.external_id,
      from: { label: origin.label, place_key: origin.key },
      to: { label: dest.label, place_key: dest.key },
      mode: "drive",
      minutes: best.minutes,
      free_flow_minutes: freeFlowMinutes(origin, dest),
      distance_km:
        Math.round(
          (metresBetween(
            { lat: origin.lat ?? 0, lng: origin.lng ?? 0 },
            { lat: dest.lat ?? 0, lng: dest.lng ?? 0 },
          ) /
            1000) *
            13,
        ) / 10,
      naive_depart_at: naive.depart_at,
      naive_minutes: naive.minutes,
      won_minutes: won,
      options,
    };
    rows.push({
      source: "maps",
      type: "travel",
      start_at: best.depart_at,
      end_at: best.arrive_at,
      title: `Drive to ${dest.label}, ${best.minutes} min`,
      data,
      external_id: `${DEMO_PREFIX}travel:${e.external_id.slice(DEMO_PREFIX.length)}`,
    });
    trips.push({
      calendarExternalId: e.external_id,
      title: e.title,
      start,
      naive,
      best,
      wonMinutes: won,
      to: dest.label,
    });
  }
  return { rows, trips };
}
