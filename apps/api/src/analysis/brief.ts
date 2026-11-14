import {
  type AnalysisTrigger,
  type Event,
  type Goal,
  isBrowser,
  type PatternReport,
  type PatternSubject,
  type Recommendation,
  type ScoreBlock,
} from "@michael/shared";
import { buildPatternReport, DEFAULT_TIMEZONE } from "../patterns";
import { roleOf } from "../patterns/focus";
import { label } from "../patterns/format";
import { DAY, HOUR, MINUTE, Zone } from "../patterns/time";
import { buildTimeline, type Segment } from "../patterns/timeline";
import { overlapWith, round1, round2, type Span, union } from "../patterns/util";
import { buildScore, calendarTitles } from "../score";
import { type PlanEvent, planEvents } from "./plan";

// The analysis brief: everything the model is told about one person for one run.
//
// PRIVACY. The brief is the only user data that leaves the API for the model, so it is built here,
// in one pure function, from summaries. It never carries: raw events or their ids, page titles,
// full addresses, a site's host unless it is on the shared public list, search terms, message
// text, prompt text, or anything about an event that involves other people beyond "busy from A to
// B". A calendar title is sent only for the user's own block that matches one of their goals.
// brief.test.ts holds these promises in place.

const DETECTORS = [
  "phone_cadence",
  "mac_app_cadence",
  "focus_disruptions",
  "recovery_cost",
  "repeat_offenders",
  "drift",
  "late_screens",
  "context_switching",
  "time_by_app",
  "ai_tool_use",
] as const;
export type DetectorName = (typeof DETECTORS)[number];
export const DETECTOR_NAMES: readonly string[] = DETECTORS;

/** The waking day used for "time still free this week": 07:00 to 23:00. */
const WAKING_START_MIN = 7 * 60;
const WAKING_END_MIN = 23 * 60;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Sleep and recovery just after the range feed "the morning after" in the late screens pattern. */
const LOOKAHEAD_MS = 18 * HOUR;
export const MAX_RANGE_DAYS = 31;

export interface BriefInput {
  /** Every event that overlaps `briefWindow(...)`. More is fine, less makes the brief thinner. */
  events: Event[];
  goals: Goal[];
  /** Recommendations already given, any order. */
  recommendations: Recommendation[];
  /** Range start, ISO with offset. */
  from: string;
  /** Range end, ISO with offset. */
  to: string;
  /** The instant the brief is written for. Passed in so the function stays pure. */
  now: string;
  trigger: AnalysisTrigger;
  /**
   * Standing instructions: ground rules the person set in their own words ("keep Sundays clear").
   * They are not goals. Passed to the model as written.
   */
  instructions?: string[];
  /**
   * What the person told Michael in the check in (#187), one line each: the question and their
   * own answer. Facts the sensors could not see; quoted, never invented.
   */
  toldMe?: string[];
  /**
   * Whether the actions in the answer are carried out as it is written ("applied") or wait for one
   * tap from the person ("offers", the default). The model words its lines accordingly.
   */
  actionsAre?: ActionsAre;
  /** Questions Michael asked in earlier runs, any order. He never asks one of them again. */
  asked?: { question: string; asked_at: string }[];
  timezone?: string;
}

export type ActionsAre = "offers" | "applied";

/** What the code needs to check the model's answer. Never sent to the model. */
export interface BriefContext {
  timezone: string;
  now: number;
  goalIds: Set<string>;
  /** Brief ref ("b1") to the user's own goal block. Only these can be acted on. */
  blocks: Map<string, PlanEvent>;
  /** Every own goal block in the window, with or without a ref. */
  goalBlocks: PlanEvent[];
  /** Events with other people in them. An action may never overlap one. */
  busy: Span[];
  /** Goal id to the calendar title a new block for that goal gets, so it counts towards the goal. */
  blockTitles: Map<string, string>;
  /** Detectors that had enough data in at least one report: the only pattern names `evidence` may use. */
  patterns: Set<string>;
  actionsAre: ActionsAre;
}

