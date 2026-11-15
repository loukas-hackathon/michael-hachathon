import { type CheckIn, type Event, type Goal, type ScoreBlock, sleepScore } from "@michael/shared";
import { aiToolUse } from "../patterns/ai";
import { phoneSessions } from "../patterns/cadence";
import { buildContext, type Ctx, daysTouched, RULES } from "../patterns/context";
import { clockLabel } from "../patterns/format";
import { lateScreens } from "../patterns/late";
import { contextSwitching } from "../patterns/switching";
import { DAY, MINUTE } from "../patterns/time";
import { median, overlapWith, round1, union } from "../patterns/util";
import { attendeesOf, isTrainingGoal, scoreWithHistory } from "../score";
import { SCORE_RULES } from "../score/score";

// One row per local day, one column per figure: the table every insight is mined from. Built from
// the same helpers as the patterns and the score (the line of attention, the late screens rule,
// the goal blocks and their lost minutes), so a number here is the number shown elsewhere.
//
// Dating, held everywhere: a night's sleep, its score, heart rate variability, resting heart rate
// and recovery sit on the local day the night ENDS (the morning). What happens in the evening
// (phone after the cut off, the hour before sleep, bedtime) sits on the day the evening is on. So
// "late phone, then a worse night" is the evening's row against the next row.

