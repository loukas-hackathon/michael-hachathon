import { type MomentStretch, voiceDuration } from "@michael/shared";

// The stake of the block most at risk (#330). When the API sends what the same block lost the last
// time it ran (`last_time`), the card quotes that in place of the average, in the API's own words
// (lastTimeLine in apps/api/src/moments/compute.ts): "Yesterday this block lost 24 minutes to
// Instagram." Kept apart from lib/moments.ts, which is server only, so it can be tested.

const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type LastTime = {
  /** "Yesterday" or "On Thursday". */
  when: string;
  /** "24 minutes", from two hours "2h 15". */
  lost: string;
  trigger: string | null;
};

/** The last time the block at risk ran, in parts; null when the API sent none. `today` is YYYY-MM-DD. */
export function lastTime(risk: MomentStretch, today: string): LastTime | null {
  const last = risk.last_time;
  if (!last) return null;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  const when =
    last.day === yesterday ? "Yesterday" : `On ${WEEKDAYS[new Date(`${last.day}T00:00:00Z`).getUTCDay()]}`;
  return { when, lost: voiceDuration(last.lost_minutes), trigger: last.trigger };
}

/** The same as one sentence, as the API writes it under the move for that block. */
export function lastTimeSentence(risk: MomentStretch, today: string): string | null {
  const last = lastTime(risk, today);
  if (!last) return null;
  return `${last.when} this block lost ${last.lost}${last.trigger ? ` to ${last.trigger}` : ""}.`;
}
