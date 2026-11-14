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
  | { kind: "none" };

export type Lead = {
  at: string;
  /** Sentence parts; `strong` parts are the numbers and facts, set in the label colour. */
  insight: { text: string; strong?: boolean }[];
  evidence: Evidence;
  fix: { text: string; strong?: boolean }[];
  action: { label: string; done: string } | null;
};

export type Nudge = { at: string; channel: "watch" | "push" | "telegram"; text: string };

export type Moment = "morning" | "today" | "evening";

export type DayView = {
  date: string;
  now: string;
  moment: Moment;
  /** True for sample data. The screen says so. */
  sample: boolean;
  week: { scorePct: number; line: string };
  blocks: GoalBlock[];
  wonBackMinutes: number;
  lead: Lead | null;
  nudge: Nudge | null;
};

export type Tick = "spent" | "lost" | "ahead";
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
export function totals(day: DayView) {
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
  return { planned, spent, lost, ahead, scorePct };
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
