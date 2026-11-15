import {
  type ChecklistItem,
  type Event,
  type Goal,
  type GoalArea,
  goalArea,
  goalKind,
  type Instruction,
  isSleepGoal,
  type Place,
  type Score,
  type ScoreArea,
  type ScoreBlock,
  type ScoreDay,
  type ScoreGoal,
  type ScoreLostBy,
  type ScoreLostStretch,
  type ScoreTick,
  type TimeWonBack,
} from "@michael/shared";
import { forbiddenBy } from "../instructions/protected";
import { placeProof } from "../location/visits";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { type GoalBlock, goalBlocks } from "../patterns/focus";
import { label } from "../patterns/format";
import { MINUTE, SECOND, Zone } from "../patterns/time";
import { buildTimeline, type Segment, subjectOf } from "../patterns/timeline";
import { iso, overlapWith, round1, type Span, subtractSpans, union } from "../patterns/util";
import type { CountCheckIn } from "./check-in";
import { COUNT_RULES, checklistRow, countRow, type Occurrence } from "./count";
import { type LoggedDone, loggedFrom } from "./logged";
import { calendarTitles, goalForEvent, titleMatchesAny } from "./match";
import { isBusinessGoal, isTrainingGoal, purposeFor } from "./purpose";
import type { BlockRun, RecordWeek } from "./records";
import { type TargetWeek, withTarget } from "./targets";
import { commitments, committedMinutes, freeMinutesLeft, protectedSpans, sleepWeek, wakingDay } from "./week";

export { isSleepGoal };

