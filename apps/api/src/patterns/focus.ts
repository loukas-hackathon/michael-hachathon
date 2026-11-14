import type {
  AppCategory,
  Disruption,
  Drift,
  Event,
  FocusDisruptions,
  Goal,
  PatternSubject,
  RecoveryCost,
  RepeatOffenders,
} from "@michael/shared";
import { GoalCategory } from "@michael/shared";
import { type Ctx, countedDays, daysTouched, RULES } from "./context";
import { type Detector, found, notEnough } from "./detector";
import { count, days as dayCount, duration, label, rate } from "./format";
import { MINUTE } from "./time";
import { notifiedBefore, type Segment, subjectOf } from "./timeline";
import {
  add,
  capIds,
  iso,
  median,
  mins,
  ratio,
  round1,
  type Span,
  subjectId,
  subtractSpans,
  union,
  unionLength,
} from "./util";

// ---------- roles ----------

export type Role = "work" | "distractor" | "neutral";

const WORK: ReadonlySet<AppCategory> = new Set(["work", "ai"]);
const DISTRACTOR: ReadonlySet<AppCategory> = new Set([
  "communication",
  "social",
  "video",
  "news",
  "shopping",
  "travel",
]);
/** Browsing categories that count as drift during focus. */
export const DRIFT: ReadonlySet<AppCategory> = new Set(["travel", "shopping", "video", "social", "news"]);

/** Music, the system itself and anything unknown are neutral: they neither make nor break focus. */
export const roleOf = (category: AppCategory): Role =>
  WORK.has(category) ? "work" : DISTRACTOR.has(category) ? "distractor" : "neutral";

// ---------- shared shapes ----------

export interface RawDisruption extends Span {
  mode: "calendar" | "inferred";
  trigger: Segment;
  left: Segment | null;
  lostMs: number;
  /** From leaving `left` until it is in front again. */
  backMs: number | null;
  ended: boolean;
  blockEventId: string | null;
  goalId: string | null;
  eventIds: string[];
}

export interface FocusWindow extends Span {
  during: "focus_stretch" | "work_block";
}

export interface FocusAnalysis {
  blocks: GoalBlock[];
  /** Inferred focus stretches that qualify, outside planned blocks. */
  stretches: Span[];
  /** Where focus was: qualifying stretches and planned work blocks. */
  windows: FocusWindow[];
  /** Time on purpose: stretch spans, plus work app time inside work blocks. */
  focusSpans: Span[];
  /** Work with no disruption and no idle break in it. */
  runs: Span[];
  disruptions: RawDisruption[];
}

// ---------- mode (ii): focus stretches inferred from the data ----------

interface Stretch extends Span {
  qualifies: boolean;
  runs: Span[];
  disruptions: RawDisruption[];
}

const sameThing = (a: Segment, b: Segment) => a.device === b.device && a.kind === b.kind && a.key === b.key;

/**
 * A focus stretch starts when a work app comes to the front and lasts for as long as the user
 * keeps coming back to work apps. It ends when they are away from work apps for more than 10
 * minutes, or when nothing is in front for more than 2 minutes (screen off, lid closed). It
 * counts when it spans at least 15 minutes and work apps hold at least half of it.
 *
 * Inside a stretch, a trip away from work that touches a distractor is a disruption. A distractor
 * that comes up within a minute after the last work app, with no return inside the limit, is the
 * disruption that ended the stretch.
 */
export function inferStretches(segs: Segment[]): Stretch[] {
  const out: Stretch[] = [];
  let i = 0;
  while (i < segs.length) {
    const first = segs[i];
    if (!first || roleOf(first.category) !== "work") {
      i++;
      continue;
    }
    let lastWork = i;
    let j = i + 1;
    for (; j < segs.length; j++) {
      const prev = segs[j - 1];
      const cur = segs[j];
      const anchor = segs[lastWork];
      if (!prev || !cur || !anchor) break;
      if (cur.start - prev.end > RULES.idleBreakMs) break;
      if (cur.start - anchor.end > RULES.maxAwayMs) break;
      if (roleOf(cur.category) === "work") lastWork = j;
    }
    out.push(buildStretch(segs, i, lastWork, j));
    i = lastWork + 1;
  }
  return out;
}

