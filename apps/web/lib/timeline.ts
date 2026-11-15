import {
  type AppCategory,
  bundleIdForAppName,
  type CategoryRole,
  categoriseEvent,
  categoryRole,
  type Event,
  isBrowser,
} from "@michael/shared";
import { type DayHealth, healthOf } from "./health";
import { driveFromEvent } from "./travel";

// Builds the Timeline view of one day from raw timeline events.
// Mac use becomes blocks: pink where work apps held the screen (goal time, inferred while there is no
// plan), hatched where messages or social apps took a stretch, grey for everything else. Short breaks
// inside work cut the block instead of splitting it. Phone sessions and Claude Code sessions sit in
// their own narrow lanes. Calendar blocks are planned outlines. Long stretches with no screens and
// nothing planned collapse to one row.

export type Kind = "work" | "lost" | "other";

export type Cut = { at: number; minutes: number; what: string };

export type Block = {
  start: number;
  end: number;
  kind: Kind;
  label: string;
  minutes: number;
  cuts: Cut[];
  /** The planned block this time belongs to: drawn as a dashed outline (outline and fill). */
  plan?: { start: number; end: number; title: string };
  /** Michael moved the planned end here: a dashed pink extension. */
  movedEnd?: number;
  /** Stretches inside the block lost to one thing, hatched with a label. */
  lostStretches?: { start: number; end: number; what: string }[];
};

export type Mark = { start: number; end: number; title: string };

/**
 * A calendar block on the day: drawn as a dashed outline under what actually happened. `michael` is
 * set for blocks Michael booked (from a recommendation, his chat or Claude through the connector).
 */
export type Plan = {
  start: number;
  end: number;
  title: string;
  michael: boolean;
  withOthers: boolean;
  /** The timeline event id (#271): set on live days, so the block can be edited. */
  id?: string;
  goalId?: string | null;
  /** The user may move, resize, rename it or change its goal: solo and not started yet. */
  editable?: boolean;
  /** Made in Michael, so it may be removed (the user's own calendar events never are). */
  removable?: boolean;
  /** Where the event lives in Google Calendar, for the read only "Open in Google Calendar". */
  htmlLink?: string;
  /**
   * The goal block this plan is in the score (#317), when it is one: its goal, the minutes no data
   * proves yet, and the user's word on it. A past one with unconfirmed minutes offers Did it / Didn't.
   */
  goal?: { title: string; unverified: number; settled: "did" | "didnt" | null };
};

export type Segment =
  | { kind: "hours"; from: number; to: number }
  | { kind: "quiet"; from: number; to: number };

export type TimelineDrive = {
  start: number;
  end: number;
  to: string;
  minutes: number;
  trafficMinutes: number;
};

export type TimelineDay = {
  date: string;
  /** Planned drives (source maps, type travel): the traffic part reads as lost time. */
  drives?: TimelineDrive[];
  /** Set when the day is today: draws the now pill and leaves the rest of the plan as outline. */
  now?: number;
  sample?: boolean;
  dayStart: number;
  dayEnd: number;
  blocks: Block[];
  /** Calendar blocks (live days). The sample day keeps its plan on each block instead. */
  plans?: Plan[];
  phone: Mark[];
  ai: Mark[];
  /** Done time the user logged (#317), drawn as goal time. */
  logged?: Mark[];
  segments: Segment[];
  /** The Apple Watch: last night, tonight, naps, workouts and heart rate per hour (lib/health.ts). */
  health?: DayHealth;
  totals: { workMinutes: number; lostMinutes: number; phoneSessions: number; phoneMinutes: number };
};

const MIN = 60_000;

// Colours come from the one categoriser (packages/shared/src/categories.ts) and the role of each
// category, the same rule the score and the patterns use: work and AI are work, messages, social,
// video, news, shopping and travel are lost, music, the system and anything unknown are other.
const KIND_OF_ROLE: Record<CategoryRole, Kind> = { work: "work", distractor: "lost", neutral: "other" };
const kindOf = (category: AppCategory): Kind => KIND_OF_ROLE[categoryRole(category)];

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** The app's bundle id, from the event or, failing that, from a well known name. */
const bundleOf = (e: Event): string | null => str(e.data.bundle_id) ?? bundleIdForAppName(e.title);

const t = (iso: string) => new Date(iso).getTime();

type Session = { start: number; end: number; app: string; kind: Kind; what: string };