export type Brief = Record<string, unknown>;

interface Moment {
  zone: Zone;
  from: number;
  /** Range end, never after `now`. */
  end: number;
  now: number;
  /** The local day the brief is about. A run at exactly midnight still belongs to the day before. */
  today: string;
}

function moment(input: Pick<BriefInput, "from" | "to" | "now" | "timezone">): Moment {
  const zone = new Zone(input.timezone ?? DEFAULT_TIMEZONE);
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const now = Date.parse(input.now);
  if (![from, to, now].every(Number.isFinite)) throw new RangeError("from, to and now must be ISO datetimes");
  const end = Math.min(to, now);
  if (!(end > from)) throw new RangeError("the range must start before it ends and before now");
  if (end - from > MAX_RANGE_DAYS * DAY)
    throw new RangeError(`the range is limited to ${MAX_RANGE_DAYS} days`);
  return { zone, from, end, now, today: zone.dayOf(now - 1) };
}

/** The Monday to Sunday week that holds `day`. */
function weekOf(zone: Zone, day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  const monday = zone.nextDay(day, -((weekday + 6) % 7));
  const sunday = zone.nextDay(monday, 6);
  return { monday, sunday, start: zone.startOfDay(monday), end: zone.startOfDay(zone.nextDay(sunday)) };
}

/** The span of events `buildBrief` wants: the 7 days before, the week's plan, tomorrow. */
export function briefWindow(input: Pick<BriefInput, "from" | "to" | "now" | "timezone">): {
  from: string;
  to: string;
} {
  const { zone, from, end, today } = moment(input);
  const week = weekOf(zone, today);
  const start = Math.min(from, week.start, zone.startOfDay(zone.nextDay(today, -7)));
  const stop = Math.max(week.end, zone.startOfDay(zone.nextDay(today, 2)), end + LOOKAHEAD_MS);
  return { from: new Date(start).toISOString(), to: new Date(stop).toISOString() };
}

// ---------- small formatters ----------

const weekdayOf = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? "";
};
const whole = (ms: number) => Math.round(ms / MINUTE);
/** One decimal under 10, whole numbers from 10: enough for a coach, and short. */
const num = (n: number) => (Math.abs(n) < 10 ? round1(n) : Math.round(n));
const numOrNull = (n: number | null | undefined) => (n === null || n === undefined ? null : num(n));
/** Drop keys whose value is null or undefined, so the brief does not spend tokens on nothing. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}

/** "HH:MM" for a start. */
const clock = (zone: Zone, ms: number) => zone.clock(ms);
/** "HH:MM" for an end: midnight reads "24:00" when it closes the day the span started on. */
const clockEnd = (zone: Zone, start: number, ms: number) =>
  zone.minuteOfDay(ms) === 0 && zone.dayOf(ms - 1) === zone.dayOf(start) ? "24:00" : zone.clock(ms);
/** "YYYY-MM-DD HH:MM", with 24:00 for the last instant of `today`. */
const stamp = (zone: Zone, ms: number, asEnd = false) =>
  asEnd && zone.minuteOfDay(ms) === 0 ? `${zone.dayOf(ms - 1)} 24:00` : `${zone.dayOf(ms)} ${zone.clock(ms)}`;

/** How a subject is named for the model: apps by name, sites only when on the shared public list. */
const named = (s: PatternSubject) => label(s);

// ---------- the plan ----------

function clip(segments: Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.end <= start) continue;
    if (s.start >= end) break;
    out.push({ ...s, start: Math.max(s.start, start), end: Math.min(s.end, end) });
  }
  return out;
}

/** What took the lost time in one block: its lost stretches added up per app, largest first. */
function lostTo(block: ScoreBlock) {
  const by = new Map<string, number>();
  for (const stretch of block.lost) by.set(stretch.what, (by.get(stretch.what) ?? 0) + stretch.minutes);
  const top = [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, minutes]) => minutes >= 1)
    .map(([app, minutes]) => ({ app, minutes: Math.round(minutes) }));
  return top.length > 0 ? top : null;
}

