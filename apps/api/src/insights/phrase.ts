import {
  type Goal,
  goalKind,
  type Insight,
  type InsightSource,
  InsightSource as InsightSources,
  type InsightStep,
  voiceDuration,
  voiceProblems,
  voiceShortDuration,
} from "@michael/shared";
import { clockLabel } from "../patterns/format";
import { median } from "../patterns/util";
import { isBusinessGoal, isTrainingGoal } from "../score";
import {
  amount,
  type FeatureDef,
  type Format,
  featureDef,
  rounded,
  shown,
  type Terms,
  unitOf,
} from "./dictionary";
import type { FeatureKey, FeatureTable } from "./features";
import type { Condition, ReadCondition, Verified } from "./hypothesis";
import { below, type Chain, type Link, MINER_RULES, type Occurrence, type Trigger } from "./miner";
import { mean } from "./stats";

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

/** Whether the outcome moved the way that is bad for the user. */
const isWorse = (outcome: FeatureKey, diff: number): boolean => {
  const better = featureDef(outcome).outcome?.better ?? "high";
  return diff >= 0 ? better === "low" : better === "high";
};

/**
 * A derived trigger shown beside its plain one says so: in the title, and in a closing sentence
 * that names the plain one (with its own figure when both are read in the same column).
 */
function harderWords(
  mine: string,
  plain: FeatureDef,
  outcome: FeatureKey,
  diff: number,
  plainFigure: string | null,
  t: Terms,
) {
  const theirs = lowerFirst(plain.cause?.title ?? plain.label(t));
  return {
    title: `${mine} ${isWorse(outcome, diff) ? "hit harder" : "helped more"}`,
    tail: ` That is more than ${theirs} alone${plainFigure ? ` (${plainFigure})` : ""}.`,
  };
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
  const plain = link.harder?.plain;
  const harder = plain
    ? harderWords(
        x.cause?.title ?? x.label(t),
        featureDef(plain.x.key),
        link.y,
        link.cmp.diff,
        plain.y === link.y ? shown(y.format, plain.cmp.triggerMean) : null,
        t,
      )
    : null;
  return {
    insight: {
      id: `link:${link.x.key}>${link.y}`,
      kind: "link",
      status,
      title: harder?.title ?? `${x.cause?.title ?? x.label(t)}, ${words.title}`,
      line: `${line}${harder?.tail ?? ""}`,
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
  const whenY = lineWhen(x, y, chain.lagXY);
  const whenZ = lineWhen(x, z, total);
  // Said once when both follow at the same time.
  const line = `${chain.held} of ${seen} ${occasionOf(chain.x, t)} gave ${yWords.phrase}${whenY === whenZ ? "" : whenY} and ${zWords.phrase}${whenZ}.`;
  const { fix, plan } = fixFor(chain.x, chain.z, chain.direct.cmp.diff, ctx);
  const plain = chain.harder?.plain;
  const harder = plain
    ? harderWords(
        x.cause?.title ?? x.label(t),
        featureDef(plain.x.key),
        chain.z,
        chain.direct.cmp.diff,
        plain.z === chain.z ? shown(z.format, plain.direct.cmp.triggerMean) : null,
        t,
      )
    : null;
  return {
    insight: {
      id: `chain:${chain.x.key}>${chain.y}>${chain.z}`,
      kind: "chain",
      status: "pattern",
      title: harder?.title ?? `${x.cause?.title ?? x.label(t)}, ${yWords.title}, ${zWords.title}`,
      line: `${line}${harder?.tail ?? ""}`,
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

// ---------- relations the model proposed and the server verified ----------

/** The model's words for one verified relation. Used only while they pass `wordsProblems`. */
export interface Words {
  title: string;
  line: string;
  fix: string;
}

/** A threshold both ways: "30 minutes or more", "of 70 or less", "at 00:30 or later". */
function atWords(format: Format, op: Condition["op"], threshold: number): string {
  const more = op === ">=";
  if (format === "clock") return `at ${clockLabel(threshold)} or ${more ? "later" : "earlier"}`;
  if (format === "min") return `${voiceDuration(threshold)} or ${more ? "more" : "less"}`;
  if (format === "count") return `${shown(format, threshold)} or ${more ? "more" : "fewer"}`;
  return `of ${shown(format, threshold)} or ${more ? "more" : "less"}`;
}

const lowerFirst = (text: string) =>
  /^[A-Z][a-z]/.test(text) ? text[0]?.toLowerCase() + text.slice(1) : text;
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const listed = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const upperFirst = (text: string) => (text[0]?.toUpperCase() ?? "") + text.slice(1);
/** "Mondays and Thursdays"; the working week and the weekend go by their names. */
function weekdayWords(days: number[]): string {
  const key = days.join("");
  if (key === "12345") return "working days";
  if (key === "06") return "weekend days";
  return listed(days.map((d) => WEEKDAYS[d] ?? ""));
}

/** The days one condition holds, in plain words. */
function conditionOccasion(c: Condition, read: ReadCondition, t: Terms): string {
  const def = featureDef(c.feature);
  const threshold = rounded(def.format, read.threshold);
  let base: string;
  if (def.format === "flag") {
    const named = def.cause?.occasion("", t) ?? `days with ${lowerFirst(def.label(t))}`;
    base = c.op === ">=" ? named : `days other than ${named}`;
  } else if (def.cause) {
    base = def.cause.occasion(atWords(def.format, c.op, threshold), t);
  } else {
    base = `days with ${lowerFirst(def.label(t))} ${atWords(def.format, c.op, threshold).replace(/^of /, "at ")}`;
  }
  switch (c.transform) {
    case "lag1":
      return `days after ${base}`;
    case "lag2":
      return `days two days after ${base}`;
    case "rolling3":
      return `${base} on average over 3 days`;
    case "rolling7":
      return `${base} on average over 7 days`;
    case "streak2":
      return `${base}, 2 days running`;
    case "streak3":
      return `${base}, 3 days running`;
    default:
      return base;
  }
}

const TRANSFORM_LABEL: Record<Condition["transform"], string> = {
  none: "",
  lag1: ", the day before",
  lag2: ", two days before",
  rolling3: ", 3 day average",
  rolling7: ", 7 day average",
  streak2: ", 2 days running",
  streak3: ", 3 days running",
};

function conditionStep(c: Condition, read: ReadCondition, v: Verified, t: Terms): InsightStep {
  const def = featureDef(c.feature);
  const label = `${def.label(t)}${TRANSFORM_LABEL[c.transform]}`;
  const unit = unitOf(def.format);
  const on: number[] = [];
  const off: number[] = [];
  read.values.forEach((value, i) => {
    if (value === null || v.on[i] === null || v.on[i] === undefined) return;
    (v.on[i] ? on : off).push(value);
  });
  if (def.format === "flag" || on.length === 0 || off.length === 0) {
    return { label, value: `${v.cmp.seen} of ${v.cmp.seen + v.cmp.other} days` };
  }
  return {
    label,
    value: `${shown(def.format, mean(on))} against ${shown(def.format, mean(off))}`,
    ...(unit
      ? { value_num: rounded(def.format, mean(on)), usual_num: rounded(def.format, mean(off)), unit }
      : {}),
  };
}

/** Every figure in a text, as written: "41", "5h 34" gives 5 and 34, "22:45" stays whole, "38%" is 38. */
export const numbersIn = (text: string): string[] => text.match(/\d+(?:[.:]\d+)?/g) ?? [];

/**
 * What stops the model's words from being shown: the voice's hard rules, the shape (a title with
 * no full stop, a line that starts with a number and ends with a full stop, one short fix), and
 * any figure that is not among the verified ones. An empty list means they can be shown.
 */
export function wordsProblems(words: Words, allowed: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const [name, text] of Object.entries(words)) {
    for (const p of voiceProblems(text)) problems.push(`${name}: ${p}`);
    for (const n of numbersIn(text))
      if (!allowed.has(n)) problems.push(`${name}: the number ${n} is not verified`);
  }
  if (words.title.length < 3 || words.title.length > 70 || /\.$/.test(words.title))
    problems.push("title: shape");
  if (!/^\d/.test(words.line) || !/\.$/.test(words.line) || words.line.length > 240)
    problems.push("line: shape");
  if (!/\.$/.test(words.fix) || words.fix.length > 140) problems.push("fix: shape");
  return problems;
}

/**
 * One verified hypothesis as an insight. The template always works; the model's words replace
 * the title and the line (and the fix, when it has no one tap action to agree with) only while
 * every figure in them is one the server verified.
 */
export function phraseDiscovered(
  v: Verified,
  words: Words | null,
  ctx: PhraseContext,
  /** The plain relation this one is a harder version of: its trigger's column, and its strength. */
  harderThan?: { key: FeatureKey; strength: number },
): Phrased {
  const t = termsOf(ctx);
  const h = v.hypothesis;
  const y = featureDef(h.outcome);
  // A plain weekday effect has no column to start from: the day itself is known in the morning.
  const x = h.when ? featureDef(h.when.feature) : null;
  const from: Pick<FeatureDef, "phase"> = x ?? { phase: 1 };
  const yWords = outcomeWords(y, v.cmp.diff);
  const weekdays = h.weekdays ? weekdayWords([...new Set(h.weekdays)].sort()) : null;
  const parts: string[] = [];
  if (h.when && v.when) parts.push(conditionOccasion(h.when, v.when, t));
  if (h.and && v.and) parts.push(`together with ${conditionOccasion(h.and, v.and, t)}`);
  if (weekdays) parts.push(parts.length ? `on ${weekdays}` : weekdays);
  const occasion = parts.join(", ");
  const a = shown(y.format, v.cmp.triggerMean);
  const b = shown(y.format, v.cmp.otherMean);
  const when = lineWhen(from as FeatureDef, y, h.lag);
  const line = `${v.cmp.held} of ${v.cmp.seen} ${occasion} gave ${yWords.phrase}${when}: ${a} against ${b}.`;
  const planned =
    h.when && x
      ? fixFor(
          {
            key: h.when.feature,
            side: h.when.op === ">=" ? "high" : "low",
            threshold: x.format === "flag" || !v.when ? null : v.when.threshold,
            inclusive: true,
            on: v.on,
          },
          h.outcome,
          v.cmp.diff,
          ctx,
        )
      : {
          fix: { text: `Plan ${weekdays ?? "those days"} with that in mind.`, applied_at: null },
          plan: null,
        };
  const { fix, plan } = planned;
  const unit = unitOf(y.format);
  const steps: InsightStep[] = [
    h.when && v.when
      ? conditionStep(h.when, v.when, v, t)
      : {
          label: upperFirst(weekdays ?? "Those days"),
          value: `${v.cmp.seen} of ${v.cmp.seen + v.cmp.other} days`,
        },
    {
      label: `${y.label(t)}${stepWhen(from as FeatureDef, y, h.lag)}`,
      value: `${a} against ${b}`,
      ...(unit
        ? {
            value_num: rounded(y.format, v.cmp.triggerMean),
            usual_num: rounded(y.format, v.cmp.otherMean),
            unit,
          }
        : {}),
    },
  ];
  // The dictionary's title names one side of the column: it fits only a condition on that side.
  const named =
    x && h.when && x.cause && (x.cause.side === "high") === (h.when.op === ">=") ? x.cause.title : null;
  const title = `${named ?? (x ? x.label(t) : upperFirst(weekdays ?? "Those days"))}, ${yWords.title}`;
  const features = [...(h.when ? [h.when.feature] : []), ...(h.and ? [h.and.feature] : []), h.outcome];
  const insight: Insight = {
    id: `discovered:${v.key}`,
    kind: "discovered",
    status: "pattern",
    title,
    line,
    steps,
    evidence: evidenceOf(v.cmp.occurrences, v.cmp.held, v.cmp.seen),
    fix,
    found_by: "model",
    last_seen: v.cmp.occurrences.at(-1)?.day ?? ctx.table.days.at(-1) ?? "1970-01-01",
    strength: v.strength,
    sources: sourcesOf(features),
  };
  if (harderThan) {
    // Shown beside the plain relation it is built on: it says so, in the template's own words,
    // and never outranks it.
    const said = harderWords(
      `${named ?? (x ? x.label(t) : "That")}${h.when ? TRANSFORM_LABEL[h.when.transform] : ""}`,
      featureDef(harderThan.key),
      h.outcome,
      v.cmp.diff,
      null,
      t,
    );
    insight.title = said.title;
    insight.line = `${line}${said.tail}`;
    insight.strength = below(insight.strength, harderThan.strength);
  } else if (words) {
    const allowed = new Set(
      [title, line, fix.text, occasion, ...steps.flatMap((s) => [s.label, s.value])].flatMap(numbersIn),
    );
    if (wordsProblems(words, allowed).length === 0) {
      insight.title = words.title;
      insight.line = words.line;
      // A fix with a one tap action keeps the words the action was made for.
      if (!fix.action) insight.fix = { ...fix, text: words.fix };
    }
  }
  return { insight, plan, features };
}
