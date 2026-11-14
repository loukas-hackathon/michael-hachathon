import type {
  Event,
  Goal,
  Score,
  ScoreBlock,
  ScoreDay,
  ScoreGoal,
  ScoreLostStretch,
  ScoreTick,
  TimeWonBack,
} from "@michael/shared";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { type GoalBlock, goalBlocks, roleOf } from "../patterns/focus";
import { label } from "../patterns/format";
import { MINUTE, SECOND, Zone } from "../patterns/time";
import { buildTimeline, type Segment, subjectOf } from "../patterns/timeline";
import { iso, overlapWith, round1, type Span, subtractSpans, union } from "../patterns/util";

// The score: the share of planned goal time that was spent on the goals. Pure: events, goals,
// the day, `now` and the timezone go in, the numbers come out. No I/O and no clock.
//
// THE ATTRIBUTION RULE (also in docs/api.md, "Score"; change both together)
//
//   Planned     The user's own calendar blocks that belong to a goal (score/match.ts). An event
//               with other people in it is never a block. Where two blocks overlap, the earlier
//               one keeps the time. A block that crosses local midnight is cut there: each day
//               gets its part.
//   Ahead       Planned time that has not started yet (after `now`).
//   Elapsed     Planned time that has passed. A block in progress counts up to `now`.
//   Lost        Time inside an elapsed block spent in a distracting category (communication,
//               social, video, news, shopping, travel) on any device. It is read from the single
//               line of attention (patterns/timeline.ts), where the phone and the Mac are already
//               one line, so a minute is never lost twice.
//   Spent       Elapsed minus lost.
//   Verified    The part of spent for which the data positively shows the goal:
//                 a work goal:     attention in a work category (work, ai) inside the block;
//                 a training goal: a `workout` event overlapping the block (minus lost time).
//               Any other goal has nothing that could prove it.
//   Unverified  Spent minus verified: the block had no device data there, or only neutral apps
//               (music, the system, anything uncategorised). Reported apart, never shown as proven.
//
//   A block with no data at all and no workout counts as SPENT, all of it unverified. Time in the
//   gym or studying on paper leaves no trace on a screen, and a coach who calls a real session
//   "missed" loses the user's trust on day one. The price is that a skipped session also scores
//   as spent until a watch or a check in says otherwise; `unverified_minutes` shows how much of
//   the score rests on that.
//
//   Sleep is outside the score: a goal of category `rest` whose target describes sleep is listed
//   with its budget (`scored: false`) and takes no part in any total.
//
//   score_pct = spent / elapsed, rounded. Null when nothing has elapsed: not 0 and not 100.
//
//   Time won back, in one sentence: less time lost inside your planned blocks than on your usual
//   day. The usual loss rate is lost / elapsed over the goal blocks of the previous 28 days. It
//   needs 3 of those days to have blocks; with fewer the value is 0 and `reason` says why.
//   Won back on a day = max(0, usual rate x the day's elapsed - the day's lost). The week is the
//   sum of its days. It only rises while the person is beating their usual self.
//
//   Minutes are whole minutes, rounded per block (a block's part of one day) and added up from
//   there, so every total is the sum of the parts shown beneath it.
//
//   Ticks: one per 5 minutes of a block, from its start. `ahead` when the tick starts at or after
//   `now`; `lost` when at least half of it was lost; otherwise `spent` when at least as much of
//   the rest is verified as not, else `unverified`. Ticks are the drawing; totals come from the
//   exact intervals, not from counting ticks.

export const SCORE_RULES = {
  tickMs: 5 * MINUTE,
  historyDays: 28,
  minHistoryDays: 3,
  // Distracting segments less than this apart are one lost stretch.
  stretchGapMs: 30 * SECOND,
} as const;

export interface ScoreOptions {
  /** The local day to score, "YYYY-MM-DD". */
  date: string;
  /** The current instant, ISO. Passed in so the functions stay pure. */
  now: string;
  /** IANA zone for days and weeks. Default Europe/Athens. */
  timezone?: string;
}