/**
 * The plan and how it is going. Every number of planned, spent, lost and unverified time comes
 * from the score module (score/score.ts, "the attribution rule"), so the brief, the Today screen
 * and the Goals screen can never disagree about a block.
 */
function buildPlan(m: Moment, events: Event[], plan: PlanEvent[], goals: Goal[], withYesterday: boolean) {
  const { zone, now, today } = m;
  const at = new Date(now).toISOString();
  const calendarOnly = events.filter((e) => e.type === "calendar_event");
  const scoreOf = (date: string, from = events) =>
    buildScore(from, goals, { date, now: at, timezone: zone.name });
  const week = weekOf(zone, today);
  const thisWeek = scoreOf(today);

  const budgets = new Map(goals.map((g) => [g.id, g.weekly_budget_minutes]));
  const perGoal = new Map(
    thisWeek.goals.map((g) => [
      g.goal_id,
      // A goal outside the score (sleep) has no blocks to count.
      !g.scored
        ? { scored: false }
        : {
            planned_minutes: g.planned_minutes,
            elapsed_minutes: g.elapsed_minutes,
            spent_minutes: g.spent_minutes,
            lost_minutes: g.lost_minutes,
            unverified_minutes: g.unverified_minutes,
            ahead_minutes: g.ahead_minutes,
            // Only a goal with a weekly budget can be short of it.
            ...(budgets.get(g.goal_id) == null
              ? {}
              : { budget_not_yet_planned_minutes: Math.max(0, g.budget_minutes - g.planned_minutes) }),
          },
    ]),
  );

  // Time still free for goals this week: the waking day minus every entry that is not a goal block.
  const committed = union(
    plan.filter((p) => p.kind !== "goal_block").map((p) => ({ start: p.start, end: p.end })),
  );
  let freeMs = 0;
  for (let day = today; day <= week.sunday; day = zone.nextDay(day)) {
    const span = { start: Math.max(now, zone.at(day, WAKING_START_MIN)), end: zone.at(day, WAKING_END_MIN) };
    if (span.end > span.start) freeMs += span.end - span.start - overlapWith(span, committed);
  }

  const byEvent = new Map(plan.map((p) => [p.eventId, p]));
  const refs = new Map<string, string>();
  const blocks = new Map<string, PlanEvent>();
  const dayOf = (day: string, is: "yesterday" | "today" | "tomorrow") => {
    const start = zone.startOfDay(day);
    const end = zone.startOfDay(zone.nextDay(day));
    const entries = plan.filter((p) => p.start >= start && p.start < end);
    // An end on a later day is written out in full, so "18:00" is never read as today's.
    const times = (p: Span) => ({
      start: clock(zone, p.start),
      end: p.end > end ? stamp(zone, p.end) : clockEnd(zone, p.start, p.end),
    });
    // Other people's events and errands carry no title, so overlapping ones are simply one span.
    const anonymous = (kind: PlanEvent["kind"]) => union(entries.filter((p) => p.kind === kind)).map(times);
    // Tomorrow has not happened: its plan needs the calendar only.
    const scored = is === "today" ? thisWeek : scoreOf(day, is === "tomorrow" ? calendarOnly : events);
    const goalBlocks = scored.day.blocks.flatMap((b) => {
      // The brief names a block only when this file also says it is the user's own.
      const own = byEvent.get(b.event_id);
      if (own?.kind !== "goal_block") return [];
      const span = { start: Date.parse(b.start_at), end: Date.parse(b.end_at) };
      const state = span.end <= now ? "done" : span.start <= now ? "now" : "ahead";
      // Only a block that has not started can still be moved, so only those get a ref.
      let ref: string | null = null;
      if (state === "ahead") {
        ref = refs.get(b.event_id) ?? `b${refs.size + 1}`;
        refs.set(b.event_id, ref);
        blocks.set(ref, own);
      }
      return compact({
        ref,
        goal: b.goal_title,
        title: b.title,
        ...times(span),
        state,
        ...(state === "ahead"
          ? {}
          : {
              elapsed_minutes: state === "now" ? b.elapsed_minutes : null,
              spent_minutes: b.spent_minutes,
              lost_minutes: b.lost_minutes,
              unverified_minutes: b.unverified_minutes,
              lost_to: lostTo(b),
            }),
      });
    });
    const d = scored.day;
    return compact({
      date: day,
      weekday: weekdayOf(day),
      is,
      goal_blocks: goalBlocks,
      busy_with_others: anonymous("busy"),
      own_no_goal: anonymous("own_other"),
      planned_minutes: d.planned_minutes,
      // The day against the plan, once any of it has happened.
      so_far:
        d.elapsed_minutes === 0
          ? null
          : {
              elapsed_minutes: d.elapsed_minutes,
              spent_minutes: d.spent_minutes,
              lost_minutes: d.lost_minutes,
              unverified_minutes: d.unverified_minutes,
            },
    });
  };

  const days = [
    ...(withYesterday ? [dayOf(zone.nextDay(today, -1), "yesterday")] : []),
    dayOf(today, "today"),
    dayOf(zone.nextDay(today), "tomorrow"),
  ];

  return {
    blocks,
    perGoal,
    plan: {
      week: {
        from: week.monday,
        to: week.sunday,
        days_left_after_today: Math.round((zone.startOfDay(week.sunday) - zone.startOfDay(today)) / DAY),
        planned_minutes: thisWeek.planned_minutes,
        elapsed_minutes: thisWeek.elapsed_minutes,
        spent_minutes: thisWeek.spent_minutes,
        lost_minutes: thisWeek.lost_minutes,
        minutes_free_for_goals_until_sunday: whole(Math.max(0, freeMs)),
        free_rule:
          "07:00 to 23:00 from now, minus every calendar entry that is not a goal block. An estimate.",
      },
      days,
    },
  };
}

