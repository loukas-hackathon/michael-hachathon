import {
  type Goal,
  goalKind,
  type Insight,
  type InsightSource,
  InsightSource as InsightSources,
  type InsightStep,
  voiceDuration,
  voiceShortDuration,
} from "@michael/shared";
import { clockLabel } from "../patterns/format";
import { median } from "../patterns/util";
import { isBusinessGoal, isTrainingGoal } from "../score";
import { amount, type FeatureDef, featureDef, rounded, shown, type Terms, unitOf } from "./dictionary";
import type { FeatureKey, FeatureTable } from "./features";
import { type Chain, type Link, MINER_RULES, type Occurrence, type Trigger } from "./miner";

// From what the miner found to what the user reads: a title, one line with the number first, the
// steps with both sides' figures, and exactly one fix. Templates only: every figure in them is
// the miner's.

/** What applying a fix does, kept beside the insight and never sent. */
export type FixPlan =
  | {
      kind: "instruction";
      instruction: { text: string; kind: "quiet_hours"; time: string; end_time: string };
    }
  | { kind: "focus_block"; goal_id: string; minutes: number };

export interface Phrased {
  insight: Insight;
  plan: FixPlan | null;
  /** The columns the insight is about, the trigger first. */
  features: FeatureKey[];
}

export interface PhraseContext {
  table: FeatureTable;
  goals: Goal[];
}

const termsOf = (ctx: PhraseContext): Terms => ({ cutoff: ctx.table.cutoff });

/** "22:37" to the nearest five minutes, for a time someone is asked to keep. */
function roundClock(clock: string, step = 5): string {
  const [h, m] = clock.split(":").map(Number);
  return clockLabel(Math.round(((h ?? 0) * 60 + (m ?? 0)) / step) * step);
}

const thresholdText = (def: FeatureDef, x: Trigger): string =>
  x.threshold === null ? "" : amount(def.format, x.side, rounded(def.format, x.threshold), x.inclusive);

const occasionOf = (x: Trigger, t: Terms): string => {
  const def = featureDef(x.key);
  return def.cause?.occasion(thresholdText(def, x), t) ?? def.label(t);
};

/** After a step's label: when the outcome is read, seen from the trigger. */
function stepWhen(x: FeatureDef, y: FeatureDef, lag: number): string {
  if (lag === 0) return "";
  if (lag === 2) return " two days later";
  if (y.phase === 0) return x.phase >= 2 ? " that night" : " next night";
  return y.phase === 1 ? " next morning" : " next day";
}

/** The same in a sentence. */
function lineWhen(x: FeatureDef, y: FeatureDef, lag: number): string {
  if (lag === 0) return x.phase < 2 && y.phase === 2 ? " that day" : "";
  if (lag === 2) return " two days later";
  if (y.phase === 0) return x.phase >= 2 ? " that night" : " the next night";
  return y.phase === 1 ? " the next morning" : " the next day";
}

const outcomeWords = (y: FeatureDef, diff: number) => {
  const o = y.outcome;
  if (!o)
    return { phrase: y.label({ cutoff: "" }).toLowerCase(), title: y.label({ cutoff: "" }).toLowerCase() };
  return diff >= 0 ? { phrase: o.up, title: o.titleUp } : { phrase: o.down, title: o.titleDown };
};

function triggerStep(x: Trigger, link: Link, t: Terms): InsightStep {
  const def = featureDef(x.key);
  if (!link.xMeans) {
    const days = link.cmp.seen + link.cmp.other;
    return { label: def.label(t), value: `${link.cmp.seen} of ${days} days` };
  }
  const unit = unitOf(def.format);
  return {
    label: def.label(t),
    value: `${shown(def.format, link.xMeans.trigger)} against ${shown(def.format, link.xMeans.other)}`,
    ...(unit
      ? {
          value_num: rounded(def.format, link.xMeans.trigger),
          usual_num: rounded(def.format, link.xMeans.other),
          unit,
        }
      : {}),
  };
}

