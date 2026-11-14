import type { Score, ScoreBlock } from "@michael/shared";
import { categoryOf } from "./categories";
import type { DayView, GoalBlock, Lead, Moment, Tick } from "./day";
import type { GoalsView } from "./goals-view";

// Maps GET /v1/score (and the week's patterns) onto the views Today and Goals draw.

const hourIn = (iso: string, tz: string) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(
      new Date(iso),
    ),
  );

function momentAt(iso: string, tz: string): Moment {
  const h = hourIn(iso, tz);
  if (h < 11) return "morning";
  if (h >= 20) return "evening";
  return "today";
}

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
    moment: momentAt(d.now, score.timezone),
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
    lead,
    nudge: null,
  };
}

export function goalsFromScore(score: Score): GoalsView {
  const today = score.day.date;
  const sleep = score.goals.find((g) => !g.scored && /sleep/i.test(g.title));
  return {
    sample: false,
    weekStart: score.week_start,
    now: score.day.now,
    freeMinutesLeft: null,
    goals: score.goals
      .filter((g) => g.scored && g.budget_minutes > 0)
      .map((g) => ({
        id: g.goal_id,
        title: g.title,
        category: categoryOf(g.category),
        budgetMinutes: g.budget_minutes,
        spentMinutes: g.spent_minutes,
        unverifiedMinutes: g.unverified_minutes,
        daily: g.daily.map((x) => (x.date > today ? null : x.spent_minutes)),
      })),
    sleep: sleep ? { goalMinutes: Math.round(sleep.budget_minutes / 7), nightly: Array(7).fill(null) } : null,
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
