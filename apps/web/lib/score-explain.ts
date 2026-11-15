import type { Score } from "@michael/shared";

// "How I count": the week's score as its own maths, for the sheet behind the headline number
// (#206). Built from GET /v1/score only; the rule itself is in docs/api.md, "The attribution rule".

/** Days with goal blocks Michael needs before the usual week (and time won back) means anything. */
export const LEARNING_DAYS = 3;

export type ScoreExplain = {
  sample: boolean;
  /** The week: spent / elapsed, rounded. Null before anything has elapsed. */
  scorePct: number | null;
  planned: number;
  elapsed: number;
  spent: number;
  /** The part of spent no data confirms yet. */
  unverified: number;
  lost: number;
  ahead: number;
  /**
   * Minutes logged outside every goal block this week (#372): they count toward the goals' weekly
   * time, never toward this score, so the sheet shows them on a line of their own.
   */
  logged: number;
  /** What took the lost time, most first (at most two). */
  causes: { what: string; minutes: number }[];
  wonBack: number;
  /** Lost / elapsed on the usual day, 0..1; null while learning. */
  usualLossRate: number | null;
  /** Days with goal blocks among the previous 28, capped at LEARNING_DAYS. */
  daysLearnt: number;
  /** Too little to count yet: fewer than three days of goal blocks, or nothing planned this week. */
  learning: boolean;
};

export function explainFromScore(score: Score): ScoreExplain {
  const history = score.day.time_won_back.history_days;
  return {
    sample: false,
    scorePct: score.score_pct,
    planned: score.planned_minutes,
    elapsed: score.elapsed_minutes,
    spent: score.spent_minutes,
    unverified: score.unverified_minutes,
    lost: score.lost_minutes,
    ahead: score.ahead_minutes,
    logged: score.logged_minutes ?? 0,
    causes: (score.lost_by ?? []).slice(0, 2).map((c) => ({ what: c.what, minutes: c.minutes })),
    wonBack: score.time_won_back_minutes,
    usualLossRate: score.day.time_won_back.usual_loss_rate,
    daysLearnt: Math.min(LEARNING_DAYS, history),
    learning: history < LEARNING_DAYS || score.planned_minutes === 0,
  };
}

const WORDS = ["No", "One", "Two", "Three"];

/** The one line that says what Michael still needs, in his voice. */
export function learningLine(e: ScoreExplain): string {
  if (e.planned === 0 && e.daysLearnt === 0) {
    return "Put one goal block in your calendar and I start counting.";
  }
  const left = Math.max(1, LEARNING_DAYS - e.daysLearnt);
  const n = WORDS[left] ?? String(left);
  return left === 1
    ? "One more day and I can tell you where your time goes."
    : `${n} more days and I can tell you where your time goes.`;
}

/** The one thing that would make the number truer, or null when it is as true as it gets. */
export function truerLine(e: ScoreExplain): string | null {
  if (e.planned === 0) return "Connect your calendar so I know what you planned.";
  if (e.spent > 0 && e.unverified / e.spent >= 0.25) {
    return "Wear the watch and keep the Mac app on, so I can confirm the pale pink.";
  }
  return null;
}

// ---------- sample weeks (marked sample on screen) ----------

/** The sample Wednesday's week: the same made up week as `mockScore` (64% for the week). */
export const sampleExplain = (score: Score): ScoreExplain => ({ ...explainFromScore(score), sample: true });

/** A brand new account: nothing planned, nothing learnt. */
export const sampleExplainNew: ScoreExplain = {
  sample: true,
  scorePct: null,
  planned: 0,
  elapsed: 0,
  spent: 0,
  unverified: 0,
  lost: 0,
  ahead: 0,
  logged: 0,
  causes: [],
  wonBack: 0,
  usualLossRate: null,
  daysLearnt: 0,
  learning: true,
};

/** Day two: real minutes, one day learnt, no usual day yet. 580 = 530 + 50; 530 = 431 + 99. */
export const sampleExplainLearning: ScoreExplain = {
  sample: true,
  scorePct: 81,
  planned: 580,
  elapsed: 530,
  spent: 431,
  unverified: 60,
  lost: 99,
  ahead: 50,
  logged: 0,
  causes: [
    { what: "WhatsApp", minutes: 52 },
    { what: "Instagram", minutes: 31 },
  ],
  wonBack: 0,
  usualLossRate: null,
  daysLearnt: 1,
  learning: true,
};