function buildStretch(segs: Segment[], from: number, lastWork: number, stop: number): Stretch {
  const start = segs[from]?.start ?? 0;
  const end = segs[lastWork]?.end ?? start;
  let workMs = 0;
  const disruptions: RawDisruption[] = [];
  const runs: Span[] = [];
  let runStart = start;
  let prevWork = from;

  for (let k = from; k <= lastWork; k++) {
    const seg = segs[k];
    if (!seg || roleOf(seg.category) !== "work") continue;
    workMs += seg.end - seg.start;
    if (k === from) continue;
    const left = segs[prevWork];
    const between = segs.slice(prevWork + 1, k);
    const distractors = between.filter((s) => roleOf(s.category) === "distractor");
    const trigger = distractors[0];
    if (left && trigger) {
      // Back in the app that was left: the first time it is in front again inside this stretch.
      let backMs: number | null = null;
      for (let b = k; b <= lastWork; b++) {
        const candidate = segs[b];
        if (candidate && sameThing(candidate, left)) {
          backMs = candidate.start - left.end;
          break;
        }
      }
      disruptions.push({
        mode: "inferred",
        start: trigger.start,
        end: seg.start,
        trigger,
        left,
        lostMs: distractors.reduce((t, s) => t + (s.end - s.start), 0),
        backMs,
        ended: false,
        blockEventId: null,
        goalId: null,
        eventIds: capIds(
          distractors.map((s) => s.eventId),
          5,
        ),
      });
      runs.push({ start: runStart, end: left.end });
      runStart = seg.start;
    }
    prevWork = k;
  }
  runs.push({ start: runStart, end });

  // What came right after the last work app.
  const last = segs[lastWork];
  if (last) {
    const limit = last.end + RULES.maxAwayMs;
    const trailing = segs.slice(lastWork + 1, stop).filter((s) => s.start < limit);
    const trigger = trailing.find((s) => roleOf(s.category) === "distractor");
    if (trigger && trigger.start - last.end <= RULES.endingWindowMs) {
      const distractors = trailing.filter((s) => roleOf(s.category) === "distractor");
      disruptions.push({
        mode: "inferred",
        start: trigger.start,
        end: Math.min(limit, trailing[trailing.length - 1]?.end ?? limit),
        trigger,
        left: last,
        // Only the first 10 minutes count: after that it is a break, not a disruption.
        lostMs: distractors.reduce((t, s) => t + (Math.min(s.end, limit) - s.start), 0),
        backMs: null,
        ended: true,
        blockEventId: null,
        goalId: null,
        eventIds: capIds(
          distractors.map((s) => s.eventId),
          5,
        ),
      });
    }
  }

  const span = end - start;
  const qualifies = span >= RULES.minStretchMs && workMs >= RULES.minWorkShare * span;
  return { start, end, qualifies, runs, disruptions };
}

// ---------- mode (i): planned blocks that belong to a goal ----------

export interface GoalBlock extends Span {
  eventId: string;
  goal: Goal;
}

/**
 * Which goal a calendar block belongs to. Provisional until tagging has its own contract:
 *   1. `data.goal_id` names a goal;
 *   2. `data.goal_category` (or `data.category`) names a goal category;
 *   3. the title starts with a category word ("Gym: upper body", "Work: pitch deck"), or contains
 *      "deep work" or "focus" for work.
 * Blocks with other people in them (attendees of 2 or more) are meetings, not focus blocks.
 */
