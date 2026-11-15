import type { RitualKind, RitualToday } from "@michael/shared";

// The daily ritual on Today (#318): when the card shows. The morning while it is due; the evening
// while it is due, and its line once logged. Otherwise the outcomes sit in Today's list.

export function ritualShows(r: RitualToday | null): r is RitualToday {
  if (!r) return false;
  if (r.phase === "morning") return r.morning === "due";
  if (r.phase === "evening") return r.evening === "due" || (r.evening === "done" && Boolean(r.summary));
  return false;
}

/** `?ritual=morning|evening` shows that half now: a preview, the stage, and the end to end test. */
export const ritualPreview = (v: string | undefined): RitualKind | undefined =>
  v === "morning" || v === "evening" ? v : undefined;
