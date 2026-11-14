import {
  type AreaNumbers,
  type AreaTargets,
  DEFAULT_FLOOR_PCT,
  type GoalArea,
  type Score,
  type ScoreArea,
  type ScoreTarget,
  type ScoreWeekArea,
  TARGET_BASELINE_WEEKS,
  type TargetBaseline,
  voiceDuration,
  type WeeklyTarget,
} from "@michael/shared";
import { median } from "../patterns/util";

// Next week's target with the maths, the category floors and the balanced week (#165). Pure:
// the weeks before go in, a proposal comes out. No I/O and no clock.
//
// THE TARGET RULE (also in docs/api.md, "Targets"; change both together)
//
//   History     The full weeks before the target week, at most the last 4. A week is full when
//               it has ended and has a score. No proposal until 2 exist; the baseline says so.
//   Median      The median of their scores (overall, and per category over the weeks that had
//               time in that category), rounded.
//   On target   A past week met its stored target (overall, and every category with time goals
//               at or above its floor). A week with no stored target is judged against the
//               median: at or above your usual counts.
//   Step        Of the last 4 full weeks on target: 3 or 4 step up (5 points, or 3 from a median
//               of 70), 2 hold, 1 or none step down 3. The last two full weeks both missed step
//               down 3 whatever the count; with stored targets the reason starts "My target was
//               too high."
//   Heavy week  The week's fixed calendar commitments are at least 20% and 3 hours over the
//               median of the full weeks: 3 more points off, said in the reason.
//   Categories  The same rule on each category's own scores. A category with time goals but
//               fewer than 2 full weeks of its own takes the overall proposal; one without time
//               goals has no target (null).
//   Floors      Each category's floor carries over from the latest stored target, else 50.
//   Balanced    `on_target` is true only when the overall score meets the target AND every
//               category with time goals meets its floor. A category with time goals and nothing
//               elapsed in it does not meet its floor: no personal time is not a balanced week.

export const TARGET_RULES = {
  historyWeeks: 4,
  stepUp: 5,
  stepUpHigh: 3,
  highFrom: 70,
  stepDown: 3,
  heavyDown: 3,
  heavyRatio: 1.2,
  heavyMinMinutes: 180,
} as const;

export const AREAS: GoalArea[] = ["business", "health", "personal"];
const AREA_NAME: Record<GoalArea, string> = { business: "Business", health: "Health", personal: "Personal" };
export const areaName = (a: GoalArea) => AREA_NAME[a];

export const DEFAULT_FLOORS: AreaNumbers = {
  business: DEFAULT_FLOOR_PCT,
  health: DEFAULT_FLOOR_PCT,
  personal: DEFAULT_FLOOR_PCT,
};

/** One week of history as the target rule reads it. */
export interface TargetWeek {
  /** Monday, local day. */
  week_start: string;
  /** Ended before the target is worked out. */
  complete: boolean;
  score_pct: number | null;
  areas: Record<GoalArea, number | null>;
  /** Fixed calendar commitments inside the waking days (score/week.ts). */
  committed_minutes: number;
  /** The target stored for that week, if one was. */
  target: Pick<WeeklyTarget, "overall_pct" | "areas" | "floors"> | null;
}

export interface ProposalInput {
  /** The Monday the target is for. */
  week_start: string;
  /** Weeks before it, any order; only full ones count. */
  history: TargetWeek[];
  /** Categories that have time goals now. */
  timeAreas: ReadonlySet<GoalArea>;
  /** The target week's own fixed commitments so far on the calendar. */
  committed_minutes: number;
}

export type Proposal = Omit<WeeklyTarget, "created_at" | "updated_at">;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** The full weeks the rule reads: ended, scored, the last 4 before the week, oldest first. */
export function fullWeeks(history: TargetWeek[], weekStart: string): TargetWeek[] {
  return history
    .filter((w) => w.complete && w.score_pct !== null && w.week_start < weekStart)
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1))
    .slice(-TARGET_RULES.historyWeeks);
}

const count = (n: number) => (n === 0 ? "none yet" : n === 1 ? "one" : String(n));

export function baselineOf(full: number): TargetBaseline {
  const ready = full >= TARGET_BASELINE_WEEKS;
  return {
    ready,
    full_weeks: full,
    needed: TARGET_BASELINE_WEEKS,
    reason: ready ? null : `I need two full weeks of scores before I set a target. I have ${count(full)}.`,
  };
}

/** Whether a past week was on target: overall, and every category with time goals at its floor. */
export function metTarget(
  w: TargetWeek,
  t: { overall_pct: number; floors: AreaNumbers },
  timeAreas: ReadonlySet<GoalArea>,
): boolean {
  if (w.score_pct === null || w.score_pct < t.overall_pct) return false;
  for (const a of timeAreas) {
    const pct = w.areas[a];
    if (pct === null || pct < t.floors[a]) return false;
  }
  return true;
}

type Step = "up" | "hold" | "down";

interface Stepped {
  median: number;
  step: Step;
  delta: number;
  hits: number;
  used: number;
  twoMisses: boolean;
}

/** The step from a list of scores and whether each week was on target, oldest first. */
function stepFrom(scores: number[], hits: boolean[]): Stepped {
  const mid = Math.round(median(scores));
  const n = hits.filter(Boolean).length;
  const twoMisses = hits.length >= 2 && !hits[hits.length - 1] && !hits[hits.length - 2];
  let step: Step = n >= 3 ? "up" : n === 2 ? "hold" : "down";
  if (twoMisses) step = "down";
  const delta =
    step === "up"
      ? mid >= TARGET_RULES.highFrom
        ? TARGET_RULES.stepUpHigh
        : TARGET_RULES.stepUp
      : step === "down"
        ? -TARGET_RULES.stepDown
        : 0;
  return { median: mid, step, delta, hits: n, used: hits.length, twoMisses };
}