// The score: the share of planned goal time that was spent on the goals. Pure: events, goals,
// the day, `now` and the timezone go in, the numbers come out. No I/O and no clock.
//
// THE ATTRIBUTION RULE (also in docs/api.md, "Score"; change both together)
//
//   Goals       Three categories: business, health, personal (`goalArea`; the older `work` reads
//               as business, `gym`, `rest` and `food` as health). Only goals of kind `time` take
//               part: a target (sleep), a count or a checklist has no planned minutes. It is
//               listed with `scored: false` and has no blocks.
//   Planned     The user's own calendar blocks that belong to a goal (score/match.ts). An event
//               with other people in it is never a block. Where two blocks overlap, the earlier
//               one keeps the time. A block that crosses local midnight is cut there: each day
//               gets its part.
//   Ahead       Planned time that has not started yet (after `now`).
//   Elapsed     Planned time that has passed. A block in progress counts up to `now`.
//   Lost        Time inside an elapsed block that was off purpose for the block's goal, on any
//               device. What is off purpose is decided in one place, score/purpose.ts, which the
//               patterns' calendar mode reads too:
//                 - a distracting category (communication, social, video, news, shopping,
//                   travel), unless the goal lists it in `target.work_categories`: on a sales
//                   goal with ["communication"], mail and messages are the work;
//                 - a work category (work, ai) inside a block of a health or personal goal that
//                   does not list it. A sales call during the gym session is not training.
//               It is read from the single line of attention (patterns/timeline.ts), where the
//               phone and the Mac are already one line, so a minute is never lost twice.
//   Spent       Elapsed minus lost.
//   Verified    The part of spent for which the data positively shows the goal:
//                 any goal:        attention in a category it lists in `target.work_categories`;
//                 a business goal: attention in a work category (work, ai) inside the block;
//                 a health goal:   a `workout` event overlapping the block (minus lost time).
//               Nothing else can prove a goal.
//   Unverified  Spent minus verified: the block had no device data there, or only neutral apps
//               (music, the system, anything uncategorised). Reported apart, never shown as proven.
//
//   A block with no data at all and no workout counts as SPENT, all of it unverified. Time in the
//   gym or studying on paper leaves no trace on a screen, and a coach who calls a real session
//   "missed" loses the user's trust on day one. The price is that a skipped session also scores
//   as spent until a watch or a check in says otherwise; `unverified_minutes` shows how much of
//   the score rests on that.
//
//   The user's word (#317, score/logged.ts) settles what the data cannot. It beats the devices:
//     Logged      Done time the user reported ("a bath, 40 minutes, at 13:00"), past only. Inside
//                 a block of the same goal it confirms that time: verified, never lost, so the
//                 block becomes confirmed instead of the minutes counting twice. The part outside
//                 every block of its goal was never planned (#372), so it stays out of the score
//                 entirely: not planned, not elapsed, not spent, no block, no ticks. It counts
//                 toward the goal's weekly budget instead, as `logged_minutes` on the goal row
//                 (`minutes_left` = budget - spent - logged), on each day and on the week, so the
//                 maths can say "plus 40 min you logged outside your blocks".
//     Did it      A past block settled with some of its minutes from its start: those minutes are
//                 verified, the rest of its elapsed time is lost. All of it: the block is verified.
//     Didn't      A past block settled as not done: all of its elapsed time is lost.
//   A settled block carries `settled` ("did" or "didnt"). A logged entry for a count goal is one
//   occurrence of it (score/count.ts), like a check in "yes".
//
//   So the headline, the day's tape and the Keep the Day strip read the same planned and spent
//   minutes: logging time outside a block never moves the score, only the budget.
//
//   Count and checklist goals are outside the score too: each gets a row of its own (`count`,
//   `checklist`) by the rules in score/count.ts, and adds nothing to any total.
//
//   Sleep is outside the score: it is a goal of kind `target` (an older `rest` goal whose target
//   describes sleep reads as one), listed with its budget (`scored: false`), in no total.
//
//   Areas: the same totals per category, for the week and for the day, so a strong business week
//   with no personal time does not read as a win. They add up to the week and to the day.
//
//   Standing instructions ("keep Sundays clear") never change a minute of the score; the one
//   number they touch is `free_minutes_left`, which leaves out the time they protect (week.ts).
//   Each block carries `instructions_broken`: the active instructions its time falls under
//   (instructions/protected.ts), so the app can flag a block planned on a clear day. A block named
//   in an instruction's `exceptions` ("Rhefuel" on a clear Sunday) does not break it.
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
  /** The user's standing instructions, for `instructions_broken` on each block. Default none. */
  instructions?: Instruction[];
  /** Checklist items of the week (#238), for the `checklist` rows. Default none. */
  checklist?: ChecklistItem[];
  /** Check in answers "yes" (score/check-in.ts), for the `count` rows. Default none. */
  countCheckIns?: CountCheckIn[];
  /** The user's saved places, so location visits at a gym or the office count as proof. Default none
   * (a visit's own place key and label still say what it is). */
  places?: Place[];
}

export interface ScoreRange {
  /** Monday to Sunday of the week that holds the day. */
  days: string[];
  /** First instant needed: the start of the day 28 days before Monday (ms). */
  from: number;
  /** First instant of the next week (ms). */
  to: number;
}

/** Only goals of kind `time` are measured in planned minutes. Sleep, a count or a checklist is not. */
export const isScoredGoal = (goal: Goal): boolean => goalKind(goal) === "time";

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
  settled: "did" | "didnt" | null;
}

/** What the user said about one block (#317): their logged time of its goal, and how they settled it. */
interface UserWord {
  done: Span[];
  settled: "did" | "didnt" | null;
}

const NO_WORD: UserWord = { done: [], settled: null };

const ZERO: Sum = { planned: 0, elapsed: 0, lost: 0, verified: 0 };

