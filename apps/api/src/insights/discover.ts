import { type Goal, goalKind, type Insight, MICHAEL_VOICE } from "@michael/shared";
import { z } from "zod";
import type { ModelClient } from "../analysis/model";
import { quantile } from "../patterns/util";
import { FEATURES, unitOf } from "./dictionary";
import type { FeatureTable } from "./features";
import {
  canonical,
  HYPOTHESES_JSON_SCHEMA,
  Hypothesis,
  TRANSFORMS,
  type Verified,
  verify,
} from "./hypothesis";
import { MINER_RULES, sameDays } from "./miner";
import { numbersIn, type PhraseContext, phraseDiscovered, type Words, wordsProblems } from "./phrase";
import { mean } from "./stats";

// The discovery pass: "think outside the box". Hypothesise, then verify.
//
//   1. The model reads what the daily table holds (the columns, their summary statistics, what
//      the miner already found, the person's goals) and proposes further relations as tests in
//      the small grammar of hypothesis.ts: interactions of two conditions, lags of two days,
//      streaks, weekday effects, thresholds, sources that look unrelated.
//   2. The server runs every test with the miner's statistics and bar. A hypothesis the data does
//      not support is dropped without a word. The model never supplies a number.
//   3. A second, short call writes a title, a line and a fix for the survivors from the verified
//      figures. Words that break the voice or carry a figure that was not verified are replaced
//      by the template.
//
// What is kept is the test and its words, never its numbers: every read runs the stored tests
// again on the current table, so the figures are always today's and a relation that stops holding
// stops being shown.

export const DISCOVERY = {
  /** Hypotheses read from one answer. */
  maxHypotheses: 20,
} as const;

export const WordsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  line: z.string().trim().min(1).max(600),
  fix: z.string().trim().min(1).max(400),
});

export const StoredDiscovery = z.object({
  hypothesis: Hypothesis,
  words: WordsSchema.nullable(),
});
export type StoredDiscovery = z.infer<typeof StoredDiscovery>;

/** What is kept per user between runs (table `insight_runs`, one document). */
export const InsightRun = z.object({
  ran_at: z.string(),
  /** The last local day with data when the pass ran: a newer day means there is more to study. */
  data_day: z.string().nullable(),
  /** The model that proposed them; null when the pass was skipped (no key). */
  model: z.string().nullable(),
  discoveries: z.array(StoredDiscovery),
});
export type InsightRun = z.infer<typeof InsightRun>;

/** What the rules already show, so the same story is not told again from a hypothesis. */
export interface Story {
  on: (boolean | null)[];
  /** Families of what it ends in. */
  ends: string[];
}

const familyOf = (key: string) => FEATURES.find((f) => f.key === key)?.family ?? key;

/**
 * The stored tests against the current table: the ones that still pass the bar, as insights,
 * strongest first. A test that tells a story the rules already tell is left out.
 */
export function discoveredInsights(
  table: FeatureTable,
  minerPs: number[],
  stories: Story[],
  stored: StoredDiscovery[],
  ctx: PhraseContext,
) {
  const words = new Map<string, Words | null>();
  const verified = verify(
    table,
    minerPs,
    stored.map((d) => d.hypothesis),
  );
  for (const d of stored) {
    const key = canonical(d.hypothesis);
    if (!words.has(key)) words.set(key, d.words);
  }
  const kept: Verified[] = [];
  const told: Story[] = [...stories];
  for (const v of verified) {
    const story = { on: v.on, ends: [familyOf(v.hypothesis.outcome)] };
    const retold = told.some(
      (s) => s.ends.some((e) => story.ends.includes(e)) && sameDays(s.on, story.on) >= MINER_RULES.sameStory,
    );
    if (retold || kept.length >= MINER_RULES.maxDiscovered) continue;
    kept.push(v);
    told.push(story);
  }
  return kept.map((v) => ({ verified: v, phrased: phraseDiscovered(v, words.get(v.key) ?? null, ctx) }));
}