export interface ScoreRange {
  /** Monday to Sunday of the week that holds the day. */
  days: string[];
  /** First instant needed: the start of the day 28 days before Monday (ms). */
  from: number;
  /** First instant of the next week (ms). */
  to: number;
}

/** A rest goal whose target (or title) describes sleep. Sleep sits outside the score. */
export function isSleepGoal(goal: Goal): boolean {
  if (goal.category !== "rest") return false;
  const keys = Object.keys(goal.target ?? {});
  return keys.some((k) => /sleep|bed/i.test(k)) || /\bsleep\b/i.test(goal.title);
}

/** True for a real calendar day written "YYYY-MM-DD". */
export function isLocalDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return date.toISOString().slice(0, 10) === day;
}

/** The Monday of the week a local day falls in. Weeks start on Monday. */
export function mondayOf(day: string, zone: Zone): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay(); // 0 = Sunday
  return zone.nextDay(day, -((weekday + 6) % 7));
}

/** Which events a score for `date` needs: its week, and the 28 days before it for the usual day. */
export function scoreRange(date: string, timezone = DEFAULT_TIMEZONE): ScoreRange {
  const zone = new Zone(timezone);
  const monday = mondayOf(date, zone);
  const days = Array.from({ length: 7 }, (_, i) => zone.nextDay(monday, i));
  return {
    days,
    from: zone.startOfDay(zone.nextDay(monday, -SCORE_RULES.historyDays)),
    to: zone.startOfDay(zone.nextDay(monday, 7)),
  };
}

// ---------- one block on one day ----------

/** Whole minutes of a block's part of one day. */
interface Sum {
  planned: number;
  elapsed: number;
  lost: number;
  verified: number;
}

interface Piece extends Span, Sum {
  day: string;
  block: GoalBlock;
  ticks: ScoreTick[];
  stretches: ScoreLostStretch[];
}

const ZERO: Sum = { planned: 0, elapsed: 0, lost: 0, verified: 0 };

const plus = (a: Sum, b: Sum): Sum => ({
  planned: a.planned + b.planned,
  elapsed: a.elapsed + b.elapsed,
  lost: a.lost + b.lost,
  verified: a.verified + b.verified,
});

const totals = (s: Sum) => ({
  planned_minutes: s.planned,
  elapsed_minutes: s.elapsed,
  spent_minutes: s.elapsed - s.lost,
  lost_minutes: s.lost,
  ahead_minutes: s.planned - s.elapsed,
  unverified_minutes: s.elapsed - s.lost - s.verified,
  score_pct: s.elapsed > 0 ? Math.round(((s.elapsed - s.lost) / s.elapsed) * 100) : null,
});

const wholeMinutes = (ms: number) => Math.round(ms / MINUTE);