/**
 * Michael's proposal for the week, with the maths in one line, or null while the baseline is
 * being built (fewer than 2 full weeks before it).
 */
export function proposeTarget(input: ProposalInput): { proposal: Proposal | null; baseline: TargetBaseline } {
  const full = fullWeeks(input.history, input.week_start);
  const baseline = baselineOf(full.length);
  if (!baseline.ready) return { proposal: null, baseline };

  // Floors carry over from the latest stored target.
  const lastStored = [...full].reverse().find((w) => w.target)?.target;
  const floors = lastStored?.floors ?? DEFAULT_FLOORS;

  const scores = full.map((w) => w.score_pct as number);
  const usual = Math.round(median(scores));
  const hits = full.map((w) => metTarget(w, w.target ?? { overall_pct: usual, floors }, input.timeAreas));
  const overall = stepFrom(scores, hits);

  // A heavy week: fixed commitments well over the usual week.
  const usualCommitted = Math.round(median(full.map((w) => w.committed_minutes)));
  const extra = input.committed_minutes - usualCommitted;
  const heavy =
    input.committed_minutes >= usualCommitted * TARGET_RULES.heavyRatio &&
    extra >= TARGET_RULES.heavyMinMinutes;
  const heavyOff = heavy ? TARGET_RULES.heavyDown : 0;
  const overallPct = clamp(overall.median + overall.delta - heavyOff);

  const areas: AreaTargets = { business: null, health: null, personal: null };
  for (const a of AREAS) {
    if (!input.timeAreas.has(a)) continue;
    const own = full.filter((w) => w.areas[a] !== null);
    if (own.length < TARGET_BASELINE_WEEKS) {
      areas[a] = overallPct;
      continue;
    }
    const areaScores = own.map((w) => w.areas[a] as number);
    const areaUsual = Math.round(median(areaScores));
    const areaHits = own.map((w) => (w.areas[a] as number) >= (w.target?.areas[a] ?? areaUsual));
    const s = stepFrom(areaScores, areaHits);
    areas[a] = clamp(s.median + s.delta - heavyOff);
  }

  // The last two weeks both had a target from Michael or the user, and both were missed.
  const lastTwo = full.slice(-2);
  const tooHigh = overall.twoMisses && lastTwo.every((w) => w.target);
  const parts: string[] = [];
  if (tooHigh) parts.push("My target was too high.");
  parts.push(`Usual week ${overall.median}%.`);
  if (overall.twoMisses) {
    parts.push(
      tooHigh
        ? `Two weeks missed in a row, so down ${TARGET_RULES.stepDown}.`
        : `Two weeks under your usual in a row, so down ${TARGET_RULES.stepDown}.`,
    );
  } else {
    const hit = `You hit ${overall.hits} of the last ${overall.used}`;
    parts.push(
      overall.step === "up"
        ? `${hit}, so up ${overall.delta}.`
        : overall.step === "hold"
          ? `${hit}, so we hold.`
          : `${hit}, so down ${-overall.delta}.`,
    );
  }
  if (heavy) {
    parts.push(
      `Your week already holds ${voiceDuration(input.committed_minutes)} of fixed time, ${voiceDuration(extra)} over usual, so down ${heavyOff} more.`,
    );
  }
  parts.push(`Target ${overallPct}%.`);

  return {
    baseline,
    proposal: {
      week_start: input.week_start,
      overall_pct: overallPct,
      areas,
      floors: { ...floors },
      status: "proposed",
      set_by: "michael",
      reason: parts.join(" "),
      basis: {
        weeks_used: full.length,
        median_pct: overall.median,
        step: overall.step,
        on_target_weeks: overall.hits,
        heavy_week: heavy,
      },
    },
  };
}

/** Categories that have goals of kind `time` in the score. */
export const timeAreasOf = (score: Pick<Score, "goals">): Set<GoalArea> =>
  new Set(score.goals.filter((g) => g.scored).map((g) => g.area));

/**
 * The week's areas with their target and floor, and the verdict. Without a target the floors
 * still apply (default 50) and `on_target` is null.
 */
export function balance(
  areas: ScoreArea[],
  weekScorePct: number | null,
  timeAreas: ReadonlySet<GoalArea>,
  target: ScoreTarget | null,
): { areas: ScoreWeekArea[]; on_target: boolean | null } {
  const floors = target?.floors ?? DEFAULT_FLOORS;
  const anyElapsed = weekScorePct !== null;
  const rows: ScoreWeekArea[] = areas.map((a) => {
    const hasTime = timeAreas.has(a.area);
    return {
      ...a,
      target_pct: hasTime ? (target?.areas[a.area] ?? null) : null,
      floor_pct: floors[a.area],
      meets_floor: !hasTime || !anyElapsed ? null : (a.score_pct ?? 0) >= floors[a.area],
    };
  });
  if (!target || weekScorePct === null) return { areas: rows, on_target: null };
  const floorsMet = rows.every((r) => r.meets_floor !== false);
  return { areas: rows, on_target: weekScorePct >= target.overall_pct && floorsMet };
}

/** The score with its target, the floors and the verdict filled in. */
export function withTarget(score: Score, target: ScoreTarget | null): Score {
  const { areas, on_target } = balance(score.areas, score.score_pct, timeAreasOf(score), target);
  return { ...score, target, on_target, areas };
}

/** The part of a target the score carries. */
export const scoreTarget = (t: Pick<WeeklyTarget, keyof ScoreTarget>): ScoreTarget => ({
  overall_pct: t.overall_pct,
  areas: { ...t.areas },
  floors: { ...t.floors },
  status: t.status,
  set_by: t.set_by,
});