/** The lost stretches of some blocks summed by what took them, most first; under a minute is left out. */
export function lostBy(stretches: ScoreLostStretch[]): ScoreLostBy[] {
  const sums = new Map<string, ScoreLostBy>();
  for (const s of stretches) {
    const key = `${s.kind}\u0000${s.what}`;
    const row = sums.get(key);
    if (row) row.minutes += s.minutes;
    else sums.set(key, { what: s.what, kind: s.kind, category: s.category, minutes: s.minutes });
  }
  return [...sums.values()]
    .map((r) => ({ ...r, minutes: Math.round(r.minutes) }))
    .filter((r) => r.minutes >= 1)
    .sort((a, b) => b.minutes - a.minutes || a.what.localeCompare(b.what));
}

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
  proof: { training: Span[]; business: Span[] },
  now: number,
  word: UserWord = NO_WORD,
): Piece {
  const { start, end } = part;
  const elapsedEnd = Math.min(end, Math.max(start, now));
  const distractors: Segment[] = [];
  let verified: Span[] = [];

  if (elapsedEnd > start) {
    // On purpose is verified, off purpose is lost, neutral is neither (score/purpose.ts).
    const purpose = purposeFor(block.goal);
    for (let i = firstEndingAfter(attention, start); i < attention.length; i++) {
      const seg = attention[i];
      if (!seg || seg.start >= elapsedEnd) break;
      const piece = { start: Math.max(seg.start, start), end: Math.min(seg.end, elapsedEnd) };
      if (!(piece.end > piece.start)) continue;
      const what = purpose(seg.category);
      if (what === "off") distractors.push({ ...seg, ...piece });
      else if (what === "on") verified.push(piece);
    }
  }
  let lost = union(distractors.map((s) => ({ start: s.start, end: s.end })));
  // A recorded workout or a visit to the gym proves training time; being at work or university
  // proves business time (location/visits.ts placeRole). Minus the minutes that went to a distractor.
  const shown = isTrainingGoal(block.goal)
    ? proof.training
    : isBusinessGoal(block.goal)
      ? proof.business
      : [];
  if (elapsedEnd > start) {
    for (const w of shown) {
      const piece = { start: Math.max(w.start, start), end: Math.min(w.end, elapsedEnd) };
      if (piece.end > piece.start) verified.push(...subtractSpans(piece, lost));
    }
  }
  verified = union(verified);

  // The user's word beats the devices (#317): logged time of the block's goal is confirmed and
  // never lost; a settled block is what the user said it was.
  let kept = distractors;
  const elapsedSpan = { start, end: elapsedEnd };
  const said =
    elapsedEnd > start
      ? union(word.done.map((d) => ({ start: Math.max(d.start, start), end: Math.min(d.end, elapsedEnd) })))
      : [];
  if (word.settled === "didnt") {
    lost = elapsedEnd > start ? [elapsedSpan] : [];
    verified = [];
    kept = [];
  } else if (word.settled === "did") {
    lost = elapsedEnd > start ? subtractSpans(elapsedSpan, said) : [];
    verified = said;
    kept = [];
  } else if (said.length > 0) {
    lost = union(lost.flatMap((l) => subtractSpans(l, said)));
    verified = union([...verified, ...said]);
    kept = distractors.flatMap((d) => subtractSpans(d, said).map((p) => ({ ...d, ...p })));
  }

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
    stretches: lostStretches(kept),
    settled: word.settled,
  };
}

/**
 * Whole minutes of logged time outside every block of its goal on one day (#372): budget time,
 * never planned time. 0 when nothing of it has passed.
 */
const loggedMinutes = (part: { start: number; end: number }, now: number): number =>
  Math.max(0, wholeMinutes(Math.min(part.end, now) - part.start));

// ---------- count goals (#238, the rule in score/count.ts) ----------

