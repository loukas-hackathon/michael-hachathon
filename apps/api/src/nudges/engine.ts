import {
  type Event,
  type Goal,
  type GoalCategory,
  type Nudge,
  type NudgeKind,
  type NudgeSkip,
  voiceShortDuration,
} from "@michael/shared";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { goalBlocks, roleOf } from "../patterns/focus";
import { DAY, MINUTE, Zone } from "../patterns/time";
import { buildTimeline, type Segment } from "../patterns/timeline";
import { type Span, union, unionLength } from "../patterns/util";

// The nudge engine. Pure: the clock, the events, the goals and today's nudges are passed in, so
// the same input always gives the same decision. The route (routes/nudges.ts) does the I/O.

/** Minutes after local midnight. */
export interface QuietHours {
  /** Night starts here (22:00) and runs past midnight to `nightEnd` (07:00). */
  nightStart: number;
  nightEnd: number;
  /** Dinner, [start, end). Null for none. */
  dinner: [number, number] | null;
  /** Work goal blocks are quiet too, except to say the user has already drifted out of one. */
  deepWork: boolean;
}

export const DEFAULT_QUIET: QuietHours = {
  nightStart: 22 * 60,
  nightEnd: 7 * 60,
  dinner: [20 * 60, 21 * 60],
  deepWork: true,
};

