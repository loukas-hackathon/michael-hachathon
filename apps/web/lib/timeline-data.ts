import "server-only";
import { type Event, EventType, type TimelineResponse } from "@michael/shared";
import { get, usingMocks } from "./api";
import { athensDay, dayBounds, isLocalDay, weekOf } from "./athens";
import { DATES_WITH_DATA, DEFAULT_DATE, getTimelineDay, longestFrom, type Patterns } from "./days";
import { buildTimeline, type TimelineDay } from "./timeline";

// Loads the Timeline screen for one Athens day: the day itself from GET /v1/timeline, the longest
// unbroken stretch from GET /v1/patterns, and which days of that week have anything recorded.
// One function, so a refresh (polling, a pull down) can call it again with the same arguments.
//
// The bundled fixtures (lib/sample) only appear with ?demo=sample, or while USE_MOCKS is on.
// TODO(first-run): when mocks become opt in through one flag module, swap usingMocks() for it.

export type TimelineScreen = {
  date: string;
  /** "live" is the user's own data; "sample" is the bundled fixtures. */
  source: "live" | "sample";
  /** Null when nothing was recorded on the day. */
  day: TimelineDay | null;
  longestUninterrupted: number | null;
  /** Days of the shown week that have anything recorded (planned blocks included). */
  available: string[];
  /** The most recent day with data up to today, for the empty state's way out. */
  latest: string | null;
};

// The heavy per-second streams (app use, web visits, prompts, heart rate) are left out of the week
// scan: the light types are enough to tell which days have data, at a fraction of the bytes.
const HEAVY = new Set<string>(["app_usage", "web_visit", "ai_prompt", "biometric", "search"]);
const LIGHT_TYPES = EventType.options.filter((t) => !HEAVY.has(t));

const iso = (ms: number) => new Date(ms).toISOString();

/** Athens days that have at least one event starting in them. */
export function daysWithEvents(events: Pick<Event, "start_at">[]): Set<string> {
  return new Set(events.map((e) => athensDay(new Date(e.start_at))));
}

export async function loadTimeline(asked?: string, demo?: string): Promise<TimelineScreen> {
  if (demo === "sample" || usingMocks()) return loadSample(asked);

  const today = athensDay();
  const date = isLocalDay(asked) ? asked : today;
  const { start, end } = dayBounds(date);
  const week = weekOf(date);
  const weekStart = dayBounds(week[0] as string).start;
  const weekEnd = dayBounds(week[6] as string).end;

  const [timeline, patterns, light] = await Promise.all([
    get<TimelineResponse>(`/v1/timeline?${new URLSearchParams({ from: iso(start), to: iso(end) })}`),
    get<Patterns>(`/v1/patterns?${new URLSearchParams({ from: iso(start), to: iso(end) })}`).catch(
      () => ({}) as Patterns,
    ),
    get<TimelineResponse>(
      `/v1/timeline?${new URLSearchParams({ from: iso(weekStart), to: iso(weekEnd), type: LIGHT_TYPES.join(",") })}`,
    ).catch(() => ({ events: [] as Event[] })),
  ]);

  const events = timeline.events;
  const seen = daysWithEvents(light.events);
  if (events.length > 0) seen.add(date);
  const available = week.filter((d) => seen.has(d));
  const latest = [...available].reverse().find((d) => d <= today && d !== date) ?? null;

  return {
    date,
    source: "live",
    day: events.length > 0 ? buildTimeline(date, events, start, end, Date.now()) : null,
    longestUninterrupted: longestFrom(patterns),
    available,
    latest,
  };
}

function loadSample(asked?: string): TimelineScreen {
  const date = isLocalDay(asked) ? asked : DEFAULT_DATE;
  const result = getTimelineDay(date);
  return {
    date,
    source: "sample",
    day: result?.day ?? null,
    longestUninterrupted: result?.longestUninterrupted ?? null,
    available: DATES_WITH_DATA,
    latest: DEFAULT_DATE,
  };
}
