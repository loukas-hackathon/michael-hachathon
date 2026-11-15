import type { AnalysisRun } from "@michael/shared";
import { formatWhen } from "@/lib/format";

// No brief yet (or the last one failed): say so and what one tap does, not what a brief is.
export const NO_BRIEF = "None yet. One tap and I read your day.";

/**
 * The quiet "Michael's brief" row on Today: its preview is the summary's first line, and its time
 * says the day when the brief is not from today ("Yesterday", not a bare 14:30 at 06:00).
 */
export function briefRow(run: AnalysisRun | null, now: Date = new Date()) {
  const firstLine = run?.summary?.split("\n").find((l) => l.trim()) ?? null;
  return {
    preview: firstLine ?? NO_BRIEF,
    when: run?.finished_at ? formatWhen(run.finished_at, now) : null,
  };
}