function outcomeStep(x: FeatureDef, link: Link, lag: number, t: Terms): InsightStep {
  const def = featureDef(link.y);
  const unit = unitOf(def.format);
  return {
    label: `${def.label(t)}${stepWhen(x, def, lag)}`,
    value: `${shown(def.format, link.cmp.triggerMean)} against ${shown(def.format, link.cmp.otherMean)}`,
    ...(unit
      ? {
          value_num: rounded(def.format, link.cmp.triggerMean),
          usual_num: rounded(def.format, link.cmp.otherMean),
          unit,
        }
      : {}),
  };
}

const sourcesOf = (keys: FeatureKey[]): InsightSource[] => {
  const used = new Set(keys.flatMap((k) => featureDef(k).sources));
  return InsightSources.options.filter((s) => used.has(s));
};

const evidenceOf = (occurrences: Occurrence[], held: number, seen: number) => {
  const last = occurrences.slice(-MINER_RULES.historyCap);
  return {
    times_held: held,
    times_seen: seen,
    needed: MINER_RULES.needed,
    history: last.map((o) => o.held),
    days: last.map((o) => o.day),
  };
};

// ---------- the fix ----------

const timeGoals = (goals: Goal[]) => goals.filter((g) => g.active && goalKind(g) === "time");

function fixFor(
  x: Trigger,
  outcome: FeatureKey,
  diff: number,
  ctx: PhraseContext,
): { fix: Insight["fix"]; plan: FixPlan | null } {
  const t = termsOf(ctx);
  const def = featureDef(x.key);
  const cause = def.cause;
  const better = featureDef(outcome).outcome?.better ?? "high";
  const worse = diff >= 0 ? better === "low" : better === "high";
  const plain = (text: string) => ({ fix: { text, applied_at: null }, plan: null });
  if (!cause) return plain("Change one thing and watch the next week.");
  const threshold = x.threshold === null ? "" : shown(def.format, rounded(def.format, x.threshold));
  const noun = cause.noun?.(t) ?? def.label(t).toLowerCase();

  if (worse) {
    if (cause.fix === "phone_down") {
      const at = t.cutoff;
      const what = x.key === "late_screen_min" ? "Screens off" : "Phone down";
      return {
        fix: {
          text: `${what} at ${at}. I can hold that line every night.`,
          action: { kind: "instruction", label: `${what} at ${at}`, done_label: "Set. Undo" },
          applied_at: null,
        },
        plan: {
          kind: "instruction",
          instruction: {
            text: `${what} at ${at}`,
            kind: "quiet_hours",
            time: at,
            end_time: roundClock(ctx.table.usualWake ?? "07:00"),
          },
        },
      };
    }
    if (cause.fix === "protect_block") {
      const goal = timeGoals(ctx.goals)
        .filter(isBusinessGoal)
        .sort((a, b) => (b.weekly_budget_minutes ?? 0) - (a.weekly_budget_minutes ?? 0))[0];
      if (goal) {
        const minutes = 60;
        return {
          fix: {
            text: `Protect one block before the first meeting. I can book ${voiceDuration(minutes)} now.`,
            action: {
              kind: "focus_block",
              label: `Book ${voiceShortDuration(minutes)} of ${goal.title}`,
              done_label: "Booked. Undo",
            },
            applied_at: null,
          },
          plan: { kind: "focus_block", goal_id: goal.id, minutes },
        };
      }
    }
    if (typeof cause.avoid === "function") return plain(cause.avoid(threshold));
    if (cause.avoid) return plain(cause.avoid);
    if (x.threshold === null) return plain(`Fewer ${occasionOf(x, t)}.`);
    return plain(
      x.side === "high" ? `Hold ${noun} under ${threshold}.` : `Get ${noun} to ${threshold} or more.`,
    );
  }

  if (cause.fix === "book_training") {
    const goal = timeGoals(ctx.goals).find(isTrainingGoal);
    if (goal) {
      const sessions = ctx.table.cols.workout_min.filter((v): v is number => v !== null && v > 0);
      const usual = sessions.length > 0 ? median(sessions) : 60;
      const minutes = Math.min(120, Math.max(30, Math.round(usual / 15) * 15));
      return {
        fix: {
          text: `${cause.keep ?? "Keep training on the plan."} I can book the next session.`,
          action: {
            kind: "focus_block",
            label: `Book ${voiceShortDuration(minutes)} of ${goal.title}`,
            done_label: "Booked. Undo",
          },
          applied_at: null,
        },
        plan: { kind: "focus_block", goal_id: goal.id, minutes },
      };
    }
  }
  if (cause.keep) return plain(cause.keep);
  if (x.threshold === null) return plain(`More ${occasionOf(x, t)}.`);
  return plain(
    x.side === "high" ? `Keep ${noun} at ${threshold} or more.` : `Keep ${noun} under ${threshold}.`,
  );
}