/** Every count goal's occurrences in [from, to) up to `now`, by goal id. */
function countOccurrences(
  events: Event[],
  goals: Goal[],
  checkIns: CountCheckIn[],
  span: Span,
  attention: Segment[],
  proof: { training: Span[]; business: Span[] },
  now: number,
  zone: Zone,
): Map<string, Occurrence[]> {
  const out = new Map<string, Occurrence[]>(goals.map((g) => [g.id, []]));
  if (goals.length === 0) return out;
  const inWeek = (start: number) => start >= span.start && start < span.end;

  // Own blocks, matched among the count goals only: a block of a time goal is not a session.
  const blocks = new Map<string, Span[]>(goals.map((g) => [g.id, []]));
  const blockGoal = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "calendar_event" || !e.end_at) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (!(end > start) || !inWeek(start)) continue;
    const match = goalForEvent(e, goals);
    if (!match) continue;
    blocks.get(match.goal.id)?.push({ start, end });
    blockGoal.set(e.id, match.goal.id);
    if (end > now) continue;
    const block: GoalBlock = {
      start,
      end,
      eventId: e.id,
      goal: match.goal,
      title: e.title,
      rule: match.rule,
    };
    const p = evaluate(block, { day: zone.dayOf(start), start, end }, attention, proof, now);
    if (p.planned > 0 && p.elapsed - p.lost >= p.planned * COUNT_RULES.minSpentShare) {
      out.get(match.goal.id)?.push({ source: "block", start, end });
    }
  }

  for (const e of events) {
    if (e.type !== "workout" || !e.end_at) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (!(end > start) || end > now || !inWeek(start)) continue;
    for (const goal of goals) {
      const linked =
        e.data?.goal_id === goal.id ||
        titleMatchesAny(e.title, calendarTitles(goal)) ||
        (blocks.get(goal.id) ?? []).some((b) => b.start < end && b.end > start);
      if (linked) out.get(goal.id)?.push({ source: "workout", start, end });
    }
  }

  for (const c of checkIns) {
    if (c.start > now || !inWeek(c.start)) continue;
    const goalId =
      (c.goal_id && out.has(c.goal_id) ? c.goal_id : null) ?? (c.event_id ? blockGoal.get(c.event_id) : null);
    if (goalId) out.get(goalId)?.push({ source: "check_in", start: c.start, end: c.end, untimed: c.untimed });
  }
  return out;
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

const AREAS: GoalArea[] = ["business", "health", "personal"];

/** The totals per category over some pieces. Every active goal is listed, scored or not. */
const areaRows = (pieces: Piece[], goals: Goal[]): ScoreArea[] =>
  AREAS.map((area) => ({
    area,
    goal_ids: goals.filter((g) => goalArea(g.category) === area).map((g) => g.id),
    ...totals(pieces.filter((p) => goalArea(p.block.goal.category) === area).reduce(plus, ZERO)),
  }));

const toBlock = (p: Piece, instructions: Instruction[], zone: Zone): ScoreBlock => ({
  event_id: p.block.eventId,
  goal_id: p.block.goal.id,
  goal_title: p.block.goal.title,
  title: p.block.title,
  matched_by: p.block.rule,
  start_at: iso(p.start),
  end_at: iso(p.end),
  record_id: null,
  ...totals(p),
  ticks: p.ticks,
  lost: p.stretches,
  instructions_broken: forbiddenBy(instructions, p.block.title, p.start, p.end, zone).map((i) => i.id),
  // Absent while unsettled, so older readers and fixtures see the same block.
  ...(p.settled ? { settled: p.settled } : {}),
});

/** One week as the target and the records read it. */
export type HistoryWeek = RecordWeek & { committed_minutes: number };

/** The same week in the target rule's shape, with the target stored for it. */
export const targetWeek = (w: HistoryWeek, target: TargetWeek["target"]): TargetWeek => ({
  week_start: w.week_start,
  complete: w.complete,
  score_pct: w.score_pct,
  areas: Object.fromEntries(AREAS.map((a) => [a, w.areas[a].score_pct])) as TargetWeek["areas"],
  committed_minutes: w.committed_minutes,
  target,
});

/** The week's history behind the target (#165) and the records (#166). */
export interface ScoreHistory {
  /** The four weeks before the score's week and the week itself, oldest first. */
  weeks: HistoryWeek[];
  /** The longest run with no lost tick in each ended block part, over the same five weeks. */
  runs: BlockRun[];
}

/** Totals per category over some pieces. */
const areaTotals = (pieces: Piece[]) =>
  Object.fromEntries(
    AREAS.map((area) => [
      area,
      totals(pieces.filter((p) => goalArea(p.block.goal.category) === area).reduce(plus, ZERO)),
    ]),
  ) as Record<GoalArea, ReturnType<typeof totals>>;

