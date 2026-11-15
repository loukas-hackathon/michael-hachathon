import type { CheckIn } from "@michael/shared";

// The check in's answers (#187) as the count goals read them (#238). A question answered "yes"
// that names a goal or a calendar block ("Gym, 18:00 to 19:00. No workout recorded. Did you
// train?") is a session of that goal: the count rule in score/count.ts links it to a count goal by
// `goal_id`, or by `event_id` when the block is one of the goal's own blocks (the question may
// name the time goal that also lists the block). This is the one place that reads the shape.

export interface CountCheckIn {
  goal_id: string | null;
  event_id: string | null;
  /** The span the question is about (the block), or the instant of the answer when it has none. */
  start: number;
  end: number;
  /** True when the question had no span: then it stands for the day's session. */
  untimed: boolean;
}

/** The answers "yes" linked to a goal or a block, oldest first. Anything else is skipped. */
export function countCheckInsFrom(rows: CheckIn[]): CountCheckIn[] {
  const out: CountCheckIn[] = [];
  for (const c of rows) {
    if (c.answer !== "yes" || (!c.goal_id && !c.event_id)) continue;
    const start = c.start_at ? Date.parse(c.start_at) : Number.NaN;
    const end = c.end_at ? Date.parse(c.end_at) : Number.NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      out.push({ goal_id: c.goal_id, event_id: c.event_id, start, end, untimed: false });
      continue;
    }
    const at = Date.parse(c.answered_at ?? c.asked_at);
    if (Number.isFinite(at))
      out.push({ goal_id: c.goal_id, event_id: c.event_id, start: at, end: at, untimed: true });
  }
  return out.sort((a, b) => a.start - b.start);
}