export function goalBlocks(events: Event[], goals: Goal[], from: number, to: number): GoalBlock[] {
  const active = goals.filter((g) => g.active);
  if (active.length === 0) return [];
  const byCategory = (category: string) => active.find((g) => g.category === category);
  const out: GoalBlock[] = [];
  for (const e of events) {
    if (e.type !== "calendar_event" || !e.end_at) continue;
    const start = Math.max(Date.parse(e.start_at), from);
    const end = Math.min(Date.parse(e.end_at), to);
    if (!(end > start)) continue;
    const attendees = typeof e.data.attendees === "number" ? e.data.attendees : 0;
    if (attendees >= 2) continue;

    let goal = active.find((g) => g.id === e.data.goal_id);
    if (!goal) {
      const given = GoalCategory.safeParse(e.data.goal_category ?? e.data.category);
      if (given.success) goal = byCategory(given.data);
    }
    if (!goal) {
      const title = e.title.trim().toLowerCase();
      const firstWord = title.split(/[\s:]+/)[0] ?? "";
      const named = GoalCategory.safeParse(firstWord);
      if (named.success) goal = byCategory(named.data);
      else if (/\b(deep work|focus)\b/.test(title)) goal = byCategory("work");
    }
    if (goal) out.push({ start, end, eventId: e.id, goal });
  }
  // Two blocks over the same time: the earlier one keeps it, so no minute is analysed twice.
  out.sort((a, b) => a.start - b.start);
  const trimmed: GoalBlock[] = [];
  let covered = Number.NEGATIVE_INFINITY;
  for (const block of out) {
    const start = Math.max(block.start, covered);
    if (block.end > start) trimmed.push({ ...block, start });
    covered = Math.max(covered, block.end);
  }
  return trimmed;
}

/** Inside a work block anything distracting is off purpose; inside any other block work is too. */
const offPurpose = (goal: Goal, seg: Segment) => {
  const role = roleOf(seg.category);
  return goal.category === "work" ? role === "distractor" : role !== "neutral";
};

function analyseBlock(block: GoalBlock, attention: Segment[]) {
  const segs: Segment[] = [];
  for (const s of attention) {
    if (s.end <= block.start) continue;
    if (s.start >= block.end) break;
    segs.push({ ...s, start: Math.max(s.start, block.start), end: Math.min(s.end, block.end) });
  }
  const isWorkBlock = block.goal.category === "work";
  const disruptions: RawDisruption[] = [];
  const runs: Span[] = [];
  const onSpans: Span[] = [];
  let run: Span | null = null;
  let lastOn: Segment | null = null;
  let visit: Segment[] = [];

  const closeVisit = (nextIndex: number) => {
    const trigger = visit[0];
    const lastOff = visit[visit.length - 1];
    if (!trigger || !lastOff) return;
    const left = lastOn && trigger.start - lastOn.end <= RULES.endingWindowMs ? lastOn : null;
    let backMs: number | null = null;
    if (left) {
      for (let b = nextIndex; b < segs.length; b++) {
        const candidate = segs[b];
        if (candidate && sameThing(candidate, left)) {
          backMs = candidate.start - left.end;
          break;
        }
      }
    }
    disruptions.push({
      mode: "calendar",
      start: trigger.start,
      end: lastOff.end,
      trigger,
      left,
      lostMs: visit.reduce((t, s) => t + (s.end - s.start), 0),
      backMs,
      ended: false,
      blockEventId: block.eventId,
      goalId: block.goal.id,
      eventIds: capIds(
        visit.map((s) => s.eventId),
        5,
      ),
    });
    visit = [];
  };

  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    if (!seg) continue;
    const prev = segs[k - 1];
    const idle = prev !== undefined && seg.start - prev.end > RULES.idleBreakMs;
    if (offPurpose(block.goal, seg)) {
      // One visit = off purpose segments in a row, less than 30 seconds apart.
      const lastOff = visit[visit.length - 1];
      if (lastOff && (prev !== lastOff || seg.start - lastOff.end >= RULES.sessionGapMs)) closeVisit(k);
      visit.push(seg);
      if (run) runs.push(run);
      run = null;
      continue;
    }
    if (visit.length > 0) closeVisit(k);
    if (idle && run) {
      runs.push(run);
      run = null;
    }
    if (isWorkBlock && roleOf(seg.category) === "work") {
      onSpans.push({ start: seg.start, end: seg.end });
      if (run) run.end = seg.end;
      else run = { start: seg.start, end: seg.end };
      lastOn = seg;
    }
  }
  if (visit.length > 0) closeVisit(segs.length);
  if (run) runs.push(run);
  return { disruptions, runs, onSpans };
}

// ---------- both modes together ----------

