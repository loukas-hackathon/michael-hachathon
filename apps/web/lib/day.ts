import type { Balance, RecordMark, Recovery } from "./gamification";

export type { Recovery };

// The day as the interface sees it: planned goal blocks, what happened inside them, and Michael's lead.
// Built from the timeline and the user's plan. Until the analysis endpoints are live (score, nudges,
// patterns), lib/api.ts serves a sample day in this shape; the shape is local to apps/web on purpose.

export type Interruption = {
  /** ISO start of the interruption. */
  at: string;
  minutes: number;
  /** What pulled the user away, as the user would name it ("WhatsApp"). */
  what: string;
};

export type GoalBlock = {
  id: string;
  goalId: string | null;
  title: string;
  /** Planned start and end (ISO). */
  start: string;
  end: string;
  interruptions: Interruption[];
  /** Set when Michael moved the end of this block; the dashed pink extension on the timeline. */
  movedEnd?: string;
};

export type Evidence =
  | { kind: "cadence"; from: string; to: string; sessions: string[]; gapMinutes: number }
  /** Phone sessions per hour of the day (24 values), with the working window to highlight. */
  | { kind: "hours"; perHour: number[]; window: [number, number] }
  | { kind: "none" };

export type Lead = {
  /** After a missed block: the 25 minute block that still counts, offered with Take it and Undo. */
  recovery?: Recovery;
  at: string;
  /** Sentence parts; `strong` parts are the numbers and facts, set in the label colour. */
  insight: { text: string; strong?: boolean }[];
  evidence: Evidence;
  fix: { text: string; strong?: boolean }[];
  /** The undo for the fix. `recommendationId` makes it real (POST /v1/recommendations/:id/undo). */
  action: { label: string; done: string; recommendationId?: string } | null;
};

export type Nudge = { at: string; channel: "watch" | "push" | "telegram"; text: string };

export type Moment = "morning" | "today" | "evening";

export type DayView = {
  date: string;
  now: string;
  moment: Moment;
  /** True for sample data. The screen says so. */
  sample: boolean;
  /** The week line: the score so far this week, and the analysis' one sentence once it exists. */
  week: { scorePct: number | null; line: string | null };
  /** From GET /v1/score: the tape and totals as the API worked them out. Sample days compute them. */
  scored?: { ticks: Tick[][]; totals: Totals };
  blocks: GoalBlock[];
  wonBackMinutes: number;
  /** A personal best on today's tape (#166). */
  record?: RecordMark | null;
  balance?: Balance | null;
  lead: Lead | null;
  nudge: Nudge | null;
};

/** Unverified: inside a planned block and not lost, but no data proves it (yet). Drawn pale pink. */
export type Tick = "spent" | "unverified" | "lost" | "ahead";

export type Totals = {
  planned: number;
  spent: number;
  unverified: number;
  lost: number;
  ahead: number;
  scorePct: number | null;
};
export const TICK_MINUTES = 5;

const ms = (iso: string) => new Date(iso).getTime();
const MIN = 60_000;

/** Lost minutes inside [a, b), from the block's interruptions. */
function lostWithin(block: GoalBlock, a: number, b: number) {
  let lost = 0;
  for (const i of block.interruptions) {
    const s = ms(i.at);
    const e = s + i.minutes * MIN;
    lost += Math.max(0, Math.min(b, e) - Math.max(a, s));
  }
  return lost / MIN;
}

/** The tape: one tick per 5 minutes of planned goal time, grouped by block. */
export function tape(day: DayView): Tick[][] {
  if (day.scored) return day.scored.ticks;
  const now = ms(day.now);
  return day.blocks.map((block) => {
    const start = ms(block.start);
    const n = Math.round((ms(block.end) - start) / (TICK_MINUTES * MIN));
    return Array.from({ length: n }, (_, i): Tick => {
      const a = start + i * TICK_MINUTES * MIN;
      const b = a + TICK_MINUTES * MIN;
      if (a >= now) return "ahead";
      return lostWithin(block, a, b) >= TICK_MINUTES / 2 ? "lost" : "spent";
    });
  });
}

/** Minutes spent, lost and still ahead, from the plan and the interruptions (not from the ticks). */
export function totals(day: DayView): Totals {
  if (day.scored) return day.scored.totals;
  const now = ms(day.now);
  let planned = 0;
  let elapsed = 0;
  let lost = 0;
  for (const b of day.blocks) {
    const s = ms(b.start);
    const e = ms(b.end);
    planned += (e - s) / MIN;
    const past = Math.max(0, Math.min(e, now) - s) / MIN;
    elapsed += past;
    lost += lostWithin(b, s, Math.min(e, now));
  }
  const spent = elapsed - lost;
  const ahead = planned - elapsed;
  const scorePct = elapsed > 0 ? Math.round((spent / elapsed) * 100) : null;
  return { planned, spent, unverified: 0, lost, ahead, scorePct };
}

/** Index of the first tick that is still ahead, across all blocks (for the "now" marker). */
export function nowIndex(ticks: Tick[][]) {
  let i = 0;
  for (const block of ticks) {
    for (const t of block) {
      if (t === "ahead") return i;
      i++;
    }
  }
  return null;
}
