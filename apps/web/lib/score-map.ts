import type { Score, ScoreBlock, TargetResponse } from "@michael/shared";
import { categoryOf } from "./categories";
import { type DayView, type GoalBlock, type Lead, type Tick, titleMomentAt } from "./day";
import type { Balance, RecordMark, WeeklyTarget } from "./gamification";
import type { GoalsView } from "./goals-view";
import { explainFromScore } from "./score-explain";

// Maps GET /v1/score (and the week's patterns) onto the views Today and Goals draw.

function block(b: ScoreBlock): GoalBlock {
  return {
    id: b.event_id,
    goalId: b.goal_id,
    title: b.goal_title,
    start: b.start_at,
    end: b.end_at,
    interruptions: b.lost.map((l) => ({ at: l.start_at, minutes: l.minutes, what: l.what })),
  };
}

export function dayFromScore(score: Score, lead: Lead | null): DayView {
  const d = score.day;
  const blocks = [...d.blocks].sort((a, b) => a.start_at.localeCompare(b.start_at));
  return {
    date: d.date,
    now: d.now,
    moment: titleMomentAt(d.now, score.timezone),
    sample: false,
    week: { scorePct: score.score_pct, line: null },
    scored: {
      ticks: blocks.map((b) => b.ticks as Tick[]),
      totals: {
        planned: d.planned_minutes,
        spent: d.spent_minutes,
        unverified: d.unverified_minutes,
        lost: d.lost_minutes,
        ahead: d.ahead_minutes,
        scorePct: d.score_pct,
      },
    },
    blocks: blocks.map(block),
    wonBackMinutes: d.time_won_back_minutes,
    record: recordOnTape(score, blocks),
    balance: balanceFrom(score),
    explain: explainFromScore(score),
    lead,
    nudge: null,
  };
}

/** A new best set today, as a mark on the day's tape (#166). Baselines (no line) never show. */
function recordOnTape(score: Score, blocks: ScoreBlock[]): RecordMark | null {
  let offset = 0;
  for (const b of blocks) {
    const r = b.record_id ? score.records.find((x) => x.id === b.record_id) : undefined;
    if (r?.line && r.tick_index != null) return { tick: offset + r.tick_index, line: r.line };
    offset += b.ticks.length;
  }
  return null;
}

/** The balanced week (#165): each area with time goals against its floor. */
function balanceFrom(score: Score): Balance | null {
  const rows = score.areas ?? [];
  if (!rows.some((a) => a.meets_floor !== null)) return null;
  const pick = (area: "business" | "health" | "personal") => rows.find((a) => a.area === area);
  const val = (area: "business" | "health" | "personal") => {
    const a = pick(area);
    return a && a.meets_floor !== null ? (a.score_pct ?? 0) : null;
  };
  const floor = (area: "business" | "health" | "personal") => pick(area)?.floor_pct ?? 50;
  return {
    overall: score.score_pct,
    target: score.target?.overall_pct ?? null,
    areas: { business: val("business"), health: val("health"), personal: val("personal") },
    floors: { business: floor("business"), health: floor("health"), personal: floor("personal") },
  };
}

function targetFrom(res: TargetResponse | null): {
  target: WeeklyTarget | null;
  baseline: GoalsView["baseline"];
} {
  if (!res) return { target: null, baseline: null };
  const t = res.target;
  return {
    target: t
      ? {
          status: t.status === "proposed" ? "proposed" : t.set_by === "user" ? "edited" : "accepted",
          weekStart: t.week_start,
          median: t.basis.median_pct ?? t.overall_pct,
          overall: t.overall_pct,
          areas: t.areas,
          floors: t.floors,
          setBy: t.set_by,
          reason: t.reason,
        }
      : null,
    baseline: res.baseline.ready
      ? null
      : { weeksDone: res.baseline.full_weeks, weeksNeeded: res.baseline.needed, reason: res.baseline.reason },
  };
}

export function goalsFromScore(score: Score, targets: TargetResponse | null = null): GoalsView {
  const today = score.day.date;
  const { target, baseline } = targetFrom(targets);
  const record = score.records.find((r) => r.line && r.type !== "longest_block");
  return {
    sample: false,
    weekStart: score.week_start,
    now: score.day.now,
    freeMinutesLeft: score.free_minutes_left ?? null,
    goals: score.goals
      .filter((g) => g.scored && g.budget_minutes > 0)
      .map((g) => ({
        id: g.goal_id,
        title: g.title,
        category: categoryOf(g.category),
        budgetMinutes: g.budget_minutes,
        spentMinutes: g.spent_minutes,
        unverifiedMinutes: g.unverified_minutes,
        plannedMinutes: g.planned_minutes,
        openBlocks: g.open_blocks,
        leftMinutes: g.minutes_left,
        daily: g.daily.map((x) => (x.date > today ? null : x.spent_minutes)),
      })),
    sleep: score.sleep ? { goalMinutes: score.sleep.goal_minutes, nightly: score.sleep.nightly } : null,
    target,
    baseline,
    balance: balanceFrom(score),
    recordLine: record?.line ?? null,
    explain: explainFromScore(score),
  };
}

type PhoneCadenceData = {
  window: { start_hour: number; end_hour: number; average_interval_minutes: number | null };
  by_hour: { hour: number; sessions_per_day: number }[];
};

/** A lead built only from what the data shows, while the analysis (#17) is not live. */
export function leadFromPatterns(
  patterns: { phone_cadence?: { status: string; data: unknown } },
  now: string,
): Lead | null {
  const pc = patterns.phone_cadence;
  if (pc?.status !== "ok" || !pc.data) return null;
  const data = pc.data as PhoneCadenceData;
  const every = data.window.average_interval_minutes;
  if (!every) return null;
  const perHour = Array.from(
    { length: 24 },
    (_, h) => data.by_hour.find((x) => x.hour === h)?.sessions_per_day ?? 0,
  );
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return {
    at: now,
    insight: [
      { text: "This week your phone opened " },
      { text: `every ${Math.round(every)} minutes`, strong: true },
      { text: ` between ${pad(data.window.start_hour)} and ${pad(data.window.end_hour)}.` },
    ],
    evidence: { kind: "hours", perHour, window: [data.window.start_hour, data.window.end_hour] },
    fix: [],
    action: null,
  };
}
