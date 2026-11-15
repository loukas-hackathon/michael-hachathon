// What Michael has learnt about you (#432): patterns across sources, each with its evidence and
// one fix. Provisional local shape of GET /v1/insights until the contract lands in
// @michael/shared; fields marked "asked" are ones the screens asked Head for and may be missing.

export type InsightKind = "chain" | "link" | "discovered";
export type InsightStatus = "pattern" | "watching";

export type InsightStep = {
  label: string;
  /** Display string, numbers first: "71 against 85", "40 min or more". */
  value: string;
  /** Asked: this time and the usual, to draw the pair as two bars. */
  value_num?: number;
  usual_num?: number;
  unit?: "score" | "min" | "pct" | "bpm" | "ms" | "count";
};

export type InsightFix = {
  text: string;
  /** One tap, where Michael can do it himself. */
  action?: { kind: string; label: string; done_label?: string };
  /** Asked: when the one tap was taken; null until then. */
  applied_at?: string | null;
};

export type Insight = {
  id: string;
  kind: InsightKind;
  status: InsightStatus;
  title: string;
  line: string;
  steps: InsightStep[];
  evidence: {
    times_held: number;
    times_seen: number;
    /** Times it must hold before it counts as a pattern. */
    needed: number;
    /** Asked: one entry per time the first step happened, oldest first; true when the rest followed. */
    history?: boolean[];
    /** Asked: the day of each history entry (YYYY-MM-DD), to mark trigger nights on the series. */
    days?: string[];
  };
  fix: InsightFix | null;
  found_by: "rule" | "model";
  last_seen: string;
  /** Asked: the sources this insight joins. */
  sources?: string[];
  /** 0..1, the API's own ranking. */
  strength?: number;
};

export type SeriesKey = "sleep_score" | "hrv" | "resting_hr" | "recovery" | "late_phone_min" | "lost_min";

/** One daily line behind the study (the 12 week view). Null where there was no reading. */
export type Series = {
  key: SeriesKey;
  label: string;
  unit: string;
  points: { day: string; value: number | null }[];
};

export type Insights = {
  studied: {
    days: number;
    nights?: number;
    data_points: number;
    sources: string[];
    /** Asked: nights needed before anything can be a pattern ("3 of 14 nights so far"). */
    needed_days?: number;
  };
  insights: Insight[];
  series?: Series[];
};

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
        (b.strength ?? share(b)) - (a.strength ?? share(a)) || b.evidence.times_held - a.evidence.times_held,
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
  if (history?.length) return history;
  return Array.from({ length: seen }, (_, n) => n < held);
}

/** Where a new account stands: nights studied against nights needed. */
export function studyProgress(s: Insights["studied"]) {
  const needed = s.needed_days ?? DEFAULT_NEEDED_DAYS;
  const nights = s.nights ?? s.days;
  return { have: Math.min(nights, needed), needed, done: nights >= needed };
}
