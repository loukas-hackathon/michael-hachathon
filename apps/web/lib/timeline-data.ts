import "server-only";
import { type Event, EventType, type Goal, type TimelineResponse } from "@michael/shared";
import { get } from "./api";
import { addDays, athensDay, dayBounds, isLocalDay, weekOf } from "./athens";
import { DATES_WITH_DATA, getTimelineDay, longestFrom, type Patterns } from "./days";
import { getGoogleCalendar } from "./integrations";
import { USE_MOCKS } from "./mode";
import { sleepGoalMinutes } from "./sleep-goal";
import { buildTimeline, type TimelineDay } from "./timeline";

// Loads the Timeline screen for one Athens day: the day itself from GET /v1/timeline, the longest
// unbroken stretch from GET /v1/patterns, and which days of that week have anything recorded.
// One function, so a refresh (polling, a pull down) can call it again with the same arguments.
// Without ?day= it opens on today for every user, the sample week included.
//
// The bundled fixtures (lib/sample) only appear with ?demo=sample, or with USE_MOCKS (lib/mode.ts).

export type TimelineScreen = {
  date: string;
  /** Today in Athens: the screen opens on it, and the week strip marks it. */
  today: string;
  /** "live" is the user's own data; "sample" is the bundled fixtures. */
  source: "live" | "sample";
  /** Null when nothing was recorded on the day. */
  day: TimelineDay | null;
  longestUninterrupted: number | null;
  /** Days of the shown week that have anything recorded (planned blocks included). */
  available: string[];
  /** The most recent day with data before the shown day (up to today), for the empty state. */
  latest: string | null;
  /**
   * Whether Google Calendar is connected. Read only when the day is empty, where it picks the one
   * action. Null when unknown.
   */
  calendarConnected: boolean | null;
  /** Minutes a night the Sleep goal asks for, to set the watch's nights against; null without one. */
  sleepGoal: number | null;
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

const lightScan = (from: number, to: number) =>
  get<TimelineResponse>(
    `/v1/timeline?${new URLSearchParams({ from: iso(from), to: iso(to), type: LIGHT_TYPES.join(",") })}`,
  ).catch(() => ({ events: [] as Event[] }));

export async function loadTimeline(asked?: string, demo?: string): Promise<TimelineScreen> {
  if (demo === "sample" || USE_MOCKS) return loadSample(asked);

  const today = athensDay();
  const date = isLocalDay(asked) ? asked : today;
  const { start, end } = dayBounds(date);
  const week = weekOf(date);
  const weekStart = dayBounds(week[0] as string).start;
  const weekEnd = dayBounds(week[6] as string).end;

  const [timeline, patterns, light, goals] = await Promise.all([
    get<TimelineResponse>(`/v1/timeline?${new URLSearchParams({ from: iso(start), to: iso(end) })}`),
    get<Patterns>(`/v1/patterns?${new URLSearchParams({ from: iso(start), to: iso(end) })}`).catch(
      () => ({}) as Patterns,
    ),
    lightScan(weekStart, weekEnd),
    get<{ goals: Goal[] }>("/v1/goals").catch(() => ({ goals: [] as Goal[] })),
  ]);

  const events = timeline.events;
  const seen = daysWithEvents(light.events);
  if (events.length > 0) seen.add(date);
  const available = week.filter((d) => seen.has(d));
  let latest = [...available].reverse().find((d) => d < date && d <= today) ?? null;

  let calendarConnected: boolean | null = null;
  if (events.length === 0) {
    // An empty day needs a way out: the latest day before it (last week too, for a Monday) and
    // whether connecting the calendar is the one thing to do.
    const [prior, calendar] = await Promise.all([
      latest ? null : lightScan(dayBounds(addDays(week[0] as string, -7)).start, weekStart),
      getGoogleCalendar(),
    ]);
    if (prior) latest = [...daysWithEvents(prior.events)].sort().at(-1) ?? null;
    calendarConnected = calendar ? calendar.status === "connected" : null;
  }

  return {
    date,
    today,
    source: "live",
    day: events.length > 0 ? buildTimeline(date, events, start, end, Date.now()) : null,
    longestUninterrupted: longestFrom(patterns),
    available,
    latest,
    calendarConnected,
    sleepGoal: sleepGoalMinutes(goals.goals),
  };
}

function loadSample(asked?: string): TimelineScreen {
  const today = athensDay();
  const date = isLocalDay(asked) ? asked : today;
  const result = getTimelineDay(date, date === today ? Date.now() : undefined);
  return {
    date,
    today,
    source: "sample",
    day: result?.day ?? null,
    longestUninterrupted: result?.longestUninterrupted ?? null,
    available: DATES_WITH_DATA,
    latest: [...DATES_WITH_DATA].reverse().find((d) => d < date && d <= today) ?? null,
    calendarConnected: null,
    sleepGoal: null,
  };
}