/** First index whose end is after `t`. The line of attention has no overlaps, so ends are sorted too. */
function firstEndingAfter(attention: Segment[], t: number): number {
  let lo = 0;
  let hi = attention.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((attention[mid]?.end ?? Number.POSITIVE_INFINITY) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Distracting segments in a row, less than 30 seconds apart, are one lost stretch. */
function lostStretches(distractors: Segment[]): ScoreLostStretch[] {
  const out: ScoreLostStretch[] = [];
  let group: Segment[] = [];
  const close = () => {
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) return;
    // Named after whatever held most of the stretch.
    const bySubject = new Map<string, { seg: Segment; ms: number }>();
    let lostMs = 0;
    for (const s of group) {
      const ms = s.end - s.start;
      lostMs += ms;
      const key = `${s.device}:${s.kind}:${s.key}`;
      const entry = bySubject.get(key);
      if (entry) entry.ms += ms;
      else bySubject.set(key, { seg: s, ms });
    }
    const top = [...bySubject.values()].sort((a, b) => b.ms - a.ms)[0]?.seg ?? first;
    out.push({
      start_at: iso(first.start),
      end_at: iso(last.end),
      minutes: round1(lostMs / MINUTE),
      // An app by name; a site by host only when it is on the public list, else by category.
      what: label(subjectOf(top)),
      kind: top.kind,
      category: top.category,
      device: top.device,
    });
    group = [];
  };
  for (const seg of distractors) {
    const last = group[group.length - 1];
    if (last && seg.start - last.end >= SCORE_RULES.stretchGapMs) close();
    group.push(seg);
  }
  close();
  return out;
}

function evaluate(
  block: GoalBlock,
  part: { day: string; start: number; end: number },
  attention: Segment[],
  workouts: Span[],
  now: number,
): Piece {
  const { start, end } = part;
  const elapsedEnd = Math.min(end, Math.max(start, now));
  const distractors: Segment[] = [];
  let verified: Span[] = [];

  if (elapsedEnd > start) {
    const isWorkGoal = block.goal.category === "work";
    for (let i = firstEndingAfter(attention, start); i < attention.length; i++) {
      const seg = attention[i];
      if (!seg || seg.start >= elapsedEnd) break;
      const piece = { start: Math.max(seg.start, start), end: Math.min(seg.end, elapsedEnd) };
      if (!(piece.end > piece.start)) continue;
      const role = roleOf(seg.category);
      if (role === "distractor") distractors.push({ ...seg, ...piece });
      else if (role === "work" && isWorkGoal) verified.push(piece);
    }
  }
  const lost = union(distractors.map((s) => ({ start: s.start, end: s.end })));
  if (block.goal.category === "gym" && elapsedEnd > start) {
    // A recorded workout proves training time, except the minutes that went to a distractor.
    for (const w of workouts) {
      const piece = { start: Math.max(w.start, start), end: Math.min(w.end, elapsedEnd) };
      if (piece.end > piece.start) verified.push(...subtractSpans(piece, lost));
    }
  }
  verified = union(verified);

  const ticks: ScoreTick[] = [];
  for (let a = start; a < end; a += SCORE_RULES.tickMs) {
    const b = Math.min(a + SCORE_RULES.tickMs, end);
    if (a >= now) {
      ticks.push("ahead");
      continue;
    }
    const tick = { start: a, end: b };
    const lostMs = overlapWith(tick, lost);
    if (lostMs * 2 >= b - a) {
      ticks.push("lost");
      continue;
    }
    const verifiedMs = overlapWith(tick, verified);
    const restMs = Math.min(b, now) - a - lostMs - verifiedMs;
    ticks.push(verifiedMs >= restMs ? "spent" : "unverified");
  }

  const planned = wholeMinutes(end - start);
  const elapsed = Math.min(planned, wholeMinutes(elapsedEnd - start));
  const lostMinutes = Math.min(elapsed, wholeMinutes(lost.reduce((t, s) => t + (s.end - s.start), 0)));
  const verifiedMinutes = Math.min(
    elapsed - lostMinutes,
    wholeMinutes(verified.reduce((t, s) => t + (s.end - s.start), 0)),
  );
  return {
    ...part,
    block,
    planned,
    elapsed,
    lost: lostMinutes,
    verified: verifiedMinutes,
    ticks,
    stretches: lostStretches(distractors),
  };
}

// ---------- the week and the day ----------

function timeWonBack(day: string, byDay: Map<string, Sum>, zone: Zone): TimeWonBack {
  let historyDays = 0;
  let elapsed = 0;
  let lost = 0;
  for (let back = 1; back <= SCORE_RULES.historyDays; back++) {
    const past = byDay.get(zone.nextDay(day, -back));
    if (!past || past.elapsed === 0) continue;
    historyDays++;
    elapsed += past.elapsed;
    lost += past.lost;
  }
  if (historyDays < SCORE_RULES.minHistoryDays) {
    return {
      minutes: 0,
      usual_loss_rate: null,
      history_days: historyDays,
      reason: `not enough history: needs ${SCORE_RULES.minHistoryDays} days with goal blocks in the previous ${SCORE_RULES.historyDays}, found ${historyDays}`,
    };
  }
  const rate = lost / elapsed;
  const today = byDay.get(day) ?? ZERO;
  return {
    minutes: Math.max(0, Math.round(rate * today.elapsed - today.lost)),
    usual_loss_rate: Math.round(rate * 1000) / 1000,
    history_days: historyDays,
    reason: null,
  };
}

const toBlock = (p: Piece): ScoreBlock => ({
  event_id: p.block.eventId,
  goal_id: p.block.goal.id,
  goal_title: p.block.goal.title,
  title: p.block.title,
  matched_by: p.block.rule,
  start_at: iso(p.start),
  end_at: iso(p.end),
  ...totals(p),
  ticks: p.ticks,
  lost: p.stretches,
});

/**
 * The score for the week that holds `options.date`, and that day in detail. Pass every event
 * that overlaps `scoreRange(date)`: calendar events, workouts and the device events the timeline
 * is built from (app usage, web visits, screen).
 */
export function buildScore(events: Event[], goals: Goal[], options: ScoreOptions): Score {
  const zone = new Zone(options.timezone ?? DEFAULT_TIMEZONE);
  const now = Date.parse(options.now);
  if (!Number.isFinite(now)) throw new RangeError("now must be a valid ISO datetime");
  if (!isLocalDay(options.date)) throw new RangeError("date must be a local day, YYYY-MM-DD");
  const range = scoreRange(options.date, zone.name);

  const active = goals.filter((g) => g.active);
  const scored = active.filter((g) => !isSleepGoal(g));
  const blocks = goalBlocks(events, scored, range.from, range.to);
  const tl = buildTimeline(events, range.from, range.to);
  const workouts = union(
    events.flatMap((e) =>
      e.type === "workout" && e.end_at ? [{ start: Date.parse(e.start_at), end: Date.parse(e.end_at) }] : [],
    ),
  );

  const pieces: Piece[] = [];
  for (const block of blocks) {
    for (const part of zone.splitByDay(block.start, block.end)) {
      pieces.push(evaluate(block, part, tl.attention, workouts, now));
    }
  }
  pieces.sort((a, b) => a.start - b.start);

  const byDay = new Map<string, Sum>();
  for (const p of pieces) byDay.set(p.day, plus(byDay.get(p.day) ?? ZERO, p));

  const wonBack = new Map(range.days.map((day) => [day, timeWonBack(day, byDay, zone)]));
  const days: ScoreDay[] = range.days.map((day) => ({
    date: day,
    ...totals(byDay.get(day) ?? ZERO),
    time_won_back_minutes: wonBack.get(day)?.minutes ?? 0,
  }));

  const inWeek = new Set(range.days);
  const weekPieces = pieces.filter((p) => inWeek.has(p.day));
  const week = weekPieces.reduce(plus, ZERO);

  const goalRows: ScoreGoal[] = active.map((goal) => {
    const own = weekPieces.filter((p) => p.block.goal.id === goal.id);
    const t = totals(own.reduce(plus, ZERO));
    return {
      goal_id: goal.id,
      title: goal.title,
      category: goal.category,
      scored: !isSleepGoal(goal),
      budget_minutes: goal.weekly_budget_minutes ?? 0,
      ...t,
      daily: range.days.map((day) => {
        const d = totals(own.filter((p) => p.day === day).reduce(plus, ZERO));
        return { date: day, planned_minutes: d.planned_minutes, spent_minutes: d.spent_minutes };
      }),
    };
  });

  const today = days.find((d) => d.date === options.date);
  if (!today) throw new RangeError("date is outside its own week");
  const lastEnd = (segs: Segment[]) => {
    const last = segs[segs.length - 1];
    return last ? iso(last.end) : null;
  };

  return {
    week_start: iso(zone.startOfDay(range.days[0] ?? options.date)),
    ...totals(week),
    time_won_back_minutes: days.reduce((t, d) => t + d.time_won_back_minutes, 0),
    goals: goalRows,
    timezone: zone.name,
    generated_at: iso(now),
    date: options.date,
    days,
    day: {
      ...today,
      now: iso(now),
      time_won_back: wonBack.get(options.date) ?? {
        minutes: 0,
        usual_loss_rate: null,
        history_days: 0,
        reason: null,
      },
      blocks: pieces.filter((p) => p.day === options.date).map(toBlock),
    },
    data_until: { mac: lastEnd(tl.mac), iphone: lastEnd(tl.iphone) },
  };
}
