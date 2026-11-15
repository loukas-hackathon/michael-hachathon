import { type Insight, type InsightSeries, InsightSource, type InsightsResponse } from "@michael/shared";
import { FEATURES, featureDef, unitOf } from "./dictionary";
import { buildFeatures, type FeatureInput, type FeatureKey, type FeatureTable } from "./features";
import { MINER_RULES, mine, studiedDays } from "./miner";
import { type FixPlan, type Phrased, phraseChain, phraseLink } from "./phrase";

export type { FeatureInput, FeatureKey, FeatureTable } from "./features";
export { buildFeatures, FEATURE_KEYS } from "./features";
export { MINER_RULES, mine } from "./miner";
export type { FixPlan, Phrased } from "./phrase";

// Events in, what Michael has learnt out. Pure: no I/O and no clock, so the same events always
// give the same insights. Three steps: the daily table (features.ts), the miner (miner.ts), the
// words (phrase.ts). The route (routes/insights.ts) is the one place that reads the store.

/** Flags worked out from other columns: not counted again as readings. */
const DERIVED: ReadonlySet<FeatureKey> = new Set([
  "late_streak",
  "short_night",
  "trained",
  "evening_workout",
  "after_training",
  "heavy_meeting_day",
  "focus_pct",
]);

const SERIES: InsightSeries["key"][] = [
  "sleep_score",
  "hrv",
  "resting_hr",
  "recovery",
  "late_phone_min",
  "lost_min",
];

export interface Study {
  table: FeatureTable;
  /** What the user reads, in order: patterns before watching, strongest first. */
  response: InsightsResponse;
  /** What applying each fix does, by insight id. */
  plans: Map<string, FixPlan>;
  /** The columns each insight is about, by insight id, the trigger first. */
  features: Map<string, FeatureKey[]>;
}

/** Patterns before watching, strongest first; the id settles a tie so the order never flickers. */
export const byRank = (a: Insight, b: Insight): number =>
  Number(a.status === "watching") - Number(b.status === "watching") ||
  b.strength - a.strength ||
  (a.id < b.id ? -1 : 1);

export function seriesOf(table: FeatureTable): InsightSeries[] {
  const terms = { cutoff: table.cutoff };
  return SERIES.map((key) => {
    const def = featureDef(key);
    return {
      key,
      label: def.label(terms),
      unit: unitOf(def.format) ?? "count",
      points: table.days.map((day, i) => ({ day, value: table.cols[key][i] ?? null })),
    };
  });
}

export function studiedOf(table: FeatureTable): InsightsResponse["studied"] {
  const used = new Set<string>();
  let points = 0;
  for (const def of FEATURES) {
    const filled = table.cols[def.key].filter((v) => v !== null).length;
    if (filled === 0) continue;
    for (const s of def.sources) used.add(s);
    if (!DERIVED.has(def.key)) points += filled;
  }
  return {
    days: studiedDays(table),
    data_points: points,
    sources: InsightSource.options.filter((s) => used.has(s)),
    nights: table.cols.sleep_min.filter((v) => v !== null).length,
    needed_days: MINER_RULES.minDays,
  };
}

/** The whole study of one person over a range of days. */
export function buildInsights(input: FeatureInput): Study {
  const table = buildFeatures(input);
  const mined = mine(table);
  const ctx = { table, goals: input.goals };
  const phrased: Phrased[] = [
    ...mined.chains.map((c) => phraseChain(c, ctx)),
    ...mined.links.map((l) => phraseLink(l, "pattern", ctx)),
  ]
    .sort((a, b) => byRank(a.insight, b.insight))
    .slice(0, MINER_RULES.maxPatterns)
    .concat(mined.watching.map((l) => phraseLink(l, "watching", ctx)))
    .sort((a, b) => byRank(a.insight, b.insight));
  return {
    table,
    response: {
      generated_at: new Date(Date.parse(input.now)).toISOString(),
      studied: studiedOf(table),
      insights: phrased.map((p) => p.insight),
      series: seriesOf(table),
    },
    plans: new Map(phrased.flatMap((p) => (p.plan ? [[p.insight.id, p.plan] as const] : []))),
    features: new Map(phrased.map((p) => [p.insight.id, p.features] as const)),
  };
}

/**
 * The strongest pattern about one column of the daily table ("late_phone_min", "lost_min"), as
 * its trigger or as what follows; null when Michael has none. For readers that want to cite what
 * he has learnt in a line of their own (a nudge, the chat).
 */
export function pickInsight(study: Pick<Study, "response" | "features">, feature: string): Insight | null {
  return (
    study.response.insights.find(
      (i) => i.status === "pattern" && (study.features.get(i.id) ?? []).some((k) => k === feature),
    ) ?? null
  );
}