// ---------- patterns ----------

interface TrimContext {
  zone: Zone;
  /** Goal id to the title the brief uses for it. */
  goalTitle: Map<string, string>;
  /** Calendar events with other people in them, merged. */
  busy: Span[];
  /** True when the report covers one local day: per day figures would only repeat the totals. */
  oneDay: boolean;
}
type Trim<K extends DetectorName> = (data: NonNullable<PatternReport[K]["data"]>, t: TrimContext) => unknown;

/** `{ "2026-11-12": 73, ... }`: a row per day costs four times as much. */
const byDay = <T extends { day: string }>(rows: T[], value: (row: T) => number) =>
  Object.fromEntries(rows.map((r) => [r.day, value(r)]));

// What each detector keeps. The sentence in `summary` already carries the headline numbers, so
// `data` holds what a coach needs beyond it: the split by day, by app and by hour.
const trimmers: { [K in DetectorName]: Trim<K> } = {
  phone_cadence: (d) =>
    compact({
      sessions_per_day: num(d.sessions_per_day),
      // Null when too few sessions carry a reason: then nothing may be said about notifications.
      opened_by_notification_share: d.opened.notification_share,
      sessions_with_known_reason: d.opened.notification + d.opened.own_hand,
      first_apps: d.first_apps.slice(0, 3).map((a) => ({ app: named(a.app), share: round2(a.share) })),
      busiest_hours: [...d.by_hour]
        .sort((a, b) => b.sessions_per_day - a.sessions_per_day)
        .slice(0, 3)
        .map((h) => ({
          hour: `${String(h.hour).padStart(2, "0")}:00`,
          sessions_per_day: num(h.sessions_per_day),
        })),
      sessions_by_day: byDay(d.daily, (x) => x.sessions),
    }),

  mac_app_cadence: (d) => ({
    // Distracting apps that come up at least 5 times a day, most frequent first.
    distracting_apps: d.apps
      .filter((a) => roleOf(a.app.category) === "distractor")
      .filter((a, i) => i === 0 || a.activations_per_day >= 5)
      .slice(0, 3)
      .map((a) =>
        compact({
          app: named(a.app),
          times_per_day: num(a.activations_per_day),
          once_every_minutes_of_mac_use: numOrNull(a.minutes_of_mac_use_per_activation),
          share_under_30_seconds: round2(a.checks_share),
          after_notification_share: a.after_notification_share,
        }),
      ),
  }),

  focus_disruptions: (d, t) =>
    compact({
      found_in:
        d.mode === "calendar" ? "planned goal blocks" : d.mode === "inferred" ? "focus stretches" : "both",
      days_with_focus: t.oneDay ? null : d.daily.filter((x) => x.focus_minutes > 0).length,
      focus_minutes: num(d.focus_minutes),
      disruptions: d.disruptions,
      minutes_lost: num(d.minutes_lost),
      longest_uninterrupted_minutes: num(d.longest_uninterrupted_minutes),
      uncategorised_screen_share: round2(d.uncategorised_share),
      by_day: t.oneDay
        ? null
        : Object.fromEntries(
            d.daily
              .filter((x) => x.focus_minutes > 0 || x.disruptions > 0)
              .map((x) => [
                x.day,
                {
                  focus_minutes: num(x.focus_minutes),
                  disruptions: x.disruptions,
                  minutes_lost: num(x.minutes_lost),
                },
              ]),
          ),
      biggest: [...d.items]
        .sort((a, b) => b.minutes_lost - a.minutes_lost)
        .slice(0, t.oneDay ? 5 : 3)
        .map((i) =>
          compact({
            day: t.oneDay ? null : i.day,
            at: t.zone.clock(Date.parse(i.start_at)),
            device: i.device,
            app: named(i.trigger),
            minutes_lost: num(i.minutes_lost),
            minutes_until_back: numOrNull(i.minutes_until_back),
            in_block_of_goal: i.goal_id ? (t.goalTitle.get(i.goal_id) ?? null) : null,
            opened_by_notification: i.opened_by_notification,
            // A call during a meeting is the meeting, not lost time. The detector cannot tell.
            while_busy_with_others:
              overlapWith({ start: Date.parse(i.start_at), end: Date.parse(i.end_at) }, t.busy) > 0
                ? true
                : null,
          }),
        ),
    }),

  recovery_cost: (d) =>
    compact({
      measured: d.measured,
      not_returned: d.not_returned,
      multiplier: d.multiplier,
    }),

  repeat_offenders: (d) => ({
    offenders: d.offenders.slice(0, 4).map((o) => ({
      app: named(o.subject),
      device: o.devices.join(" and "),
      disruptions: o.disruptions,
      minutes_lost: num(o.minutes_lost),
      days: o.days,
    })),
  }),

  drift: (d, t) => ({
    biggest: d.items
      .filter((i) => i.minutes >= 0.5)
      .slice(0, 3)
      .map((i) =>
        compact({
          day: t.oneDay ? null : i.day,
          at: t.zone.clock(Date.parse(i.start_at)),
          site: named(i.site),
          minutes: num(i.minutes),
          during: i.during === "work_block" ? "a planned work block" : "a focus stretch",
        }),
      ),
  }),

  late_screens: (d, t) =>
    compact({
      usual_bedtime: d.usual_bedtime,
      nights: d.nights.map((x) =>
        compact({
          night_of: x.night,
          minutes_after_cutoff: num(x.minutes),
          top_app: x.top ? named(x.top) : null,
          last_seen: x.last_seen_at ? t.zone.clock(Date.parse(x.last_seen_at)) : null,
          next_recovery_pct: x.next_recovery_pct,
          next_sleep_minutes: x.next_sleep_minutes,
        }),
      ),
      recovery_comparison: d.recovery_comparison,
    }),

  // The sentence says it all.
  context_switching: () => null,

  time_by_app: (d) => {
    const days = Math.max(1, d.days_with_data);
    const perDay = (seconds: number) => Math.round(seconds / 60 / days);
    // Two sites that are both named "a travel site" are one line, not two.
    const apps = new Map<string, { app: string; device: string; seconds: number }>();
    for (const a of d.totals.apps) {
      const key = `${named(a.subject)}|${a.device}`;
      const row = apps.get(key) ?? { app: named(a.subject), device: a.device, seconds: 0 };
      row.seconds += a.seconds;
      apps.set(key, row);
    }
    return compact({
      categories_minutes_per_day: Object.fromEntries(
        d.totals.by_category
          .map((c): [string, number] => [c.category, perDay(c.seconds)])
          .filter(([, minutes]) => minutes >= 1)
          .slice(0, 6),
      ),
      top_apps_minutes_per_day: [...apps.values()]
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 6)
        .map((a) => ({ app: a.app, device: a.device, minutes: perDay(a.seconds) }))
        .filter((a) => a.minutes >= 2),
      screen_minutes_by_day:
        d.daily.length > 1 ? byDay(d.daily, (x) => Math.round(x.active_seconds / 60)) : null,
    });
  },

  // The sentence says it all.
  ai_tool_use: () => null,
};

