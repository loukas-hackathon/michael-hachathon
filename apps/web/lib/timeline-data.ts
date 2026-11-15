import "server-only";
import {
  type Event,
  EventType,
  type Goal,
  goalKind,
  type Score,
  type TimelineResponse,
} from "@michael/shared";
import { get } from "./api";
import { addDays, athensDay, dayBounds, isLocalDay, weekOf } from "./athens";
import { DATES_WITH_DATA, getTimelineDay, longestFrom, type Patterns } from "./days";
import { devLatency } from "./dev-latency";
import { getGoogleCalendar } from "./integrations";
import { USE_MOCKS } from "./mode";
import { sleepGoalMinutes } from "./sleep-goal";
import { buildTimeline, type Plan, type TimelineDay } from "./timeline";

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
   * A day with data in the week before the shown one, for the week strip's way back: the same
   * weekday when it has data, else that week's latest day. Null when that week is empty.
   */
  earlier: string | null;
  /**
   * Whether Google Calendar is connected. Read only when the day is empty, where it picks the one
   * action. Null when unknown.
   */
  calendarConnected: boolean | null;
  /** Minutes a night the Sleep goal asks for, to set the watch's nights against; null without one. */
  sleepGoal: number | null;
  /** The user's active goals, for the goal chips when they add or edit a block (#271). */
  goals: { id: string; title: string }[];
  /** The day can be edited: the user's own live data (the sample day cannot). */
  editable: boolean;
};

// The heavy per-second streams (app use, web visits, prompts, heart rate) are left out of the week
// scan: the light types are enough to tell which days have data, at a fraction of the bytes.
const HEAVY = new Set<string>(["app_usage", "web_visit", "ai_prompt", "biometric", "search"]);
const LIGHT_TYPES = EventType.options.filter((t) => !HEAVY.has(t));

const iso = (ms: number) => new Date(ms).toISOString();
// How far into the next day to look for the night that closes this one.
const NEXT_MORNING = 16 * 3_600_000;

/** Athens days that have at least one event starting in them. */
export function daysWithEvents(events: Pick<Event, "start_at">[]): Set<string> {
  return new Set(events.map((e) => athensDay(new Date(e.start_at))));
}

const lightScan = (from: number, to: number) =>
  get<TimelineResponse>(
    `/v1/timeline?${new URLSearchParams({ from: iso(from), to: iso(to), type: LIGHT_TYPES.join(",") })}`,
  ).catch(() => ({ events: [] as Event[] }));

export async function loadTimeline(asked?: string, demo?: string): Promise<TimelineScreen> {
  await devLatency();
  if (demo === "sample" || USE_MOCKS) return loadSample(asked);

  const today = athensDay();
  const date = isLocalDay(asked) ? asked : today;
  const { start, end } = dayBounds(date);
  const week = weekOf(date);
  const weekStart = dayBounds(week[0] as string).start;
  const weekEnd = dayBounds(week[6] as string).end;

  // The score's blocks of the day (#317): which plans are goal blocks, and which of those the user
  // can still confirm. Only for days that have started; best effort.
  const score =
    date <= today
      ? get<Score>(`/v1/score?${new URLSearchParams({ date })}`).catch(() => null)
      : Promise.resolve(null);
  const priorStart = dayBounds(addDays(week[0] as string, -7)).start;
  const [timeline, patterns, light, prior, goals, nextMorning, scored] = await Promise.all([
    get<TimelineResponse>(`/v1/timeline?${new URLSearchParams({ from: iso(start), to: iso(end) })}`),
    get<Patterns>(`/v1/patterns?${new URLSearchParams({ from: iso(start), to: iso(end) })}`).catch(
      () => ({}) as Patterns,
    ),
    lightScan(weekStart, weekEnd),
    // The week before, for the strip's way back (on a Monday it is the only week with data).
    lightScan(priorStart, weekStart),
    get<{ goals: Goal[] }>("/v1/goals").catch(() => ({ goals: [] as Goal[] })),
    // The night that starts after midnight still closes this day (the night rule, lib/health.ts):
    // its sleep and the heart readings around it are in the next morning.
    get<TimelineResponse>(
      `/v1/timeline?${new URLSearchParams({ from: iso(end), to: iso(end + NEXT_MORNING), type: "sleep,biometric" })}`,
    ).catch(() => ({ events: [] as Event[] })),
    score,
  ]);

  const events = timeline.events;
  const ids = new Set(events.map((e) => e.id));
  const withNight = [...events, ...nextMorning.events.filter((e) => !ids.has(e.id))];
  const seen = daysWithEvents(light.events);
  if (events.length > 0) seen.add(date);
  const available = week.filter((d) => seen.has(d));
  let latest = [...available].reverse().find((d) => d < date && d <= today) ?? null;
  const priorDays = [...daysWithEvents(prior.events)].filter((d) => d < (week[0] as string)).sort();
  const earlier = priorDays.includes(addDays(date, -7)) ? addDays(date, -7) : (priorDays.at(-1) ?? null);

  let calendarConnected: boolean | null = null;
  if (events.length === 0) {
    // An empty day needs a way out: the latest day before it (last week too, for a Monday) and
    // whether connecting the calendar is the one thing to do.
    const calendar = await getGoogleCalendar();
    if (!latest) latest = [...daysWithEvents(prior.events)].sort().at(-1) ?? null;
    calendarConnected = calendar ? calendar.status === "connected" : null;
  }

  // Today and the days ahead always show, even empty, so a free slot can be tapped to plan it (#271).
  const day =
    events.length > 0 || date >= today ? buildTimeline(date, withNight, start, end, Date.now()) : null;
  if (day?.plans && scored) day.plans = withGoals(day.plans, scored);

  return {
    date,
    today,
    source: "live",
    day,
    longestUninterrupted: longestFrom(patterns),
    available,
    latest,
    earlier,
    calendarConnected,
    sleepGoal: sleepGoalMinutes(goals.goals),
    // Only goals a block can serve: time and count. Sleep is counted by nights, outcomes by ticks.
    goals: goals.goals
      .filter((g) => g.active && (goalKind(g) === "time" || goalKind(g) === "count"))
      .map((g) => ({ id: g.id, title: g.title })),
    editable: true,
  };
}

/** Each plan that is a goal block in the score carries its goal, unconfirmed minutes and the user's word. */
export function withGoals(plans: Plan[], score: Pick<Score, "day">): Plan[] {
  const blocks = new Map<string, { title: string; unverified: number; settled: "did" | "didnt" | null }>();
  for (const b of score.day.blocks) {
    if (b.matched_by === "logged") continue;
    const seen = blocks.get(b.event_id);
    blocks.set(b.event_id, {
      title: b.goal_title,
      unverified: (seen?.unverified ?? 0) + b.unverified_minutes,
      settled: b.settled ?? null,
    });
  }
  return plans.map((p) => {
    const goal = p.id ? blocks.get(p.id) : undefined;
    return goal ? { ...p, goal } : p;
  });
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
    earlier: null,
    calendarConnected: null,
    sleepGoal: null,
    goals: [],
    editable: false,
  };
}