export function analyseFocus(ctx: Ctx): FocusAnalysis {
  const blocks = goalBlocks(ctx.events, ctx.goals, ctx.from, ctx.to);
  const blockSpans = union(blocks.map((b) => ({ start: b.start, end: b.end })));

  const disruptions: RawDisruption[] = [];
  const runs: Span[] = [];
  const focusSpans: Span[] = [];
  const windows: FocusWindow[] = [];

  for (const block of blocks) {
    const result = analyseBlock(block, ctx.tl.attention);
    disruptions.push(...result.disruptions);
    runs.push(...result.runs);
    focusSpans.push(...result.onSpans);
    if (block.goal.category === "work")
      windows.push({ start: block.start, end: block.end, during: "work_block" });
  }

  // Planned blocks own their time. Stretches are inferred from what is left.
  let free = ctx.tl.attention;
  if (blockSpans.length > 0) {
    free = [];
    for (const s of ctx.tl.attention) {
      for (const piece of subtractSpans(s, blockSpans))
        free.push({ ...s, start: piece.start, end: piece.end });
    }
  }
  const stretches = inferStretches(free).filter((s) => s.qualifies);
  for (const s of stretches) {
    disruptions.push(...s.disruptions);
    runs.push(...s.runs);
    focusSpans.push({ start: s.start, end: s.end });
    windows.push({ start: s.start, end: s.end, during: "focus_stretch" });
  }

  disruptions.sort((a, b) => a.start - b.start);
  windows.sort((a, b) => a.start - b.start);
  return {
    blocks,
    stretches: stretches.map((s) => ({ start: s.start, end: s.end })),
    windows,
    focusSpans,
    runs,
    disruptions,
  };
}

function openedByNotification(ctx: Ctx, trigger: Segment): boolean | null {
  if (trigger.device === "iphone")
    return trigger.openedFrom === null ? null : trigger.openedFrom === "notification";
  if (trigger.kind !== "app" || ctx.tl.notifications.size === 0) return null;
  return notifiedBefore(ctx.tl, trigger.key, trigger.start, RULES.notificationWindowMs);
}

const toDisruption = (ctx: Ctx, d: RawDisruption): Disruption => ({
  mode: d.mode,
  day: ctx.zone.dayOf(d.start),
  start_at: iso(d.start),
  end_at: iso(d.end),
  device: d.trigger.device,
  trigger: subjectOf(d.trigger),
  opened_by_notification: openedByNotification(ctx, d.trigger),
  left: d.left ? subjectOf(d.left) : null,
  minutes_lost: mins(d.lostMs),
  minutes_until_back: d.backMs === null ? null : mins(d.backMs),
  ended_stretch: d.ended,
  block_event_id: d.blockEventId,
  goal_id: d.goalId,
  event_ids: d.eventIds,
});

/** Local days on which the user had any device time at all. */
const usageDays = (ctx: Ctx) => daysTouched(ctx, ctx.tl.attention);

const FOCUS_MINIMUM =
  "at least one focus stretch (15 minutes or more, at least half of it in work apps) or one planned goal block with device data";

