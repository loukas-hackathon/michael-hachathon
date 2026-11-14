import type { Event, Goal } from "@michael/shared";
import { DAY, HOUR, type LocalDaySpan, MINUTE, SECOND, Zone } from "./time";
import { buildTimeline, type Timeline } from "./timeline";
import type { Span } from "./util";

// Every threshold in one place, so the definitions in docs/api.md can be checked against the code.
export const RULES = {
  // Phone sessions: app intervals less than this apart belong to one session.
  sessionGapMs: 30 * SECOND,
  // A session (or a Mac visit) shorter than this is a "check".
  checkMs: 30 * SECOND,
  // A gap between phone sessions longer than this is sleep or time away, not a checking rhythm.
  awayGapMs: 3 * HOUR,
  workStartHour: 9,
  workEndHour: 18,
  minPhoneDays: 3,
  minGaps: 20,
  minHourGaps: 5,
  minDayGaps: 5,
  // Sessions with a known open reason needed before the notification share is stated.
  minOpenReasons: 20,
  // Mac: an app in front for less than this is passing through (Cmd Tab), not a visit.
  minVisitMs: 3 * SECOND,
  minMacDays: 3,
  minActivations: 10,
  minAppDays: 2,
  minAppGaps: 5,
  notificationWindowMs: 60 * SECOND,
  // Focus: nothing in front for longer than this ends a stretch (screen off, lid closed, away).
  idleBreakMs: 2 * MINUTE,
  // Away from work apps for longer than this ends a stretch.
  maxAwayMs: 10 * MINUTE,
  minStretchMs: 15 * MINUTE,
  minWorkShare: 0.5,
  // A distractor that comes up within this time after the last work app ended the stretch.
  endingWindowMs: 60 * SECOND,
  // From this share of uncategorised screen time the focus summary says it is under counting.
  blindShare: 0.4,
  minRecoverySample: 5,
  minDayRecoverySample: 3,
  minOffenderDays: 2,
  // A search this close before a visit is taken as what started it.
  searchWindowMs: 2 * MINUTE,
  // Late screens: default cut off 23:00; a night is the 6 hours after the cut off (to 05:00).
  lateCutoffMinutes: 23 * 60,
  nightLengthMinutes: 6 * 60,
  minLateMs: 5 * MINUTE,
  minNights: 3,
  minSleepsForBedtime: 3,
  mainSleepMs: 3 * HOUR,
  lateNightForComparisonMs: 30 * MINUTE,
  minComparisonNights: 3,
  // Context switching: a stay shorter than this is a fragment.
  fragmentMs: 2 * MINUTE,
  // Two intervals of the same app this close together are one stay.
  stayJoinMs: 5 * SECOND,
  minActiveMsForRate: 30 * MINUTE,
  minActiveMs: HOUR,
  evidenceCap: 20,
  // The bar a finding clears before it leads the report (headlines.ts). Below it the detector
  // still answers, but "0 minutes lost" or a median of six is not something to lead with.
  headline: {
    // Minutes: drift, minutes lost, recovery per day, an offender's total, AI tools open.
    minMinutes: 5,
    minDisruptions: 5,
    minFocusMinutes: 60,
    minRecoverySample: 10,
    minSessions: 20,
    minAiSessions: 3,
    minScreenMinutes: 60,
  },
} as const;

export interface PatternOptions {
  /** Range start, ISO with offset. */
  from: string;
  /** Range end, ISO with offset. */
  to: string;
  /** The current instant. Passed in so the functions stay pure. */
  now: string;
  /** IANA zone for days and hours. Default Europe/Athens. */
  timezone?: string;
  goals?: Goal[];
  workStartHour?: number;
  workEndHour?: number;
}

export interface DayInfo extends LocalDaySpan {
  /** False when the range starts after or ends before the local day does. */
  complete: boolean;
}

export interface SleepSpan extends Span {
  id: string;
}

export interface Ctx {
  zone: Zone;
  from: number;
  to: number;
  now: number;
  days: DayInfo[];
  completeDays: Set<string>;
  tl: Timeline;
  events: Event[];
  goals: Goal[];
  sleeps: SleepSpan[];
  workStartHour: number;
  workEndHour: number;
}

export const DEFAULT_TIMEZONE = "Europe/Athens";

export function buildContext(events: Event[], options: PatternOptions): Ctx {
  const zone = new Zone(options.timezone ?? DEFAULT_TIMEZONE);
  const from = Date.parse(options.from);
  const to = Date.parse(options.to);
  const now = Date.parse(options.now);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(now)) {
    throw new RangeError("from, to and now must be valid ISO datetimes");
  }
  if (!(to > from)) throw new RangeError("to must be after from");

  const days: DayInfo[] = zone
    .days(from, to)
    .map((d) => ({ ...d, complete: d.start >= from && d.end <= to }));
  const sleeps: SleepSpan[] = [];
  for (const e of events) {
    if (e.type !== "sleep" || !e.end_at) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    // A sleep longer than a day is a broken record, not a sleep.
    if (end > start && end - start <= DAY) sleeps.push({ id: e.id, start, end });
  }
  sleeps.sort((a, b) => a.start - b.start);

  return {
    zone,
    from,
    to,
    now,
    days,
    completeDays: new Set(days.filter((d) => d.complete).map((d) => d.day)),
    tl: buildTimeline(events, from, to),
    events,
    goals: options.goals ?? [],
    sleeps,
    workStartHour: options.workStartHour ?? RULES.workStartHour,
    workEndHour: options.workEndHour ?? RULES.workEndHour,
  };
}

/**
 * The days a "per day" figure is averaged over: complete local days that have data. A day the
 * range cuts short would pull the average down, so it only counts when no complete day exists.
 */
export function countedDays(ctx: Ctx, daysWithData: Set<string>): string[] {
  const complete = [...daysWithData].filter((d) => ctx.completeDays.has(d));
  return (complete.length > 0 ? complete : [...daysWithData]).sort();
}

/** Days on which any of the segments starts or continues. */
export function daysTouched(ctx: Ctx, spans: Span[]): Set<string> {
  const out = new Set<string>();
  for (const s of spans) for (const piece of ctx.zone.splitByDay(s.start, s.end)) out.add(piece.day);
  return out;
}