/**
 * One report, reduced to what a coach needs. Detectors with data come first, most important
 * first: each `summary` is that detector's headline. The ones without enough data are listed
 * with the reason, so the model knows they are silent and why.
 */
function trimReport(report: PatternReport, t: Omit<TrimContext, "oneDay">, ok: Set<string>) {
  const ctx: TrimContext = { ...t, oneDay: report.days.length <= 1 };
  const detectors: Record<string, unknown>[] = [];
  const notEnough: Record<string, string> = {};
  for (const name of DETECTORS) {
    const d = report[name];
    if (d.status !== "ok" || d.data === null) {
      notEnough[name] = (d.reason ?? "not enough data").replace(/^not enough data: /, "");
      continue;
    }
    ok.add(name);
    const trim = trimmers[name] as (data: unknown, t: TrimContext) => unknown;
    detectors.push(compact({ name, summary: d.summary, data: trim(d.data, ctx) }));
  }
  const partial = report.days.filter((d) => !d.complete).map((d) => d.day);
  return compact({
    from: stamp(t.zone, Date.parse(report.from)),
    to: stamp(t.zone, Date.parse(report.to), true),
    days_cut_short: partial.length > 0 ? partial : null,
    detectors,
    not_enough_data: notEnough,
  });
}

/** Minutes per local hour in work apps, in distracting apps and in everything else. */
function screenTimeByHour(zone: Zone, attention: Segment[], from: number, to: number) {
  const hours = new Map<number, { work: number; distracting: number; other: number }>();
  for (const s of clip(attention, from, to)) {
    for (let t = s.start; t < s.end; ) {
      const hourStart = Math.floor(t / HOUR) * HOUR;
      const stop = Math.min(s.end, hourStart + HOUR);
      const row = hours.get(hourStart) ?? { work: 0, distracting: 0, other: 0 };
      const role = roleOf(s.category);
      row[role === "work" ? "work" : role === "distractor" ? "distracting" : "other"] += stop - t;
      hours.set(hourStart, row);
      t = stop;
    }
  }
  return {
    columns: ["hour", "work", "distracting", "other"],
    rows: [...hours.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(
        ([at, r]) =>
          [zone.clock(at).slice(0, 2), whole(r.work), whole(r.distracting), whole(r.other)] as const,
      )
      .filter(([, work, distracting, other]) => work + distracting + other >= 1),
  };
}

// ---------- data notes ----------

function newest(events: Event[], source: string, now: number): number | null {
  let latest: number | null = null;
  for (const e of events) {
    if (e.source !== source || e.type !== "app_usage") continue;
    const t = Date.parse(e.end_at ?? e.start_at);
    if (t <= now && (latest === null || t > latest)) latest = t;
  }
  return latest;
}

/** Share of Mac browser time for which no page was measured in front. Null with no browser time. */
function unmeasuredBrowserShare(mac: Segment[], from: number, to: number): number | null {
  let bare = 0;
  let measured = 0;
  for (const s of clip(mac, from, to)) {
    if (s.kind === "site") measured += s.end - s.start;
    else if (isBrowser(s.key)) bare += s.end - s.start;
  }
  return bare + measured === 0 ? null : round2(bare / (bare + measured));
}

function dataNotes(m: Moment, events: Event[], mac: Segment[], weekFrom: number) {
  const { zone, now, end, from, today } = m;
  const device = (source: string) => {
    const at = newest(events, source, now);
    if (at === null) return { newest_data: null, note: "no data at all" };
    return {
      newest_data: stamp(zone, at),
      hours_old: num((now - at) / HOUR),
      covers_today: zone.dayOf(at) === today,
    };
  };
  const has = (type: string, a: number, b: number) =>
    events.some(
      (e) => e.type === type && Date.parse(e.start_at) < b && Date.parse(e.end_at ?? e.start_at) >= a,
    );
  const missing = [
    ["calendar", has("calendar_event", weekFrom, now + 7 * DAY)],
    ["sleep", has("sleep", weekFrom, now)],
    ["recovery", has("recovery", weekFrom, now)],
    ["workouts", has("workout", weekFrom, now)],
  ]
    .filter(([, present]) => !present)
    .map(([name]) => name);
  return {
    phone: device("iphone_usage"),
    mac: device("macos_usage"),
    // 1 = no page was measured inside the browser at all.
    browser_time_unmeasured_share: {
      last_7_days: unmeasuredBrowserShare(mac, weekFrom, end),
      range: unmeasuredBrowserShare(mac, from, end),
    },
    sources_with_no_data_in_the_last_7_days: missing,
    how_to_read: [
      "In a goal block, lost_minutes is time in distracting apps and spent_minutes is the elapsed time minus that. unverified_minutes is the part of spent with no proof: no device data there, or only apps with no category. A block with no data at all counts as spent and unverified, never as missed.",
      "Every communication app counts as distracting (calls, WhatsApp, mail), also inside a sales or call block.",
      "A disruption marked while_busy_with_others fell inside a calendar event with other people: it is the meeting, not lost time. The disruption totals still count it.",
    ],
  };
}

// ---------- the brief ----------

export function buildBrief(input: BriefInput): { brief: Brief; context: BriefContext } {
  const m = moment(input);
  const { zone, from, end, now, today } = m;
  const goals = input.goals.filter((g) => g.active);
  const plan = planEvents(input.events, goals);

  const morning = input.trigger === "morning" || zone.hourOf(now - 1) < 12;
  const yesterday = zone.nextDay(today, -1);
  const weekFrom = zone.startOfDay(zone.nextDay(today, -6));
  const tlFrom = Math.min(from, weekFrom, zone.startOfDay(yesterday));
  const timeline = buildTimeline(input.events, tlFrom, end);

  const report = (a: number, b: number) =>
    buildPatternReport(input.events, {
      from: new Date(a).toISOString(),
      to: new Date(b).toISOString(),
      now: new Date(now).toISOString(),
      timezone: zone.name,
      goals,
    });
  const ok = new Set<string>();
  const busy = union(plan.filter((p) => p.kind === "busy").map((p) => ({ start: p.start, end: p.end })));
  const t = { zone, goalTitle: new Map(goals.map((g) => [g.id, g.title])), busy };
  const patterns: Record<string, unknown> = {
    last_7_days: trimReport(report(weekFrom, end), t, ok),
    range: {
      ...trimReport(report(from, end), t, ok),
      ...(end - from <= 2 * DAY
        ? { screen_minutes_by_hour: screenTimeByHour(zone, timeline.attention, from, end) }
        : {}),
    },
  };
  // In the morning the day worth talking about is yesterday, which the range does not cover.
  const yStart = zone.startOfDay(yesterday);
  const yEnd = zone.startOfDay(today);
  if (morning && from > yStart) {
    patterns.yesterday = {
      ...trimReport(report(yStart, yEnd), t, ok),
      screen_minutes_by_hour: screenTimeByHour(zone, timeline.attention, yStart, yEnd),
    };
  }

  const built = buildPlan(m, input.events, plan, goals, morning);

  const recent = input.recommendations
    .filter((r) => Date.parse(r.created_at) <= now)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 5)
    .map((r) => ({
      given: zone.dayOf(Date.parse(r.created_at)),
      title: r.title,
      status: r.status,
      // The only marker of origin a recommendation has today: one written by an analysis run
      // carries that run's id. Anything else was made by rules elsewhere (travel, for one).
      made_by: r.analysis_run_id ? "you" : "elsewhere",
    }));

  const brief: Brief = {
    now: stamp(zone, now, true),
    weekday: weekdayOf(today),
    timezone: zone.name,
    trigger: input.trigger,
    range: { from: stamp(zone, from), to: stamp(zone, end, true) },
    goals: goals.map((g) =>
      compact({
        id: g.id,
        title: g.title,
        category: g.category,
        weekly_budget_minutes: g.weekly_budget_minutes,
        description: g.description,
        this_week: built.perGoal.get(g.id),
      }),
    ),
    actions_are: input.actionsAre ?? "offers",
    // Ground rules in the person's own words. Not goals. Empty when they set none.
    instructions: (input.instructions ?? []).map((line) => line.trim()).filter((line) => line.length > 0),
    // Check in answers (#187). Left out when there are none, so older briefs read the same.
    ...(input.toldMe?.length ? { told_me: input.toldMe } : {}),
    plan: built.plan,
    patterns,
    data_notes: dataNotes(m, input.events, timeline.mac, weekFrom),
    already_recommended: recent,
    already_asked: (input.asked ?? [])
      .filter((q) => q.question.trim().length > 0 && Date.parse(q.asked_at) <= now)
      .sort((a, b) => Date.parse(b.asked_at) - Date.parse(a.asked_at))
      .slice(0, 5)
      .map((q) => ({ asked: zone.dayOf(Date.parse(q.asked_at)), question: q.question.trim() })),
  };

  return {
    brief,
    context: {
      timezone: zone.name,
      now,
      goalIds: new Set(goals.map((g) => g.id)),
      blocks: built.blocks,
      goalBlocks: plan.filter((p) => p.kind === "goal_block"),
      busy,
      blockTitles: new Map(
        goals.flatMap((g) =>
          calendarTitles(g)
            .slice(0, 1)
            .map((title) => [g.id, title]),
        ),
      ),
      patterns: ok,
      actionsAre: input.actionsAre ?? "offers",
    },
  };
}

// ---------- the user message ----------

/**
 * JSON that is small and still readable: the first three levels get a line each, everything
 * deeper stays on its line. Deterministic, so the same brief is always the same text.
 */
function render(value: unknown, depth: number, indent = ""): string {
  if (depth === 0 || value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent} `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => inner + render(v, depth - 1, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${render(v, depth - 1, inner)}`).join(",\n")}\n${indent}}`;
}

export const briefJson = (brief: Brief) => render(brief, 3);

/** The user message, exactly as it is sent. */
export function renderUserMessage(brief: Brief): string {
  return [
    "The brief for this run. Times are local to its timezone. Durations are minutes unless the name says otherwise, shares run from 0 to 1.",
    "",
    briefJson(brief),
  ].join("\n");
}