/**
 * The longest stretch of verified ticks (`spent`) in an ended piece. An `unverified` tick breaks
 * the run like a lost one: a record never rests on time the data cannot prove.
 */
function longestRun(p: Piece): BlockRun | null {
  let best: { first: number; minutes: number[] } | null = null;
  let run: { first: number; minutes: number[] } | null = null;
  const sum = (r: { minutes: number[] }) => r.minutes.reduce((t, m) => t + m, 0);
  p.ticks.forEach((tick, i) => {
    const a = p.start + i * SCORE_RULES.tickMs;
    const minutes = (Math.min(a + SCORE_RULES.tickMs, p.end) - a) / MINUTE;
    if (tick !== "spent") {
      run = null;
      return;
    }
    if (!run) run = { first: i, minutes: [] };
    run.minutes.push(minutes);
    if (!best || sum(run) > sum(best)) best = { first: run.first, minutes: [...run.minutes] };
  });
  const found = best as { first: number; minutes: number[] } | null;
  if (!found) return null;
  return {
    event_id: p.block.eventId,
    goal_id: p.block.goal.id,
    goal_title: p.block.goal.title,
    area: goalArea(p.block.goal.category),
    day: p.day,
    end: p.end,
    minutes: Math.round(sum(found)),
    first_tick: found.first,
    tick_minutes: found.minutes,
  };
}

/**
 * The score for the week that holds `options.date`, and that day in detail. Pass every event
 * that overlaps `scoreRange(date)`: calendar events, workouts, sleep and the device events the
 * timeline is built from (app usage, web visits, screen).
 */
export function buildScore(events: Event[], goals: Goal[], options: ScoreOptions): Score {
  return scoreWithHistory(events, goals, options).score;
}

/**
 * The score, and the weeks and blocks before it that the target and the records read. `blocks` is
 * every block part the score saw (the week and the 28 days before it) in time order, each with its
 * own totals and lost stretches: the Morning and Evening moments read the days before today from
 * it, so what they say about a block is what the score counted.
 */