// ---------- insights ----------

export function phraseLink(link: Link, status: Insight["status"], ctx: PhraseContext): Phrased {
  const t = termsOf(ctx);
  const x = featureDef(link.x.key);
  const y = featureDef(link.y);
  const words = outcomeWords(y, link.cmp.diff);
  const occasion = occasionOf(link.x, t);
  const when = lineWhen(x, y, link.lag);
  const a = shown(y.format, link.cmp.triggerMean);
  const b = shown(y.format, link.cmp.otherMean);
  // A watched relation says only what was seen: the screen draws its progress from the evidence.
  const line =
    status === "pattern"
      ? `${link.cmp.held} of ${link.cmp.seen} ${occasion} gave ${words.phrase}${when}: ${a} against ${b}.`
      : `${a} against ${b}: ${words.phrase}${when} after ${occasion}.`;
  const { fix, plan } = fixFor(link.x, link.y, link.cmp.diff, ctx);
  return {
    insight: {
      id: `link:${link.x.key}>${link.y}`,
      kind: "link",
      status,
      title: `${x.cause?.title ?? x.label(t)}, ${words.title}`,
      line,
      steps: [triggerStep(link.x, link, t), outcomeStep(x, link, link.lag, t)],
      evidence: evidenceOf(link.cmp.occurrences, link.cmp.held, link.cmp.seen),
      fix,
      found_by: "rule",
      last_seen: link.cmp.occurrences.at(-1)?.day ?? ctx.table.days.at(-1) ?? "1970-01-01",
      // A relation still being watched never outranks its own progress.
      strength: status === "pattern" ? link.strength : Math.round(link.strength * 50) / 100,
      sources: sourcesOf([link.x.key, link.y]),
    },
    plan,
    features: [link.x.key, link.y],
  };
}

export function phraseChain(chain: Chain, ctx: PhraseContext): Phrased {
  const t = termsOf(ctx);
  const x = featureDef(chain.x.key);
  const y = featureDef(chain.y);
  const z = featureDef(chain.z);
  const total = chain.lagXY + chain.lagYZ;
  const yWords = outcomeWords(y, chain.first.cmp.diff);
  const zWords = outcomeWords(z, chain.direct.cmp.diff);
  const seen = chain.occurrences.length;
  const line = `${chain.held} of ${seen} ${occasionOf(chain.x, t)} gave ${yWords.phrase}${lineWhen(x, y, chain.lagXY)} and ${zWords.phrase}${lineWhen(x, z, total)}.`;
  const { fix, plan } = fixFor(chain.x, chain.z, chain.direct.cmp.diff, ctx);
  return {
    insight: {
      id: `chain:${chain.x.key}>${chain.y}>${chain.z}`,
      kind: "chain",
      status: "pattern",
      title: `${x.cause?.title ?? x.label(t)}, ${yWords.title}, ${zWords.title}`,
      line,
      steps: [
        triggerStep(chain.x, chain.first, t),
        outcomeStep(x, chain.first, chain.lagXY, t),
        outcomeStep(x, chain.direct, total, t),
      ],
      evidence: evidenceOf(chain.occurrences, chain.held, seen),
      fix,
      found_by: "rule",
      last_seen: chain.occurrences.at(-1)?.day ?? ctx.table.days.at(-1) ?? "1970-01-01",
      strength: chain.strength,
      sources: sourcesOf([chain.x.key, chain.y, chain.z]),
    },
    plan,
    features: [chain.x.key, chain.y, chain.z],
  };
}