export function focusDisruptions(ctx: Ctx, focus: FocusAnalysis): Detector<FocusDisruptions> {
  const { zone } = ctx;
  const withData = usageDays(ctx);
  if (withData.size === 0) return notEnough(FOCUS_MINIMUM, "no Mac or iPhone usage in this range");
  if (focus.stretches.length === 0 && focus.blocks.length === 0) {
    return notEnough(
      FOCUS_MINIMUM,
      `no focus stretch of at least ${RULES.minStretchMs / MINUTE} minutes and no planned goal block in ${dayCount(withData.size)} of usage`,
    );
  }

  const focusByDay = new Map<string, number>();
  for (const s of focus.focusSpans) {
    for (const p of zone.splitByDay(s.start, s.end)) add(focusByDay, p.day, p.end - p.start);
  }
  const longestByDay = new Map<string, number>();
  for (const r of focus.runs) {
    for (const p of zone.splitByDay(r.start, r.end)) {
      longestByDay.set(p.day, Math.max(longestByDay.get(p.day) ?? 0, p.end - p.start));
    }
  }
  const stretchesByDay = new Map<string, number>();
  for (const s of focus.stretches) add(stretchesByDay, zone.dayOf(s.start), 1);

  const daily = ctx.days
    .filter((d) => withData.has(d.day))
    .map((d) => {
      const ds = focus.disruptions.filter((x) => zone.dayOf(x.start) === d.day);
      return {
        day: d.day,
        complete: d.complete,
        focus_minutes: mins(focusByDay.get(d.day) ?? 0),
        stretches: stretchesByDay.get(d.day) ?? 0,
        disruptions: ds.length,
        ended_stretches: ds.filter((x) => x.ended).length,
        minutes_lost: mins(ds.reduce((t, x) => t + x.lostMs, 0)),
        longest_uninterrupted_minutes: mins(longestByDay.get(d.day) ?? 0),
      };
    });

  const counted = new Set(countedDays(ctx, withData));
  const countedRows = daily.filter((d) => counted.has(d.day));
  const totalLost = focus.disruptions.reduce((t, x) => t + x.lostMs, 0);
  const longest = Math.max(0, ...daily.map((d) => d.longest_uninterrupted_minutes));
  const hasInferred = focus.stretches.length > 0;
  const hasCalendar = focus.blocks.length > 0;

  const data: FocusDisruptions = {
    mode: hasInferred && hasCalendar ? "mixed" : hasCalendar ? "calendar" : "inferred",
    days_with_data: withData.size,
    blocks: focus.blocks.length,
    stretches: focus.stretches.length,
    focus_minutes: mins(unionLength(focus.focusSpans)),
    disruptions: focus.disruptions.length,
    disruptions_per_day: round1(
      ratio(
        countedRows.reduce((t, d) => t + d.disruptions, 0),
        countedRows.length,
      ),
    ),
    minutes_lost: mins(totalLost),
    minutes_lost_per_day: round1(
      ratio(
        countedRows.reduce((t, d) => t + d.minutes_lost, 0),
        countedRows.length,
      ),
    ),
    longest_uninterrupted_minutes: longest,
    median_daily_longest_uninterrupted_minutes: round1(
      median(countedRows.filter((d) => d.focus_minutes > 0).map((d) => d.longest_uninterrupted_minutes)),
    ),
    daily,
    items: focus.disruptions
      .slice(-100)
      .reverse()
      .map((d) => toDisruption(ctx, d)),
  };

  const where = hasCalendar && !hasInferred ? "planned blocks" : "focus";
  const summary = [
    `${rate(data.disruptions_per_day)} disruptions a day during ${where}, ${duration(data.minutes_lost_per_day)} a day in the apps that caused them.`,
    `Longest uninterrupted stretch: ${duration(data.median_daily_longest_uninterrupted_minutes)} on a typical day, ${duration(longest)} at best.`,
  ].join(" ");
  const evidence = focus.disruptions
    .slice(-RULES.evidenceCap)
    .reverse()
    .map((d) => d.trigger.eventId);
  return found(FOCUS_MINIMUM, summary, evidence, data);
}

// ---------- recovery cost ----------

const RECOVERY_MINIMUM =
  "at least 5 disruptions after which the user got back to the app they left; a day needs 3 for its own median";