export function scoreWithHistory(
  events: Event[],
  goals: Goal[],
  options: ScoreOptions,
): { score: Score; history: ScoreHistory; blocks: ScoreBlock[] } {
  const zone = new Zone(options.timezone ?? DEFAULT_TIMEZONE);
  const now = Date.parse(options.now);
  if (!Number.isFinite(now)) throw new RangeError("now must be a valid ISO datetime");
  if (!isLocalDay(options.date)) throw new RangeError("date must be a local day, YYYY-MM-DD");
  const range = scoreRange(options.date, zone.name);

  const active = goals.filter((g) => g.active);
  // goalBlocks leaves out every goal that is not of kind `time`.
  const blocks = goalBlocks(events, active, range.from, range.to);
  const instructions = (options.instructions ?? []).filter((i) => i.active);
  const tl = buildTimeline(events, range.from, range.to);
  const atPlaces = placeProof(events, options.places ?? []);
  const proof = {
    training: union([
      ...events.flatMap((e) =>
        e.type === "workout" && e.end_at
          ? [{ start: Date.parse(e.start_at), end: Date.parse(e.end_at) }]
          : [],
      ),
      ...atPlaces.training,
    ]),
    business: union(atPlaces.business),
  };

  // The user's word (#317): logged done time by goal, and the blocks they settled.
  const logged = loggedFrom(events);
  const goalById = new Map(active.map((g) => [g.id, g]));
  const doneByGoal = new Map<string, LoggedDone[]>();
  for (const d of logged.done) {
    if (d.start >= now || d.end <= range.from || d.start >= range.to) continue;
    const goal = goalById.get(d.goalId);
    if (!goal || !isScoredGoal(goal)) continue;
    doneByGoal.set(d.goalId, [...(doneByGoal.get(d.goalId) ?? []), d]);
  }
  const settledDid = new Set(logged.done.flatMap((d) => (d.eventId ? [d.eventId] : [])));
  const wordFor = (block: GoalBlock): UserWord => ({
    done: doneByGoal.get(block.goal.id) ?? [],
    settled: logged.didnt.has(block.eventId) ? "didnt" : settledDid.has(block.eventId) ? "did" : null,
  });

  const pieces: Piece[] = [];
  for (const block of blocks) {
    const word = wordFor(block);
    for (const part of zone.splitByDay(block.start, block.end)) {
      pieces.push(evaluate(block, part, tl.attention, proof, now, word));
    }
  }
  // Logged time outside every block of its goal is budget time, not planned time (#372): minutes
  // by goal and day, kept apart from the pieces so no total of the score sees them.
  const loggedByGoalDay = new Map<string, Map<string, number>>();
  for (const [goalId, entries] of doneByGoal) {
    const holes = union(blocks.filter((b) => b.goal.id === goalId));
    const byDay = new Map<string, number>();
    for (const entry of entries) {
      const span = { start: Math.max(entry.start, range.from), end: Math.min(entry.end, range.to, now) };
      if (!(span.end > span.start)) continue;
      for (const rest of subtractSpans(span, holes)) {
        for (const part of zone.splitByDay(rest.start, rest.end)) {
          const minutes = loggedMinutes(part, now);
          if (minutes > 0) byDay.set(part.day, (byDay.get(part.day) ?? 0) + minutes);
        }
      }
    }
    loggedByGoalDay.set(goalId, byDay);
  }
  const loggedOn = (day: string, goalId?: string): number => {
    let t = 0;
    for (const [id, byDay] of loggedByGoalDay) if (!goalId || id === goalId) t += byDay.get(day) ?? 0;
    return t;
  };
  pieces.sort((a, b) => a.start - b.start);

  const byDay = new Map<string, Sum>();
  for (const p of pieces) byDay.set(p.day, plus(byDay.get(p.day) ?? ZERO, p));

  const wonBack = new Map(range.days.map((day) => [day, timeWonBack(day, byDay, zone)]));
  const days: ScoreDay[] = range.days.map((day) => ({
    date: day,
    ...totals(byDay.get(day) ?? ZERO),
    time_won_back_minutes: wonBack.get(day)?.minutes ?? 0,
    logged_minutes: loggedOn(day),
  }));

  const inWeek = new Set(range.days);
  const weekPieces = pieces.filter((p) => inWeek.has(p.day));
  const week = weekPieces.reduce(plus, ZERO);

  const weekSpan = { start: zone.startOfDay(range.days[0] ?? options.date), end: range.to };
  const occurrences = countOccurrences(
    events,
    active.filter((g) => goalKind(g) === "count"),
    [
      ...(options.countCheckIns ?? []),
      // A logged entry for a count goal is one occurrence of it, like a check in "yes".
      ...logged.done
        .filter((d) => goalById.has(d.goalId) && goalKind(goalById.get(d.goalId) as Goal) === "count")
        .map((d) => ({ goal_id: d.goalId, event_id: null, start: d.start, end: d.end, untimed: false })),
    ],
    weekSpan,
    tl.attention,
    proof,
    now,
    zone,
  );

  const goalRows: ScoreGoal[] = active.map((goal) => {
    const own = weekPieces.filter((p) => p.block.goal.id === goal.id);
    const t = totals(own.reduce(plus, ZERO));
    const budget = goal.weekly_budget_minutes ?? 0;
    const scored = isScoredGoal(goal);
    const kind = goalKind(goal);
    const logged = range.days.reduce((sum, day) => sum + loggedOn(day, goal.id), 0);
    return {
      goal_id: goal.id,
      title: goal.title,
      category: goal.category,
      area: goalArea(goal.category),
      kind,
      scored,
      budget_minutes: budget,
      ...t,
      logged_minutes: logged,
      daily: range.days.map((day) => {
        const d = totals(own.filter((p) => p.day === day).reduce(plus, ZERO));
        return {
          date: day,
          planned_minutes: d.planned_minutes,
          spent_minutes: d.spent_minutes,
          logged_minutes: loggedOn(day, goal.id),
        };
      }),
      minutes_left: scored ? Math.max(0, budget - t.spent_minutes - logged) : 0,
      // A block that crosses midnight is one block.
      open_blocks: new Set(own.filter((p) => p.end > now).map((p) => p.block.eventId)).size,
      ...(kind === "checklist"
        ? { checklist: checklistRow(goal.id, options.checklist ?? [], options.date, range.days) }
        : {}),
      ...(kind === "count"
        ? { count: countRow(goal, occurrences.get(goal.id) ?? [], range.days, now, zone) }
        : {}),
    };
  });

  const today = days.find((d) => d.date === options.date);
  if (!today) throw new RangeError("date is outside its own week");
  const dayPieces = pieces.filter((p) => p.day === options.date);
  const lastEnd = (segs: Segment[]) => {
    const last = segs[segs.length - 1];
    return last ? iso(last.end) : null;
  };

  // The waking day, the fixed commitments and the free time left (score/week.ts).
  const waking = wakingDay(active);
  const committed = commitments(
    events.filter((e) => {
      const start = Date.parse(e.start_at);
      return start < range.to && (e.end_at ? Date.parse(e.end_at) : start) > range.from;
    }),
    new Set(blocks.map((b) => b.eventId)),
  );

  // The four weeks before and this one, for the target and the records.
  const monday = range.days[0] ?? options.date;
  const weeks: ScoreHistory["weeks"] = [-4, -3, -2, -1, 0].map((back) => {
    const start = zone.nextDay(monday, back * 7);
    const weekDays = Array.from({ length: 7 }, (_, i) => zone.nextDay(start, i));
    const own = new Set(weekDays);
    const ps = pieces.filter((p) => own.has(p.day));
    const t = totals(ps.reduce(plus, ZERO));
    const byArea = areaTotals(ps);
    return {
      week_start: start,
      complete: zone.startOfDay(zone.nextDay(start, 7)) <= now,
      score_pct: t.score_pct,
      elapsed_minutes: t.elapsed_minutes,
      areas: Object.fromEntries(
        AREAS.map((a) => [a, { score_pct: byArea[a].score_pct, elapsed_minutes: byArea[a].elapsed_minutes }]),
      ) as RecordWeek["areas"],
      committed_minutes: committedMinutes(zone, weekDays, waking, committed),
    };
  });
  const runs = pieces.flatMap((p) => (p.end <= now ? (longestRun(p) ?? []) : []));
  const history: ScoreHistory = { weeks, runs };

  const score: Score = withTarget(
    {
      week_start: iso(zone.startOfDay(monday)),
      ...totals(week),
      time_won_back_minutes: days.reduce((t, d) => t + d.time_won_back_minutes, 0),
      logged_minutes: days.reduce((t, d) => t + (d.logged_minutes ?? 0), 0),
      goals: goalRows,
      timezone: zone.name,
      generated_at: iso(now),
      date: options.date,
      areas: areaRows(weekPieces, active).map((a) => ({
        ...a,
        target_pct: null,
        floor_pct: 0,
        meets_floor: null,
      })),
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
        blocks: dayPieces.map((p) => toBlock(p, instructions, zone)),
        areas: areaRows(dayPieces, active),
      },
      data_until: { mac: lastEnd(tl.mac), iphone: lastEnd(tl.iphone) },
      target: null,
      on_target: null,
      records: [],
      free_minutes_left: freeMinutesLeft(
        zone,
        range.days,
        now,
        waking,
        committed,
        protectedSpans(instructions, zone, range.days, blocks),
      ),
      lost_by: lostBy(weekPieces.flatMap((piece) => piece.stretches)),
      sleep: sleepWeek(events, active, zone, range.days, now),
    },
    null,
  );
  return { score, history, blocks: pieces.map((p) => toBlock(p, instructions, zone)) };
}