/** What a Chrome session was, from the foreground web visit that overlaps it most. */
function browserKind(s: { start: number; end: number }, visits: Event[]): { kind: Kind; what: string } {
  let best: Event | null = null;
  let bestOverlap = 0;
  for (const v of visits) {
    const vs = t(v.start_at);
    const ve = v.end_at ? t(v.end_at) : vs;
    const o = Math.min(ve, s.end) - Math.max(vs, s.start);
    if (o > bestOverlap) {
      bestOverlap = o;
      best = v;
    }
  }
  const category = best ? (categoriseEvent(best) ?? "other") : "other";
  return { kind: kindOf(category), what: best?.title ?? "Chrome" };
}

function classify(e: Event): Kind {
  return kindOf(categoriseEvent(e) ?? "other");
}

function topApps(apps: Map<string, number>, n = 2) {
  return [...apps.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([a]) => a);
}

/** Michael's own block: tagged by the executor (data.michael) or written by him (source agent). */
export const isMichaelBlock = (e: Event) => e.source === "agent" || e.data.michael === true;

/**
 * Calendar events on the day, all day events left out, as planned outlines. `now` decides which are
 * still editable (#271): a block that has started is history.
 */
export function plansOf(events: Event[], dayStart: number, dayEnd: number, now = Date.now()): Plan[] {
  return events
    .filter((e) => e.type === "calendar_event" && e.end_at && e.data.all_day !== true)
    .map((e) => {
      const attendees = typeof e.data.attendees === "number" ? e.data.attendees : 0;
      const withOthers = e.data.with_others === true || attendees >= 2;
      const start = t(e.start_at);
      const end = t(e.end_at as string);
      return {
        start: Math.max(start, dayStart),
        end: Math.min(end, dayEnd),
        title: e.title,
        michael: isMichaelBlock(e),
        withOthers,
        id: e.id,
        goalId: typeof e.data.goal_id === "string" ? e.data.goal_id : null,
        // Blocks that cross midnight stay read only: the day shows only part of them.
        editable: !withOthers && start > now && start >= dayStart && end <= dayEnd,
        removable: isMichaelBlock(e),
        htmlLink: typeof e.data.html_link === "string" ? e.data.html_link : undefined,
      };
    })
    .filter((p) => p.end > p.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * The day from raw events. `dayStartAt`/`dayEndAt` are instants or ISO strings (an Athens day is 23
 * or 25 hours when the clocks change). `now`, when inside the day, draws the now line.
 */
export function buildTimeline(
  date: string,
  events: Event[],
  dayStartAt: string | number,
  dayEndAt: string | number,
  now?: number,
): TimelineDay {
  const dayStart = typeof dayStartAt === "number" ? dayStartAt : t(dayStartAt);
  const dayEnd = typeof dayEndAt === "number" ? dayEndAt : t(dayEndAt);
  const clip = (s: number, e: number) => [Math.max(s, dayStart), Math.min(e, dayEnd)] as const;

  const visits = events.filter((e) => e.type === "web_visit" && e.data.foreground === true);

  // 1. Mac sessions, classified.
  const sessions: Session[] = [];
  for (const e of events) {
    if (e.source !== "macos_usage" || e.type !== "app_usage" || !e.end_at) continue;
    const [s, en] = clip(t(e.start_at), t(e.end_at));
    if (en - s < 5_000) continue;
    const bundle = bundleOf(e);
    if (bundle && isBrowser(bundle)) {
      const k = browserKind({ start: s, end: en }, visits);
      sessions.push({
        start: s,
        end: en,
        app: e.title,
        kind: k.kind,
        what: k.kind === "lost" ? k.what : e.title,
      });
    } else {
      sessions.push({ start: s, end: en, app: e.title, kind: classify(e), what: e.title });
    }
  }
  sessions.sort((a, b) => a.start - b.start);

  // 2. Runs of Mac use: sessions with gaps of 3 minutes or less, whatever the app.
  type Run = { start: number; end: number; sessions: Session[] };
  const runs: Run[] = [];
  for (const s of sessions) {
    const last = runs.at(-1);
    if (last && s.start - last.end <= 3 * MIN) {
      last.end = Math.max(last.end, s.end);
      last.sessions.push(s);
    } else {
      runs.push({ start: s.start, end: s.end, sessions: [s] });
    }
  }

  // 3. One block per run, coloured by what dominated it. Inside work, messages and social cut the
  // block (under 3 minutes) or are hatched with a label (3 minutes or more).
  const blocks: Block[] = [];
  for (const run of runs) {
    const total = run.sessions.reduce((n, s) => n + (s.end - s.start), 0);
    if (total < 2 * MIN) continue;
    const by: Record<Kind, number> = { work: 0, lost: 0, other: 0 };
    const apps = new Map<string, number>();
    const lostApps = new Map<string, number>();
    for (const s of run.sessions) {
      by[s.kind] += s.end - s.start;
      const target = s.kind === "lost" ? lostApps : apps;
      target.set(s.what, (target.get(s.what) ?? 0) + (s.end - s.start));
    }
    const kind: Kind =
      by.lost >= total * 0.5 ? "lost" : by.work >= total * 0.4 && total >= 5 * MIN ? "work" : "other";
    const block: Block = {
      start: run.start,
      end: run.end,
      kind,
      label: kind === "lost" ? (topApps(lostApps, 1)[0] ?? "") : topApps(apps).join(", "),
      minutes: kind === "work" ? (total - by.lost) / MIN : total / MIN,
      cuts: [],
      lostStretches: [],
    };
    if (kind !== "lost") {
      // Merge back to back lost sessions (gaps under a minute) into stretches.
      let cur: { start: number; end: number; apps: Map<string, number> } | null = null;
      const flush = () => {
        if (!cur) return;
        const what = topApps(cur.apps, 1)[0] ?? "";
        const len = cur.end - cur.start;
        if (len >= 3 * MIN) block.lostStretches?.push({ start: cur.start, end: cur.end, what });
        else if (len >= 20_000) block.cuts.push({ at: cur.start, minutes: len / MIN, what });
        cur = null;
      };
      for (const s of run.sessions) {
        if (s.kind !== "lost") {
          if (cur && s.start - cur.end > MIN) flush();
          continue;
        }
        if (cur && s.start - cur.end <= MIN) {
          cur.end = Math.max(cur.end, s.end);
          cur.apps.set(s.what, (cur.apps.get(s.what) ?? 0) + (s.end - s.start));
        } else {
          flush();
          cur = { start: s.start, end: s.end, apps: new Map([[s.what, s.end - s.start]]) };
        }
      }
      flush();
    }
    blocks.push(block);
  }

  // 4. Phone sessions and Claude Code sessions.
  const marks = (pred: (e: Event) => boolean): Mark[] =>
    events
      .filter((e) => pred(e) && e.end_at)
      .map((e) => {
        const [s, en] = clip(t(e.start_at), t(e.end_at as string));
        return { start: s, end: en, title: e.title };
      })
      .filter((m) => m.end > m.start)
      .sort((a, b) => a.start - b.start);
  const phone = marks((e) => e.source === "iphone_usage" && e.type === "app_usage");
  const ai = marks((e) => e.type === "ai_session");
  // Done time the user logged (#317): goal time, drawn pink like a workout.
  const logged = marks((e) => e.source === "manual" && e.type === "focus_session" && e.data.log === "done");
  const plans = plansOf(events, dayStart, dayEnd, now);
  const health = healthOf(events, dayStart, dayEnd);

  // 5. Planned drives (source maps, type travel; TravelData in docs/api.md).
  const drives = events
    .filter((e) => e.type === "travel")
    .map((e) => driveFromEvent(e))
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => {
      const [s, en] = clip(t(d.start), t(d.end));
      return {
        start: s,
        end: en,
        to: d.to,
        minutes: d.minutes,
        trafficMinutes: Math.max(0, d.minutes - d.freeFlowMinutes),
      };
    })
    .filter((d) => d.end > d.start);

  // 6. Quiet stretches of 90 minutes or more (no Mac block, no phone session, nothing planned, no
  // workout, no nap, no drive) collapse to one row.
  const busy = [
    ...blocks.map((b) => [b.start, b.end] as const),
    ...health.workouts.map((w) => [Math.max(w.start, dayStart), Math.min(w.end, dayEnd)] as const),
    ...health.naps.map((n) => [n.start, Math.min(n.end, dayEnd)] as const),
    ...phone.map((p) => [p.start, p.end] as const),
    ...logged.map((l) => [l.start, l.end] as const),
    ...plans.map((p) => [p.start, p.end] as const),
    ...drives.map((d) => [d.start, d.end] as const),
  ];
  // The hour around now always stays open, so the now pill never sits on a collapsed row.
  const nowIn = now != null && now > dayStart && now < dayEnd ? now : undefined;
  if (nowIn != null) busy.push([nowIn - 30 * MIN, nowIn + 30 * MIN] as const);
  busy.sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  const floorHour = (x: number) => x - ((((x - dayStart) % (60 * MIN)) + 60 * MIN) % (60 * MIN));
  const ceilHour = (x: number) => {
    const f = floorHour(x);
    return f === x ? x : f + 60 * MIN;
  };
  let cursor = dayStart;
  let open = dayStart;
  for (const [s, e] of busy) {
    if (s - cursor >= 90 * MIN) {
      const qFrom = ceilHour(cursor);
      const qTo = floorHour(s);
      if (qTo - qFrom >= 60 * MIN) {
        if (qFrom > open) segments.push({ kind: "hours", from: open, to: qFrom });
        segments.push({ kind: "quiet", from: qFrom, to: qTo });
        open = qTo;
      }
    }
    cursor = Math.max(cursor, e);
  }
  const lastQuietFrom = ceilHour(cursor);
  if (dayEnd - lastQuietFrom >= 60 * MIN) {
    if (lastQuietFrom > open) segments.push({ kind: "hours", from: open, to: lastQuietFrom });
    segments.push({ kind: "quiet", from: lastQuietFrom, to: dayEnd });
  } else {
    segments.push({ kind: "hours", from: open, to: dayEnd });
  }

  const workMinutes = blocks.filter((b) => b.kind === "work").reduce((n, b) => n + b.minutes, 0);
  const lostMinutes =
    blocks.filter((b) => b.kind === "lost").reduce((n, b) => n + b.minutes, 0) +
    blocks.flatMap((b) => b.cuts).reduce((n, c) => n + c.minutes, 0) +
    blocks.flatMap((b) => b.lostStretches ?? []).reduce((n, l) => n + (l.end - l.start) / MIN, 0);
  const phoneMinutes = phone.reduce((n, p) => n + (p.end - p.start) / MIN, 0);

  return {
    date,
    drives,
    now: nowIn,
    dayStart,
    dayEnd,
    blocks,
    plans,
    phone,
    ai,
    logged,
    segments,
    health,
    totals: { workMinutes, lostMinutes, phoneSessions: phone.length, phoneMinutes },
  };
}

/** Maps a time to a y offset, given the segments (hours at `perHour` px, quiet rows at `quiet` px). */
export function makeY(segments: Segment[], perHour: number, quiet: number) {
  return (x: number) => {
    let y = 0;
    for (const s of segments) {
      if (x <= s.from) return y;
      if (s.kind === "quiet") {
        if (x < s.to) return y + quiet / 2;
        y += quiet;
      } else {
        if (x < s.to) return y + ((x - s.from) / (60 * MIN)) * perHour;
        y += ((s.to - s.from) / (60 * MIN)) * perHour;
      }
    }
    return y;
  };
}

/** The inverse of makeY: the time at a y offset. Inside a quiet row it spreads across the row. */
export function makeTime(segments: Segment[], perHour: number, quiet: number) {
  return (y: number) => {
    let top = 0;
    for (const s of segments) {
      const h = s.kind === "quiet" ? quiet : ((s.to - s.from) / (60 * MIN)) * perHour;
      if (y < top + h) return s.from + (Math.max(0, y - top) / h) * (s.to - s.from);
      top += h;
    }
    return segments.at(-1)?.to ?? 0;
  };
}

/** Quiet rows the viewer opened become hours again, merged with the hours around them. */
export function openSegments(segments: Segment[], open: (s: Segment) => boolean): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const next: Segment = s.kind === "quiet" && open(s) ? { kind: "hours", from: s.from, to: s.to } : s;
    const last = out.at(-1);
    if (last && last.kind === "hours" && next.kind === "hours" && last.to === next.from) last.to = next.to;
    else out.push({ ...next });
  }
  return out;
}