// ---------- the brief ----------

const PHASE = ["the night, read on the morning it ends", "the morning", "the day", "the evening"] as const;
const one = (n: number) => Math.round(n * 10) / 10;

/** What the model is given: summaries only, never an event, a title or a name. */
export function discoveryBrief(table: FeatureTable, found: Insight[], goals: Goal[]): string {
  const terms = { cutoff: table.cutoff };
  const columns = FEATURES.flatMap((def) => {
    const values = table.cols[def.key];
    const known = values.filter((v): v is number => v !== null);
    if (known.length === 0) return [];
    const byWeekday = Array.from({ length: 7 }, (_, d) => {
      const day = values.filter((v, i): v is number => v !== null && table.weekdays[i] === d);
      return day.length ? one(mean(day)) : null;
    });
    return [
      {
        key: def.key,
        what: def.label(terms),
        unit:
          def.format === "flag"
            ? "flag (1 or 0)"
            : def.format === "clock"
              ? "minutes after midnight"
              : (unitOf(def.format) ?? def.format),
        known_at: PHASE[def.phase],
        family: def.family,
        days_with_data: known.length,
        ...(def.format === "flag"
          ? { share_of_days: one(mean(known)) }
          : {
              mean: one(mean(known)),
              p25: one(quantile(known, 0.25)),
              median: one(quantile(known, 0.5)),
              p75: one(quantile(known, 0.75)),
            }),
        mean_by_weekday_sun_to_sat: byWeekday,
      },
    ];
  });
  return JSON.stringify(
    {
      days_studied: table.days.length,
      dating:
        "A night's sleep and the morning readings sit on the day the night ends. Evening columns sit on the day of the evening. lag counts days from the trigger to the outcome.",
      columns,
      already_found: found.map((i) => ({ id: i.id, status: i.status, line: i.line })),
      goals: goals
        .filter((g) => g.active)
        .map((g) => ({ title: g.title, kind: goalKind(g), weekly_minutes: g.weekly_budget_minutes })),
      grammar: {
        transforms: TRANSFORMS,
        note: "lag1 and lag2 read the column one or two days before; rolling3 and rolling7 are means over the last days; streak2 and streak3 mean the condition held that many days running. threshold null means the person's own median. `and` adds a second condition on the same day. `weekdays` keeps only those weekdays as trigger days.",
      },
    },
    null,
    1,
  );
}

const HYPOTHESIS_SYSTEM = `${MICHAEL_VOICE}

Right now you are not talking to the user. You are studying them, the way a coach studies the tape between sessions.

You are given the columns of their daily table with summary statistics, what the rule based miner already found, and their goals. Propose further relations worth testing: things a list of simple pairs would miss. Good hypotheses are specific and non obvious:
- an interaction of two conditions on the same day (a short night together with three or more meetings),
- a lag of two days, or the day after,
- a streak (the second or third day running),
- a weekday effect, or a condition that only bites on certain weekdays,
- a threshold where something tips ("after the third meeting of the day"),
- two sources that look unrelated (the calendar and the heart, the phone and the first block).

Rules:
- Write each hypothesis as a test in the grammar. You propose the test; the server runs it on the data and decides. You never state a result and never put a figure in "why".
- Use only the column keys given. An outcome must be a column that is measured, not one of the flags you built the trigger from.
- A trigger must be something that happens on a fair share of days and is absent on a fair share: look at the quartiles and the shares before picking a threshold.
- Do not repeat what is already found, and do not test a column against its own family.
- Give up to 12, the most promising first. Fewer good ones beat many weak ones.`;