export function recoveryCost(ctx: Ctx, focus: FocusAnalysis): Detector<RecoveryCost> {
  const { zone } = ctx;
  const inside = focus.disruptions.filter((d) => !d.ended && d.left);
  const measured = inside.filter((d) => d.backMs !== null);
  if (measured.length < RULES.minRecoverySample) {
    return notEnough(
      RECOVERY_MINIMUM,
      `needs at least ${RULES.minRecoverySample} disruptions with a return to the app that was left, found ${measured.length}`,
    );
  }
  const awaySpan = (d: RawDisruption): Span => {
    const start = d.left?.end ?? d.start;
    return { start, end: start + (d.backMs ?? 0) };
  };
  const medianLost = median(measured.map((d) => d.lostMs / MINUTE));
  const medianBack = median(measured.map((d) => (d.backMs ?? 0) / MINUTE));

  const byDay = new Map<string, RawDisruption[]>();
  for (const d of measured) {
    const day = zone.dayOf(d.start);
    const list = byDay.get(day);
    if (list) list.push(d);
    else byDay.set(day, [d]);
  }
  const daily = ctx.days
    .filter((d) => byDay.has(d.day))
    .map((d) => {
      const list = byDay.get(d.day) ?? [];
      return {
        day: d.day,
        measured: list.length,
        total_minutes_until_back: mins(unionLength(list.map(awaySpan))),
        median_minutes_until_back:
          list.length >= RULES.minDayRecoverySample
            ? round1(median(list.map((x) => (x.backMs ?? 0) / MINUTE)))
            : null,
      };
    });
  const counted = new Set(countedDays(ctx, usageDays(ctx)));
  const perDay = ratio(
    daily.filter((d) => counted.has(d.day)).reduce((t, d) => t + d.total_minutes_until_back, 0),
    counted.size,
  );

  const data: RecoveryCost = {
    measured: measured.length,
    not_returned: inside.length - measured.length,
    median_minutes_lost: round1(medianLost),
    median_minutes_until_back: round1(medianBack),
    multiplier: medianLost > 0 ? round1(medianBack / medianLost) : null,
    total_minutes_until_back: mins(unionLength(measured.map(awaySpan))),
    minutes_until_back_per_day: round1(perDay),
    daily,
  };
  const summary = [
    `A disruption of ${duration(data.median_minutes_lost)} costs ${duration(data.median_minutes_until_back)} before the app that was left is back in front (medians over ${count(measured.length, "disruption")}).`,
    `That adds up to ${duration(data.minutes_until_back_per_day)} a day.`,
  ].join(" ");
  const evidence = [...measured]
    .sort((a, b) => (b.backMs ?? 0) - (a.backMs ?? 0))
    .slice(0, RULES.evidenceCap)
    .map((d) => d.trigger.eventId);
  return found(RECOVERY_MINIMUM, summary, evidence, data);
}

// ---------- repeat offenders ----------

const OFFENDER_MINIMUM = "an app or site that caused disruptions on at least 2 different days";

export function repeatOffenders(ctx: Ctx, focus: FocusAnalysis): Detector<RepeatOffenders> {
  const { zone } = ctx;
  const groups = new Map<string, { subject: PatternSubject; list: RawDisruption[] }>();
  for (const d of focus.disruptions) {
    const subject = subjectOf(d.trigger);
    const group = groups.get(subjectId(subject));
    if (group) group.list.push(d);
    else groups.set(subjectId(subject), { subject, list: [d] });
  }
  const offenders = [...groups.values()]
    .map(({ subject, list }) => ({
      subject,
      devices: [...new Set(list.map((d) => d.trigger.device))].sort(),
      disruptions: list.length,
      minutes_lost: mins(list.reduce((t, d) => t + d.lostMs, 0)),
      days: new Set(list.map((d) => zone.dayOf(d.start))).size,
      ended_stretches: list.filter((d) => d.ended).length,
      evidence: list.map((d) => d.trigger.eventId),
    }))
    .filter((o) => o.days >= RULES.minOffenderDays)
    .sort((a, b) => b.disruptions - a.disruptions || b.minutes_lost - a.minutes_lost)
    .slice(0, 10);

  if (offenders.length === 0) {
    return notEnough(
      OFFENDER_MINIMUM,
      `no app or site disrupted focus on ${RULES.minOffenderDays} or more days (${count(focus.disruptions.length, "disruption")} found)`,
    );
  }
  const focusDays = daysTouched(ctx, focus.focusSpans).size;
  const data: RepeatOffenders = {
    days_with_focus: focusDays,
    offenders: offenders.map(({ evidence: _evidence, ...rest }) => rest),
  };
  const [top, second] = offenders;
  const parts: string[] = [];
  if (top) {
    parts.push(
      `${label(top.subject)} broke focus ${count(top.disruptions, "time")} on ${top.days} of ${dayCount(focusDays)} with focus, ${duration(top.minutes_lost)} in total.`,
    );
  }
  if (second) {
    parts.push(
      `Next: ${label(second.subject)}, ${count(second.disruptions, "time")} on ${dayCount(second.days)}.`,
    );
  }
  const evidence = offenders.flatMap((o) => o.evidence.slice(-5).reverse());
  return found(OFFENDER_MINIMUM, parts.join(" "), evidence, data);
}

