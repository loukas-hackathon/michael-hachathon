import type { TravelDayDrive, TravelLeg } from "@michael/shared";
import { MINUTE } from "../patterns/time";

// The whole day planned around traffic (#155). Pure: no store, no clock, no Google. The caller
// hands in the day's calendar events as stops and a `drive` function (minutes in traffic between
// two places for a departure time, backed by the Routes API and its call cap), and gets back the
// arrangement of the user's own movable blocks that spends the fewest minutes on the road.
//
// Rules:
// - Only movable stops move: the user's own block (no other people), with a physical place, not
//   marked fixed, not started. Meetings with other people never move.
// - A block keeps its length, stays inside the allowed window (quiet hours, standing instructions)
//   and never overlaps another event.
// - Drives: from home to the first located stop, between consecutive located stops, and back home.
//   A drive leaves late enough to arrive BUFFER before the stop starts, but never before the user
//   is free from the previous stop.

export interface PlaceRef {
  /** Stable id for caching drives: a saved place key or the geocoded text. */
  key: string;
  label: string;
  lat: number;
  lng: number;
}

export interface Stop {
  id: string;
  title: string;
  start: number;
  end: number;
  /** Null for an event with no physical place (online, or no location): it only takes up time. */
  place: PlaceRef | null;
  movable: boolean;
}

/** Minutes on the road leaving `from` at `departAt`, or null when there is no answer (no route, cap). */
export type DriveFn = (from: PlaceRef, to: PlaceRef, departAt: number) => Promise<number | null>;

export interface DayPlanInput {
  stops: Stop[];
  home: PlaceRef | null;
  /** A moved block must start and end inside this span (the day outside quiet hours). */
  window: { from: number; to: number };
  /** Standing instruction "home by 21:00": the drive home must arrive by then. */
  homeBy?: number | null;
  drive: DriveFn;
  /** Offsets tried for each movable block. Default: two hours earlier to three hours later. */
  shifts?: number[];
}

export interface PlannedMove {
  id: string;
  title: string;
  fromStart: number;
  start: number;
  end: number;
}

export interface DayPlanOutput {
  beforeMinutes: number;
  afterMinutes: number;
  wonMinutes: number;
  moves: PlannedMove[];
  drives: TravelDayDrive[];
}

export const BUFFER = 5 * MINUTE;
const SLOT = 15 * MINUTE;
export const DEFAULT_SHIFTS = [-120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].map((m) => m * MINUTE);
// Above this many arrangements, search one block at a time instead of every combination.
const EXHAUSTIVE_LIMIT = 1500;
// Closer than this is the same place: no drive.
const SAME_PLACE_METRES = 300;

const floorSlot = (ms: number) => Math.floor(ms / SLOT) * SLOT;
const ceilSlot = (ms: number) => Math.ceil(ms / SLOT) * SLOT;
const iso = (ms: number) => new Date(ms).toISOString();

function metres(a: PlaceRef, b: PlaceRef): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

interface Leg {
  from: PlaceRef;
  to: PlaceRef;
  toId: string | null;
  departAt: number;
  minutes: number;
}

interface Arrangement {
  legs: Leg[];
  total: number;
}

/**
 * The drives for one arrangement of the day, or null when it cannot work (a drive that would
 * leave before the user is free, a late return, or a drive with no answer). `strict` holds every
 * leg to "leave after you are free"; the day as it stands is costed even when it is already tight.
 */