export const FEATURE_KEYS = [
  // The evening, on the day it belongs to.
  "late_phone_min",
  "late_screen_min",
  "phone_before_sleep_min",
  "bedtime_min",
  "late_streak",
  // The night that ended this morning.
  "sleep_min",
  "sleep_score",
  "deep_min",
  "rem_min",
  "short_night",
  // The morning's readings.
  "hrv",
  "resting_hr",
  "recovery",
  // The day.
  "phone_opens",
  "phone_min",
  "workout_min",
  "trained",
  "evening_workout",
  "after_training",
  "meeting_min",
  "meeting_count",
  "heavy_meeting_day",
  "first_block_start_min",
  "planned_min",
  "spent_min",
  "lost_min",
  "first_block_lost_min",
  "focus_pct",
  "switches_per_hour",
  "ai_min",
  "last_meal_min",
  "caffeine_last_min",
  "training_rating",
  "meeting_rating",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_RULES = {
  /** A late night for the streak: the same 30 minutes the late screens comparison uses. */
  lateMinutes: RULES.lateNightForComparisonMs / MINUTE,
  /** The phone "before sleep": this long before the night's sleep starts. */
  beforeSleepMinutes: 60,
  shortNightMinutes: 360,
  heavyMeetings: 3,
  eveningWorkoutHour: 19,
  /** Morning readings: hourly watch readings before this local hour, when there are any. */
  morningUntilHour: 12,
} as const;

export interface FeatureTable {
  /** Every local day of the range, in order, with no gaps. */
  days: string[];
  /** 0 = Sunday .. 6 = Saturday, as in JavaScript's getDay(). */
  weekdays: number[];
  /** One value per day, in the order of `days`. Null: no reading that day. */
  cols: Record<FeatureKey, (number | null)[]>;
  /** The late cut off the evening columns were measured against ("23:00"). */
  cutoff: string;
  /** Median start and end of the recorded nights ("23:40", "07:10"), when there are 3 or more. */
  usualBedtime: string | null;
  usualWake: string | null;
}

export interface FeatureInput {
  events: Event[];
  goals: Goal[];
  checkIns?: Pick<CheckIn, "day" | "kind" | "answer">[];
  /** Range start and end, ISO. Rows cover every local day that overlaps it. */
  from: string;
  to: string;
  now: string;
  timezone?: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const CAFFEINE = /\b(coffee|espresso|cappuccino|latte|freddo|americano|caffeine|energy drink|red bull)\b/i;

/** Every goal block part in the range with its minutes, from the score itself, five weeks a call. */
function scoredBlocks(input: FeatureInput, ctx: Ctx): ScoreBlock[] {
  const byKey = new Map<string, ScoreBlock>();
  const windowDays = SCORE_RULES.historyDays + 7;
  const last = ctx.zone.dayOf(ctx.to - 1);
  for (let day = last; ; day = ctx.zone.nextDay(day, -windowDays)) {
    const built = scoreWithHistory(input.events, input.goals, {
      date: day,
      now: input.now,
      timezone: ctx.zone.name,
    });
    for (const b of built.blocks) byKey.set(`${b.event_id}|${b.start_at}`, b);
    if (ctx.zone.startOfDay(ctx.zone.nextDay(day, -windowDays)) + 7 * DAY < ctx.from) break;
  }
  return [...byKey.values()].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
}

/** Days from the first to the last day that has any of these readings: where "none" means zero. */
function coverage(days: string[], withData: Set<string>): Set<string> {
  const idx = days.flatMap((d, i) => (withData.has(d) ? [i] : []));
  if (idx.length === 0) return new Set();
  return new Set(days.slice(idx[0], (idx[idx.length - 1] ?? 0) + 1));
}

/** Events in, the daily table out. Pure: no I/O and no clock. */
export function buildFeatures(input: FeatureInput): FeatureTable {
  const ctx = buildContext(input.events, {
    from: input.from,
    to: input.to,
    now: input.now,
    goals: input.goals,
    timezone: input.timezone,
  });
  const { zone } = ctx;
  const days = ctx.days.map((d) => d.day);
  const index = new Map(days.map((d, i) => [d, i]));
  const cols = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, new Array<number | null>(days.length).fill(null)]),
  ) as FeatureTable["cols"];
  const set = (key: FeatureKey, day: string, value: number | null) => {
    const i = index.get(day);
    if (i !== undefined && value !== null && Number.isFinite(value)) cols[key][i] = round1(value);
  };
  const add = (key: FeatureKey, day: string, value: number) => {
    const i = index.get(day);
    if (i !== undefined) cols[key][i] = round1((cols[key][i] ?? 0) + value);
  };
  /** A day the range does not hold to its end has no figure for the day or the evening yet. */
  const whole = (day: string) => ctx.completeDays.has(day);
  const byId = new Map(input.events.map((e) => [e.id, e]));

  // ---------- the evening: screens after the cut off ----------
  // The cut off is the late screens rule's (patterns/late.ts: 23:00, or an hour before the usual
  // bedtime), rounded to the quarter hour so it reads as a time someone can keep. A night runs for
  // 6 hours from it and belongs to the day its evening is on.
  const [cutoffHour, cutoffMinute] = (lateScreens(ctx).data?.cutoff ?? clockLabel(RULES.lateCutoffMinutes))
    .split(":")
    .map(Number);
  const exact = (cutoffHour ?? 23) * 60 + (cutoffMinute ?? 0);
  // Past midnight ("00:15") is still the evening before.
  const cutoff = Math.round((exact < 12 * 60 ? exact + 1440 : exact) / 15) * 15;
  const attention = union(ctx.tl.attention);
  const iphone = union(ctx.tl.iphone);
  const deviceDays = daysTouched(ctx, ctx.tl.attention);
  for (const day of days) {
    const night = {
      start: zone.at(day, cutoff),
      end: zone.at(day, cutoff + RULES.nightLengthMinutes),
    };
    if (night.start < ctx.from || night.end > ctx.to || !deviceDays.has(day)) continue;
    set("late_phone_min", day, overlapWith(night, iphone) / MINUTE);
    set("late_screen_min", day, overlapWith(night, attention) / MINUTE);
  }
  days.forEach((day, i) => {
    const tonight = cols.late_phone_min[i];
    const before = i > 0 ? cols.late_phone_min[i - 1] : null;
    if (tonight === null || tonight === undefined || before === null || before === undefined) return;
    set(
      "late_streak",
      day,
      tonight >= FEATURE_RULES.lateMinutes && before >= FEATURE_RULES.lateMinutes ? 1 : 0,
    );
  });

  // ---------- the night, on the day it ends ----------
  const nights = ctx.sleeps.filter((s) => !s.nap);
  const longest = new Map<string, (typeof nights)[number]>();
  for (const s of nights) {
    const wake = zone.dayOf(s.end);
    const best = longest.get(wake);
    if (!best || s.end - s.start > best.end - best.start) longest.set(wake, s);
  }
  for (const [wake, s] of longest) {
    const data = byId.get(s.id)?.data ?? {};
    const span = (s.end - s.start) / MINUTE;
    const minutes = num(data.duration_min) ?? span;
    set("sleep_min", wake, minutes);
    set("sleep_score", wake, sleepScore(data, span));
    set("deep_min", wake, num(data.deep_min));
    set("rem_min", wake, num(data.rem_min));
    set("short_night", wake, minutes < FEATURE_RULES.shortNightMinutes ? 1 : 0);
    // The evening this night belongs to: the day before the morning it ends on.
    const evening = zone.nextDay(wake, -1);
    set("bedtime_min", evening, (s.start - zone.startOfDay(evening)) / MINUTE);
    if (ctx.tl.iphone.length > 0) {
      const window = { start: s.start - FEATURE_RULES.beforeSleepMinutes * MINUTE, end: s.start };
      set("phone_before_sleep_min", evening, overlapWith(window, iphone) / MINUTE);
    }
  }

  // ---------- the morning's readings ----------
  for (const e of input.events) {
    if (e.type !== "recovery") continue;
    const day = zone.dayOf(Date.parse(e.start_at));
    set("recovery", day, num(e.data.recovery_pct));
    set("hrv", day, num(e.data.hrv_ms));
    set("resting_hr", day, num(e.data.resting_hr));
  }
  // Hourly watch readings: the morning's when there are any (the night's own), else the day's.
  const readings = new Map<string, { value: number; weight: number; morning: boolean }[]>();
  for (const e of input.events) {
    if (e.type !== "biometric") continue;
    const key: FeatureKey | null =
      e.data.metric === "heart_rate_variability"
        ? "hrv"
        : e.data.metric === "resting_heart_rate"
          ? "resting_hr"
          : null;
    const value = num(e.data.avg);
    if (!key || value === null) continue;
    const at = Date.parse(e.start_at);
    const slot = `${key}|${zone.dayOf(at)}`;
    const list = readings.get(slot) ?? [];
    list.push({
      value,
      weight: Math.max(1, num(e.data.samples) ?? 1),
      morning: zone.hourOf(at) < FEATURE_RULES.morningUntilHour,
    });
    readings.set(slot, list);
  }
  for (const [slot, list] of readings) {
    const [key, day] = slot.split("|") as [FeatureKey, string];
    const i = index.get(day);
    // A recovery reading for the day already answered.
    if (i === undefined || cols[key][i] !== null) continue;
    const morning = list.filter((r) => r.morning);
    const used = morning.length > 0 ? morning : list;
    const weight = used.reduce((t, r) => t + r.weight, 0);
    set(key, day, used.reduce((t, r) => t + r.value * r.weight, 0) / weight);
  }

  // ---------- the phone through the day ----------
  for (const s of ctx.tl.iphone) {
    for (const p of zone.splitByDay(s.start, s.end))
      if (whole(p.day)) add("phone_min", p.day, (p.end - p.start) / MINUTE);
  }
  for (const s of phoneSessions(ctx.tl.iphone)) {
    const day = zone.dayOf(s.start);
    if (s.first !== null && whole(day)) add("phone_opens", day, 1);
  }

  // ---------- training ----------
  const watchDays = new Set<string>();
  const firstWorkoutHour = new Map<string, number>();
  for (const e of input.events) {
    if (e.type !== "sleep" && e.type !== "workout" && e.type !== "biometric" && e.type !== "recovery")
      continue;
    const start = Date.parse(e.start_at);
    watchDays.add(zone.dayOf(e.type === "sleep" && e.end_at ? Date.parse(e.end_at) : start));
    if (e.type !== "workout" || !e.end_at) continue;
    const day = zone.dayOf(start);
    if (!whole(day)) continue;
    add("workout_min", day, num(e.data.duration_min) ?? (Date.parse(e.end_at) - start) / MINUTE);
    const hour = zone.minuteOfDay(start) / 60;
    firstWorkoutHour.set(day, Math.min(hour, firstWorkoutHour.get(day) ?? 24));
  }
  for (const day of coverage(days, watchDays)) {
    const i = index.get(day) ?? -1;
    if (!whole(day)) continue;
    if (cols.workout_min[i] === null) cols.workout_min[i] = 0;
    const trained = (cols.workout_min[i] ?? 0) > 0;
    cols.trained[i] = trained ? 1 : 0;
    cols.evening_workout[i] =
      trained && (firstWorkoutHour.get(day) ?? 0) >= FEATURE_RULES.eveningWorkoutHour ? 1 : 0;
  }
  days.forEach((_, i) => {
    const before = i > 0 ? cols.trained[i - 1] : null;
    if (before !== null && before !== undefined) cols.after_training[i] = before;
  });

  // ---------- meetings: calendar events with other people in them ----------
  const calendarDays = new Set<string>();
  for (const e of input.events) {
    if (e.type !== "calendar_event" || !e.end_at) continue;
    const start = Date.parse(e.start_at);
    const day = zone.dayOf(start);
    calendarDays.add(day);
    if (!whole(day) || attendeesOf(e) <= 0 || e.data.all_day === true) continue;
    add("meeting_min", day, (Date.parse(e.end_at) - start) / MINUTE);
    add("meeting_count", day, 1);
  }
  for (const day of coverage(days, calendarDays)) {
    const i = index.get(day) ?? -1;
    if (!whole(day)) continue;
    if (cols.meeting_min[i] === null) cols.meeting_min[i] = 0;
    if (cols.meeting_count[i] === null) cols.meeting_count[i] = 0;
    cols.heavy_meeting_day[i] = (cols.meeting_count[i] ?? 0) >= FEATURE_RULES.heavyMeetings ? 1 : 0;
  }

  // ---------- goal blocks: planned, spent and lost, as the score counts them ----------
  const firstBlock = new Set<string>();
  const training = new Set(input.goals.filter(isTrainingGoal).map((g) => g.id));
  const elapsedByDay = new Map<string, number>();
  for (const b of scoredBlocks(input, ctx)) {
    const start = Date.parse(b.start_at);
    const day = zone.dayOf(start);
    // Only time that has passed: a block still ahead has lost nothing yet.
    if (!whole(day) || b.elapsed_minutes <= 0) continue;
    add("planned_min", day, b.planned_minutes);
    add("spent_min", day, b.spent_minutes);
    add("lost_min", day, b.lost_minutes);
    elapsedByDay.set(day, (elapsedByDay.get(day) ?? 0) + b.elapsed_minutes);
    // The first block is the first one where focus is the point: a training block's phone is a
    // timer and a playlist (the same line the real time nudge draws).
    if (!firstBlock.has(day) && !training.has(b.goal_id)) {
      firstBlock.add(day);
      set("first_block_start_min", day, zone.minuteOfDay(start));
      set("first_block_lost_min", day, b.lost_minutes);
    }
  }
  for (const [day, elapsed] of elapsedByDay) {
    const i = index.get(day) ?? -1;
    set("focus_pct", day, ((cols.spent_min[i] ?? 0) / elapsed) * 100);
  }

  // ---------- switching and AI tools (patterns/switching.ts, patterns/ai.ts) ----------
  for (const d of contextSwitching(ctx).data?.daily ?? []) {
    if (whole(d.day)) set("switches_per_hour", d.day, d.switches_per_active_hour);
  }
  const ai = aiToolUse(ctx).data?.daily ?? [];
  for (const d of ai) if (whole(d.day)) set("ai_min", d.day, d.wall_minutes);
  for (const day of coverage(days, new Set(ai.map((d) => d.day)))) {
    const i = index.get(day) ?? -1;
    if (whole(day) && cols.ai_min[i] === null) cols.ai_min[i] = 0;
  }

  // ---------- meals and caffeine, when the events carry them ----------
  for (const e of input.events) {
    if (e.type !== "meal") continue;
    const at = Date.parse(e.start_at);
    const day = zone.dayOf(at);
    if (!whole(day)) continue;
    const i = index.get(day);
    if (i === undefined) continue;
    const minute = zone.minuteOfDay(at);
    cols.last_meal_min[i] = Math.max(cols.last_meal_min[i] ?? 0, minute);
    const caffeine =
      e.data.caffeine === true || (num(e.data.caffeine_mg) ?? 0) > 0 || CAFFEINE.test(e.title ?? "");
    if (caffeine) cols.caffeine_last_min[i] = Math.max(cols.caffeine_last_min[i] ?? 0, minute);
  }

  // ---------- the evening check in's ratings, 1 to 5 ----------
  const ratings = new Map<string, number[]>();
  for (const c of input.checkIns ?? []) {
    if ((c.kind !== "training" && c.kind !== "meeting") || typeof c.answer !== "number") continue;
    const slot = `${c.kind === "training" ? "training_rating" : "meeting_rating"}|${c.day}`;
    ratings.set(slot, [...(ratings.get(slot) ?? []), c.answer]);
  }
  for (const [slot, list] of ratings) {
    const [key, day] = slot.split("|") as [FeatureKey, string];
    set(key, day, list.reduce((a, b) => a + b, 0) / list.length);
  }

  const clockOfMedian = (values: number[]) =>
    values.length >= RULES.minSleepsForBedtime ? clockLabel(720 + Math.round(median(values))) : null;
  return {
    days,
    weekdays: days.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay()),
    cols,
    cutoff: clockLabel(cutoff),
    // Measured from noon, like the late screens rule, so 23:40 and 00:30 sit next to each other.
    usualBedtime: clockOfMedian(nights.map((s) => (zone.minuteOfDay(s.start) - 720 + 1440) % 1440)),
    usualWake: clockOfMedian(nights.map((s) => (zone.minuteOfDay(s.end) - 720 + 1440) % 1440)),
  };
}