const clockMinutes = (hhmm: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The user's own night window (Profile.quiet_hours, "HH:MM") on top of the defaults. Dinner and
 * deep work stay as they are. A missing or malformed window falls back to 22:00 to 07:00; an
 * empty one (start equals end) means no night window at all, so it falls back too.
 */
export function quietFromProfile(window: { start: string; end: string } | null | undefined): QuietHours {
  const start = window ? clockMinutes(window.start) : null;
  const end = window ? clockMinutes(window.end) : null;
  if (start === null || end === null || start === end) return DEFAULT_QUIET;
  return { ...DEFAULT_QUIET, nightStart: start, nightEnd: end };
}

export const LIMITS = {
  perDay: 5,
  /** Nudge copy stays under this many words. */
  maxWords: 15,
  /** Two nudges never land closer together than this. */
  minGapMs: 20 * MINUTE,
  /** focus_drift looks at this much of the recent past. */
  driftWindowMs: 10 * MINUTE,
  /** ...and speaks from this much time on distractors inside it. */
  driftMinMs: 3 * MINUTE,
  /** block_soon speaks when a goal block starts within this window. */
  blockSoonMaxMs: 15 * MINUTE,
  blockSoonMinMs: 2 * MINUTE,
  /** wind_down speaks this long before the night starts, if the screen is on. */
  windDownMs: 30 * MINUTE,
  windDownMinScreenMs: 3 * MINUTE,
  /** goal_behind speaks only before this local time, and when the gap is at least this big. */
  goalBehindLatest: 19 * 60,
  goalBehindMinMinutes: 60,
  goalBehindMinShare: 0.15,
} as const;

export interface EngineInput {
  /** The current instant, ISO with offset. */
  now: string;
  /** IANA zone. Default Europe/Athens. */
  timezone?: string;
  goals: Goal[];
  /** Every event from Monday 00:00 of the local week up to the end of today. */
  events: Event[];
  /** Every nudge of the local day so far, suppressed ones included. */
  today: Pick<Nudge, "key" | "status" | "created_at">[];
  offTheRecord?: boolean;
  quiet?: QuietHours;
}

export interface Candidate {
  kind: NudgeKind;
  key: string;
  goal_id: string | null;
  text: string;
  reason: string;
}

export type Decision =
  | { action: "send"; candidate: Candidate }
  | { action: "suppress"; candidate: Candidate; skipped: "daily_cap" }
  | { action: "skip"; skipped: NudgeSkip };

// Most urgent first: a drift is happening now, a block is about to start, bedtime is close, and
// a weekly gap can wait for the next check.
const PRIORITY: NudgeKind[] = ["focus_drift", "block_soon", "wind_down", "goal_behind"];

const LABEL: Record<GoalCategory, string> = { work: "Focus block", gym: "Gym", rest: "Rest", food: "Meal" };
const SHORT: Record<GoalCategory, string> = { work: "Work", gym: "Gym", rest: "Rest", food: "Food" };

// Events that are real time spent on a goal, besides its calendar blocks.
const SPENT_TYPES: Record<GoalCategory, Event["type"]> = {
  work: "focus_session",
  gym: "workout",
  rest: "sleep",
  food: "meal",
};

/** "45 min", "2h", "2h 10m". */
/** Compact durations the voice sheet way: "47 min", "2h 10", "6h". */
export const shortDuration = voiceShortDuration;

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Voice rules every nudge must pass: under 15 words, no dashes, no exclamation marks. */
export function isValidCopy(text: string): boolean {
  return wordCount(text) < LIMITS.maxWords && !/[-–—!]/.test(text);
}

interface World {
  now: number;
  zone: Zone;
  day: string;
  dayStart: number;
  dayEnd: number;
  weekStart: number;
  minute: number;
  goals: Goal[];
  events: Event[];
  quiet: QuietHours;
}

function world(input: EngineInput): World {
  const zone = new Zone(input.timezone ?? DEFAULT_TIMEZONE);
  const now = Date.parse(input.now);
  const day = zone.dayOf(now);
  // Weeks start on Monday, local time.
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const monday = zone.nextDay(day, -((weekday + 6) % 7));
  return {
    now,
    zone,
    day,
    dayStart: zone.startOfDay(day),
    dayEnd: zone.startOfDay(zone.nextDay(day)),
    weekStart: zone.startOfDay(monday),
    minute: zone.minuteOfDay(now),
    goals: input.goals.filter((g) => g.active),
    events: input.events,
    quiet: input.quiet ?? DEFAULT_QUIET,
  };
}

const inRange = (minute: number, [start, end]: [number, number]) =>
  start <= end ? minute >= start && minute < end : minute >= start || minute < end;

/** Minutes of goal time spent this week up to now: its calendar blocks and its own events. */
export function spentThisWeek(w: World, goal: Goal): number {
  const spans: Span[] = goalBlocks(w.events, w.goals, w.weekStart, w.now)
    .filter((b) => b.goal.id === goal.id)
    .map((b) => ({ start: b.start, end: b.end }));
  for (const e of w.events) {
    if (e.type !== SPENT_TYPES[goal.category] || !e.end_at) continue;
    const start = Math.max(Date.parse(e.start_at), w.weekStart);
    const end = Math.min(Date.parse(e.end_at), w.now);
    if (end > start) spans.push({ start, end });
  }
  return unionLength(union(spans)) / MINUTE;
}

function recentAttention(w: World, from: number): Segment[] {
  return buildTimeline(w.events, from, w.now).attention;
}

// ---------- rules: each returns at most one candidate ----------

function focusDrift(w: World): Candidate | null {
  const block = goalBlocks(w.events, w.goals, w.dayStart, w.dayEnd).find(
    (b) => b.goal.category === "work" && b.start <= w.now && w.now < b.end,
  );
  if (!block) return null;
  const from = Math.max(block.start, w.now - LIMITS.driftWindowMs);
  const byApp = new Map<string, number>();
  let total = 0;
  for (const s of recentAttention(w, from)) {
    if (roleOf(s.category) !== "distractor") continue;
    const ms = s.end - s.start;
    total += ms;
    byApp.set(s.name, (byApp.get(s.name) ?? 0) + ms);
  }
  if (total < LIMITS.driftMinMs) return null;
  const top = [...byApp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Distractions";
  const minutes = Math.round(total / MINUTE);
  const window = Math.round((w.now - from) / MINUTE);
  const until = w.zone.clock(block.end);
  return {
    kind: "focus_drift",
    key: `focus_drift:${block.eventId}`,
    goal_id: block.goal.id,
    text: `${minutes} min on ${top} in your focus block. Back to it until ${until}.`,
    reason: `${minutes} of the last ${window} min on distractions, mostly ${top}; the block runs ${w.zone.clock(block.start)} to ${until} for ${block.goal.title}.`,
  };
}

function blockSoon(w: World): Candidate | null {
  const block = goalBlocks(w.events, w.goals, w.now, w.dayEnd)
    .filter((b) => {
      const lead = b.start - w.now;
      return lead >= LIMITS.blockSoonMinMs && lead <= LIMITS.blockSoonMaxMs;
    })
    .sort((a, b) => a.start - b.start)[0];
  if (!block) return null;
  const lead = Math.round((block.start - w.now) / MINUTE);
  const start = w.zone.clock(block.start);
  const goal = block.goal;
  const budget = goal.weekly_budget_minutes;
  const progress = budget
    ? `; ${shortDuration(spentThisWeek(w, goal))} of ${shortDuration(budget)} done this week`
    : "";
  return {
    kind: "block_soon",
    key: `block_soon:${block.eventId}`,
    goal_id: goal.id,
    text: `${LABEL[goal.category]} at ${start}. Wrap up in ${lead} min.`,
    reason: `${goal.title}: block ${start} to ${w.zone.clock(block.end)} on your calendar${progress}.`,
  };
}

function windDown(w: World): Candidate | null {
  const rest = w.goals.find((g) => g.category === "rest");
  if (!rest) return null;
  const nightAt = w.zone.at(w.day, w.quiet.nightStart);
  const lead = nightAt - w.now;
  if (!(lead > 0 && lead <= LIMITS.windDownMs)) return null;
  const from = w.now - LIMITS.driftWindowMs;
  const screenMs = recentAttention(w, from).reduce((a, s) => a + s.end - s.start, 0);
  if (screenMs < LIMITS.windDownMinScreenMs) return null;
  const night = w.zone.clock(nightAt);
  return {
    kind: "wind_down",
    key: "wind_down",
    goal_id: rest.id,
    text: `Screens off by ${night}. Sleep is on the plan.`,
    reason: `${Math.round(screenMs / MINUTE)} of the last ${LIMITS.driftWindowMs / MINUTE} min on screens; quiet hours start at ${night} for ${rest.title}.`,
  };
}

function goalBehind(w: World): Candidate | null {
  if (w.minute >= LIMITS.goalBehindLatest) return null;
  const elapsed = Math.min(1, (w.now - w.weekStart) / (7 * DAY));
  let worst: { goal: Goal; spent: number; pace: number; gap: number } | null = null;
  for (const goal of w.goals) {
    const budget = goal.weekly_budget_minutes;
    if (!budget) continue;
    const spent = spentThisWeek(w, goal);
    const pace = budget * elapsed;
    const gap = pace - spent;
    if (gap < Math.max(LIMITS.goalBehindMinMinutes, budget * LIMITS.goalBehindMinShare)) continue;
    if (!worst || gap > worst.gap) worst = { goal, spent, pace, gap };
  }
  if (!worst) return null;
  const { goal, spent, pace, gap } = worst;
  const next = goalBlocks(w.events, w.goals, w.now, w.dayEnd).find((b) => b.goal.id === goal.id);
  const behind = shortDuration(gap);
  const book = Math.min(90, Math.max(30, Math.round(gap / 15) * 15));
  const text = next
    ? `${SHORT[goal.category]} ${behind} behind this week. Keep the ${w.zone.clock(next.start)} block.`
    : `${SHORT[goal.category]} ${behind} behind this week. Book ${book} min today.`;
  return {
    kind: "goal_behind",
    // One weekly gap a day is enough: the key is per day, not per goal.
    key: "goal_behind",
    goal_id: goal.id,
    text,
    reason: `${goal.title}: ${shortDuration(spent)} of ${shortDuration(goal.weekly_budget_minutes ?? 0)} done; the pace by now is ${shortDuration(pace)}.`,
  };
}

const RULES: Record<NudgeKind, (w: World) => Candidate | null> = {
  focus_drift: focusDrift,
  block_soon: blockSoon,
  wind_down: windDown,
  goal_behind: goalBehind,
};

/** Every candidate right now, most urgent first, before quiet hours, the cap and repeats. */
export function candidates(input: EngineInput): Candidate[] {
  const w = world(input);
  return PRIORITY.flatMap((kind) => {
    const c = RULES[kind](w);
    return c && isValidCopy(c.text) ? [c] : [];
  });
}

/** Why now is quiet, or null. Inside a work block only a drift nudge may speak. */
export function quietNow(input: EngineInput): "night" | "dinner" | "deep_work" | null {
  const w = world(input);
  if (inRange(w.minute, [w.quiet.nightStart, w.quiet.nightEnd])) return "night";
  if (w.quiet.dinner && inRange(w.minute, w.quiet.dinner)) return "dinner";
  if (
    w.quiet.deepWork &&
    goalBlocks(w.events, w.goals, w.dayStart, w.dayEnd).some(
      (b) => b.goal.category === "work" && b.start <= w.now && w.now < b.end,
    )
  ) {
    return "deep_work";
  }
  return null;
}

/**
 * Should Michael nudge now? At most 5 a day, never in quiet hours, never the same key twice a
 * day, at least 20 minutes apart. Once the cap is reached the best candidate is stored as
 * suppressed, so the user can see what Michael held back.
 */
export function decide(input: EngineInput): Decision {
  if (input.offTheRecord) return { action: "skip", skipped: "off_the_record" };
  const seen = new Set(input.today.map((n) => n.key));
  let fresh = candidates(input).filter((c) => !seen.has(c.key));
  if (fresh.length === 0) return { action: "skip", skipped: "nothing_to_say" };

  const quiet = quietNow(input);
  if (quiet === "night" || quiet === "dinner") return { action: "skip", skipped: "quiet_hours" };
  // Deep work is quiet unless the user has already left it: then the nudge helps them back.
  if (quiet === "deep_work") fresh = fresh.filter((c) => c.kind === "focus_drift");
  const best = fresh[0];
  if (!best) return { action: "skip", skipped: "quiet_hours" };

  const counted = input.today.filter((n) => n.status !== "suppressed");
  if (counted.length >= LIMITS.perDay) return { action: "suppress", candidate: best, skipped: "daily_cap" };

  const now = Date.parse(input.now);
  const last = Math.max(...counted.map((n) => Date.parse(n.created_at)), Number.NEGATIVE_INFINITY);
  if (now - last < LIMITS.minGapMs) return { action: "skip", skipped: "too_soon" };

  return { action: "send", candidate: best };
}

/** The local day and the range of events the engine needs for `now`. */
export function engineWindow(now: string, timezone = DEFAULT_TIMEZONE) {
  const w = world({ now, timezone, goals: [], events: [], today: [] });
  return {
    day: w.day,
    dayStart: new Date(w.dayStart).toISOString(),
    dayEnd: new Date(w.dayEnd).toISOString(),
    weekStart: new Date(w.weekStart).toISOString(),
  };
}