async function arrange(
  stops: Stop[],
  input: DayPlanInput,
  strictFor: Set<string> | null,
): Promise<Arrangement | null> {
  const located = stops.filter((s) => s.place).sort((a, b) => a.start - b.start);
  const legs: Leg[] = [];
  let prev: { place: PlaceRef; freeAt: number; id: string | null } | null = input.home
    ? { place: input.home, freeAt: Number.NEGATIVE_INFINITY, id: null }
    : null;

  for (const stop of located) {
    const place = stop.place as PlaceRef;
    if (prev && metres(prev.place, place) >= SAME_PLACE_METRES) {
      const target = stop.start - BUFFER;
      // Two looks: a first guess at the drive, then the departure that guess implies.
      const guess = await input.drive(prev.place, place, floorSlot(target - 30 * MINUTE));
      if (guess === null) return null;
      let departAt = floorSlot(target - guess * MINUTE);
      let minutes = await input.drive(prev.place, place, departAt);
      if (minutes === null) return null;
      if (departAt + minutes * MINUTE > target) {
        departAt -= SLOT;
        minutes = await input.drive(prev.place, place, departAt);
        if (minutes === null) return null;
      }
      const strict =
        strictFor === null || strictFor.has(stop.id) || (prev.id !== null && strictFor.has(prev.id));
      if (strict && departAt < prev.freeAt) return null;
      legs.push({ from: prev.place, to: place, toId: stop.id, departAt, minutes });
    }
    prev = { place, freeAt: stop.end, id: stop.id };
  }

  if (prev && input.home && prev.id !== null && metres(prev.place, input.home) >= SAME_PLACE_METRES) {
    const departAt = ceilSlot(prev.freeAt);
    const minutes = await input.drive(prev.place, input.home, departAt);
    if (minutes === null) return null;
    const strict = strictFor === null || strictFor.has(prev.id);
    if (strict && input.homeBy != null && departAt + minutes * MINUTE > input.homeBy) return null;
    legs.push({ from: prev.place, to: input.home, toId: null, departAt, minutes });
  }
  return { legs, total: legs.reduce((n, l) => n + l.minutes, 0) };
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && a.end > b.start;

/** Plan the day. Null when the day as it stands cannot be costed (no route, no answer). */
export async function planDay(input: DayPlanInput): Promise<DayPlanOutput | null> {
  const stops = [...input.stops].sort((a, b) => a.start - b.start);
  const before = await arrange(stops, input, new Set());
  if (!before) return null;

  const shifts = input.shifts ?? DEFAULT_SHIFTS;
  const movable = stops.filter((s) => s.movable && s.place);
  // The offsets each movable block may take on its own (window); overlaps are checked per combination.
  const options = movable.map((s) =>
    shifts.filter((d) => d === 0 || (s.start + d >= input.window.from && s.end + d <= input.window.to)),
  );

  type Candidate = { offsets: number[]; arrangement: Arrangement; moved: number; shifted: number };
  let best: Candidate = {
    offsets: movable.map(() => 0),
    arrangement: before,
    moved: 0,
    shifted: 0,
  };
  const better = (c: Candidate) =>
    c.arrangement.total < best.arrangement.total ||
    (c.arrangement.total === best.arrangement.total &&
      (c.moved < best.moved || (c.moved === best.moved && c.shifted < best.shifted)));

  const evaluate = async (offsets: number[]): Promise<Candidate | null> => {
    if (offsets.every((d) => d === 0)) return null;
    const moved = new Map(movable.map((s, i) => [s.id, offsets[i] ?? 0]));
    const placed = stops.map((s) => {
      const d = moved.get(s.id) ?? 0;
      return d ? { ...s, start: s.start + d, end: s.end + d } : s;
    });
    // A moved block never overlaps another event.
    for (const s of placed) {
      if (!moved.get(s.id)) continue;
      if (placed.some((o) => o.id !== s.id && overlaps(s, o))) return null;
    }
    const changed = new Set([...moved].filter(([, d]) => d !== 0).map(([id]) => id));
    const arrangement = await arrange(placed, input, changed);
    if (!arrangement) return null;
    return {
      offsets,
      arrangement,
      moved: changed.size,
      shifted: offsets.reduce((n, d) => n + Math.abs(d), 0),
    };
  };

  const combinations = options.reduce((n, o) => n * o.length, 1);
  if (combinations <= EXHAUSTIVE_LIMIT) {
    const walk = async (i: number, acc: number[]): Promise<void> => {
      if (i === options.length) {
        const c = await evaluate(acc);
        if (c && better(c)) best = c;
        return;
      }
      for (const d of options[i] ?? [0]) await walk(i + 1, [...acc, d]);
    };
    await walk(0, []);
  } else {
    // One block at a time, twice over: each block takes its best offset with the others held.
    for (let pass = 0; pass < 2; pass++) {
      for (const [i, opts] of options.entries()) {
        for (const d of opts) {
          const offsets = [...best.offsets];
          offsets[i] = d;
          const c = await evaluate(offsets);
          if (c && better(c)) best = c;
        }
      }
    }
  }

  const moves: PlannedMove[] = movable.flatMap((s, i) => {
    const d = best.offsets[i] ?? 0;
    return d ? [{ id: s.id, title: s.title, fromStart: s.start, start: s.start + d, end: s.end + d }] : [];
  });
  return {
    beforeMinutes: before.total,
    afterMinutes: best.arrangement.total,
    wonMinutes: before.total - best.arrangement.total,
    moves,
    drives: compareDrives(before.legs, best.arrangement.legs),
  };
}

/** Before and after for each destination (a stop, or home at the end of the day). */
function compareDrives(before: Leg[], after: Leg[]): TravelDayDrive[] {
  const leg = (l: Leg | undefined): TravelLeg | null =>
    l ? { depart_at: iso(l.departAt), minutes: l.minutes } : null;
  const keys = [...new Set([...before, ...after].map((l) => l.toId))];
  return keys.map((id) => {
    const b = before.find((l) => l.toId === id);
    const a = after.find((l) => l.toId === id);
    const any = (a ?? b) as Leg;
    return { from: any.from.label, to: any.to.label, to_event_id: id, before: leg(b), after: leg(a) };
  });
}

// ---------- standing instructions ----------

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface DayRules {
  /** "HH:MM" the user wants to be home by, if they said so. */
  homeBy: string | null;
  /** The user asked to keep this weekday clear: Michael moves nothing on it. */
  keepClear: boolean;
}

/**
 * The standing instructions the planner understands, read from the user's own words: "home by
 * 21:00" and "keep Sundays clear". Anything else is left to the coach.
 */
export function dayRules(instructions: string[], weekday: number): DayRules {
  const homes: string[] = [];
  let keepClear = false;
  const day = DAYS[weekday] ?? "";
  for (const raw of instructions) {
    const line = raw.toLowerCase();
    const home = /home by (\d{1,2})(?::(\d{2}))?/.exec(line);
    if (home) {
      const h = Number(home[1]);
      const m = Number(home[2] ?? 0);
      if (h < 24 && m < 60) {
        homes.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    const clear = /keep (\w+?)s? (?:free|clear)/.exec(line);
    if (clear && (clear[1] === day || (clear[1] === "weekend" && (weekday === 0 || weekday === 6))))
      keepClear = true;
  }
  // Several "home by" lines: the earliest wins.
  return { homeBy: homes.sort()[0] ?? null, keepClear };
}
