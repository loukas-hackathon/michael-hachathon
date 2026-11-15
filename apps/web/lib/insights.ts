// What Michael has learnt about you (#432): patterns across sources, each with its evidence and
// one fix. GET /v1/insights (InsightsResponse in @michael/shared), and helpers for the screens.

import type { Insight, InsightSeries, InsightsResponse } from "@michael/shared";

export type { Insight, InsightFix, InsightStep } from "@michael/shared";
export type Insights = InsightsResponse;
export type Series = InsightSeries;

/** Nights studied before patterns can show, until the API says its own figure. */
export const DEFAULT_NEEDED_DAYS = 14;

const SOURCE_NAME: Record<string, string> = {
  "apple-watch": "Watch",
  claude: "Claude",
  travel: "Travel",
  apple_watch: "Watch",
  health_auto_export: "Watch",
  iphone: "iPhone",
  mac: "Mac",
  "google-calendar": "Calendar",
  google_calendar: "Calendar",
  chrome: "Browser",
  browser: "Browser",
  extension: "Browser",
  "claude-code": "Claude Code",
  claude_code: "Claude Code",
  location: "Location",
  telegram: "Telegram",
  meetings: "Meetings",
};

/** "apple-watch" → "Watch"; unknown ids read as words ("strava" → "Strava"). */
export function sourceName(id: string): string {
  const known = SOURCE_NAME[id];
  if (known) return known;
  const words = id.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Distinct display names in order, so two ids for the watch read once. */
export function sourceNames(ids: string[]): string[] {
  return [...new Set(ids.map(sourceName))];
}

/** "Watch, iPhone and Mac". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Patterns first, strongest first (most held, then share held); watching ones nearest to counting. */
export function sortInsights(list: Insight[]) {
  const share = (i: Insight) => i.evidence.times_held / Math.max(1, i.evidence.times_seen);
  const patterns = list
    .filter((i) => i.status === "pattern")
    .sort(
      (a, b) =>
        b.strength - a.strength || share(b) - share(a) || b.evidence.times_held - a.evidence.times_held,
    );
  const watching = list
    .filter((i) => i.status === "watching")
    .sort(
      (a, b) =>
        a.evidence.needed - a.evidence.times_held - (b.evidence.needed - b.evidence.times_held) ||
        b.evidence.times_seen - a.evidence.times_seen,
    );
  return { patterns, watching };
}

/** The pattern Today leads with, or null while everything is still being watched. */
export function strongest(list: Insight[]): Insight | null {
  return sortInsights(list).patterns[0] ?? null;
}

/** "Held 9 of 11 times." */
export function heldLine(i: Insight): string {
  const { times_held: held, times_seen: seen } = i.evidence;
  return `Held ${held} of ${seen} ${seen === 1 ? "time" : "times"}.`;
}

/** "Seen 2 times. I call it a pattern at 4." */
export function watchingLine(i: Insight): string {
  const { times_held: held, needed } = i.evidence;
  return `Seen ${held} ${held === 1 ? "time" : "times"}. I call it a pattern at ${needed}.`;
}

/** The dots under a pattern: the history when the API sends it, else held first then the misses. */
export function evidenceDots(i: Insight): boolean[] {
  const { history, times_held: held, times_seen: seen } = i.evidence;
  if (history.length) return history;
  return Array.from({ length: seen }, (_, n) => n < held);
}

/** Where a new account stands: nights studied against nights needed. */
export function studyProgress(s: Insights["studied"]) {
  const needed = s.needed_days || DEFAULT_NEEDED_DAYS;
  const nights = s.nights;
  return { have: Math.min(nights, needed), needed, done: nights >= needed };
}