/** The plan a block mostly belongs to: the calendar block covering at least half of it. */
export function planFor(b: Block, plans: Plan[]): Plan | undefined {
  let best: Plan | undefined;
  let bestOverlap = 0;
  for (const p of plans) {
    const o = Math.min(p.end, b.end) - Math.max(p.start, b.start);
    if (o > bestOverlap) {
      bestOverlap = o;
      best = p;
    }
  }
  return best && bestOverlap >= (b.end - b.start) / 2 ? best : undefined;
}

/**
 * What a block was for, then which apps: the calendar block it sits in names it ("Deep work"), the
 * apps go in the subline. Lost blocks and blocks outside any plan are named by their apps.
 */
export function blockTitle(b: Block, plans: Plan[]): { title: string; apps?: string } {
  if (b.plan) return { title: b.plan.title };
  const plan = b.kind === "lost" ? undefined : planFor(b, plans);
  if (plan) return { title: plan.title, apps: b.label || undefined };
  if (b.label) return { title: b.label };
  return { title: b.kind === "work" ? "Work apps" : b.kind === "lost" ? "Lost" : "Other apps" };
}

/** Minutes a block lost to interruptions: the whole block when it was lost, else its cuts and stretches. */
export function lostMinutesOf(b: Block): number {
  if (b.kind === "lost") return b.minutes;
  return (
    b.cuts.reduce((n, c) => n + c.minutes, 0) +
    (b.lostStretches ?? []).reduce((n, l) => n + (l.end - l.start) / MIN, 0)
  );
}