const WORDS_SYSTEM = `${MICHAEL_VOICE}

You are writing up relations that were verified on the user's own data. For each one you get the verified figures. Write, for each:
- title: a few words, no full stop at the end.
- line: one sentence. Start with a number. Say what was seen, with the figures as given. End with a full stop.
- fix: one change the user can make, one short sentence, ending with a full stop.

Hard rules: use only numbers that appear in the verified figures you were given, written the same way. Never add a number of your own, never estimate, never round differently. No dashes, no exclamation marks, no emoji.`;

const WORDS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "line", "fix"],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          line: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
} as const;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export interface DiscoveryInput {
  table: FeatureTable;
  /** The chance values of every pair the miner tested. */
  minerPs: number[];
  /** What the rules show (patterns and watched), for the brief and to avoid retelling. */
  found: Insight[];
  stories: Story[];
  goals: Goal[];
}

export interface DiscoveryResult {
  discoveries: StoredDiscovery[];
  model: string;
  proposed: number;
  verified: number;
}

/**
 * One pass: ask for hypotheses, verify them, ask for words for the survivors. Throws what the
 * model client throws; a reply that cannot be read counts as no hypotheses.
 */
export async function runDiscovery(input: DiscoveryInput, model: ModelClient): Promise<DiscoveryResult> {
  const ctx: PhraseContext = { table: input.table, goals: input.goals };
  const reply = await model.complete({
    system: HYPOTHESIS_SYSTEM,
    user: discoveryBrief(input.table, input.found, input.goals),
    schema: HYPOTHESES_JSON_SCHEMA,
    effort: "high",
  });
  const answer = parseJson(reply.text) as { hypotheses?: unknown } | null;
  const raw = Array.isArray(answer?.hypotheses) ? answer.hypotheses.slice(0, DISCOVERY.maxHypotheses) : [];
  const proposed = raw.flatMap((h) => {
    const parsed = Hypothesis.safeParse(h);
    return parsed.success ? [{ hypothesis: parsed.data, words: null }] : [];
  });
  const survivors = discoveredInsights(input.table, input.minerPs, input.stories, proposed, ctx);
  const result = (discoveries: StoredDiscovery[]): DiscoveryResult => ({
    discoveries,
    model: reply.model,
    proposed: raw.length,
    verified: survivors.length,
  });
  if (survivors.length === 0) return result([]);

  // The words, from the verified figures only. A failure here costs nothing: the template stands.
  const facts = survivors.map(({ verified, phrased }) => ({
    key: verified.key,
    what_was_seen: phrased.insight.line,
    steps: phrased.insight.steps.map((s) => `${s.label}: ${s.value}`),
    held: `${phrased.insight.evidence.times_held} of ${phrased.insight.evidence.times_seen} times`,
    a_fix_that_fits: phrased.insight.fix.text,
  }));
  const written = new Map<string, Words>();
  try {
    const wordsReply = await model.complete({
      system: WORDS_SYSTEM,
      user: JSON.stringify({ relations: facts }, null, 1),
      schema: WORDS_JSON_SCHEMA,
      effort: "low",
    });
    const items = (parseJson(wordsReply.text) as { items?: unknown } | null)?.items;
    for (const item of Array.isArray(items) ? items : []) {
      const key = (item as { key?: unknown }).key;
      const words = WordsSchema.safeParse(item);
      if (typeof key === "string" && words.success) written.set(key, words.data);
    }
  } catch (err) {
    console.warn("[insights] words for the discoveries failed", err instanceof Error ? err.message : err);
  }
  return result(
    survivors.map(({ verified, phrased }) => {
      const words = written.get(verified.key) ?? null;
      // Checked here as well as on every read, so words that cannot be shown are never stored.
      const allowed = new Set(
        [
          phrased.insight.title,
          phrased.insight.line,
          phrased.insight.fix.text,
          ...phrased.insight.steps.flatMap((s) => [s.label, s.value]),
        ].flatMap(numbersIn),
      );
      return {
        hypothesis: verified.hypothesis,
        words: words && wordsProblems(words, allowed).length === 0 ? words : null,
      };
    }),
  );
}