// ---------- drift ----------

const DRIFT_MINIMUM = "browsing data (web visits) and at least one focus stretch or planned work block";

export function drift(ctx: Ctx, focus: FocusAnalysis): Detector<Drift> {
  const { zone, tl } = ctx;
  if (tl.counts.webVisits === 0) return notEnough(DRIFT_MINIMUM, "no browsing data in this range");
  if (focus.windows.length === 0) {
    return notEnough(DRIFT_MINIMUM, "no focus stretch or planned work block in this range");
  }

  // The search that came just before a visit. Only its event id leaves this function.
  const searchBefore = (t: number): string | null => {
    let found: string | null = null;
    for (const s of tl.searches) {
      if (s.at > t + 5000) break;
      if (s.at >= t - RULES.searchWindowMs) found = s.id;
    }
    return found;
  };

  interface Item {
    start: number;
    ms: number;
    seg: Segment;
    during: FocusWindow["during"];
  }
  const items = new Map<string, Item>();
  let w = 0;
  for (const seg of tl.attention) {
    if (seg.kind !== "site" || !DRIFT.has(seg.category)) continue;
    while (w < focus.windows.length && (focus.windows[w]?.end ?? 0) <= seg.start) w++;
    for (let k = w; k < focus.windows.length; k++) {
      const window = focus.windows[k];
      if (!window || window.start >= seg.end) break;
      const ms = Math.min(seg.end, window.end) - Math.max(seg.start, window.start);
      if (ms <= 0) continue;
      // One visit can be cut in pieces by a phone pick up. Pieces of one event are one item.
      const item = items.get(seg.eventId);
      if (item) item.ms += ms;
      else
        items.set(seg.eventId, { start: Math.max(seg.start, window.start), ms, seg, during: window.during });
    }
  }

  const list = [...items.values()];
  const byCategory = new Map<AppCategory, { ms: number; visits: number; days: Set<string> }>();
  const byDay = new Map<string, number>();
  for (const item of list) {
    const day = zone.dayOf(item.start);
    add(byDay, day, item.ms);
    const entry = byCategory.get(item.seg.category) ?? { ms: 0, visits: 0, days: new Set<string>() };
    entry.ms += item.ms;
    entry.visits++;
    entry.days.add(day);
    byCategory.set(item.seg.category, entry);
  }
  const totalMs = list.reduce((t, i) => t + i.ms, 0);
  const categories = [...byCategory.entries()]
    .map(([category, v]) => ({ category, minutes: mins(v.ms), visits: v.visits, days: v.days.size }))
    .sort((a, b) => b.minutes - a.minutes);
  const top = [...list].sort((a, b) => b.ms - a.ms).slice(0, 50);

  const data: Drift = {
    minutes: mins(totalMs),
    by_category: categories,
    daily: ctx.days
      .filter((d) => byDay.has(d.day))
      .map((d) => ({ day: d.day, minutes: mins(byDay.get(d.day) ?? 0) })),
    items: top.map((i) => ({
      day: zone.dayOf(i.start),
      start_at: iso(i.start),
      site: subjectOf(i.seg),
      minutes: mins(i.ms),
      during: i.during,
      search_event_id: searchBefore(i.seg.start),
      event_id: i.seg.eventId,
    })),
  };

  const focusDays = dayCount(daysTouched(ctx, focus.windows).size);
  const summary =
    totalMs === 0
      ? `No travel, shopping, video, social or news browsing during focus on ${focusDays} with focus.`
      : `${duration(data.minutes)} of off task browsing during focus on ${focusDays} with focus: ${categories
          .slice(0, 3)
          .map((c) => `${c.category} ${duration(c.minutes)}`)
          .join(", ")}.`;
  // Proof: the visits, and the searches that started them (ids only).
  const evidence = top.flatMap((i) => {
    const search = searchBefore(i.seg.start);
    return search ? [i.seg.eventId, search] : [i.seg.eventId];
  });
  return found(DRIFT_MINIMUM, summary, evidence, data);
}
