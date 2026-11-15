import { z } from "zod";
import { median } from "../patterns/util";
import { featureDef } from "./dictionary";
import { FEATURE_KEYS, type FeatureKey, type FeatureTable } from "./features";
import { type Comparison, compare, MINER_RULES, strengthOf, studiedDays } from "./miner";
import { hash, passFalseDiscovery, permutationP } from "./stats";

// The small, safe grammar a hypothesis is written in. The model may propose any test it can say
// in these words; it can never state a result. The server reads the test, builds the trigger from
// the daily table, and judges it with the miner's own statistics and bar.
//
//   when:      a column, an optional transform, at or above / at or below a threshold
//              (null for a plain weekday effect)
//   and:       a second condition that must hold on the same day (an interaction), or null
//   weekdays:  only these weekdays count as trigger days, or null
//   outcome:   a column, read `lag` days after the trigger (0, 1 or 2)
//   direction: which way the outcome is expected to move on trigger days
//
// Transforms: the value the day before (lag1) or two days before (lag2), the mean of the last 3
// or 7 days (rolling3, rolling7), or the condition holding 2 or 3 days running (streak2, streak3).
// A null threshold means the person's own median of that (transformed) column.

export const TRANSFORMS = ["none", "lag1", "lag2", "rolling3", "rolling7", "streak2", "streak3"] as const;
export type Transform = (typeof TRANSFORMS)[number];

const Feature = z.enum(FEATURE_KEYS);

export const Condition = z.object({
  feature: Feature,
  transform: z.enum(TRANSFORMS),
  op: z.enum([">=", "<="]),
  threshold: z.number().finite().nullable(),
});
export type Condition = z.infer<typeof Condition>;

export const Hypothesis = z
  .object({
    // Null for a plain weekday effect: the weekdays alone are the trigger.
    when: Condition.nullable(),
    and: Condition.nullable(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(6).nullable(),
    outcome: Feature,
    lag: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    direction: z.enum(["higher", "lower"]),
  })
  .refine((h) => h.when !== null || (h.weekdays !== null && h.and === null), "A trigger is needed");
export type Hypothesis = z.infer<typeof Hypothesis>;

const conditionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["feature", "transform", "op", "threshold"],
  properties: {
    feature: { type: "string", enum: [...FEATURE_KEYS] },
    transform: { type: "string", enum: [...TRANSFORMS] },
    op: { type: "string", enum: [">=", "<="] },
    threshold: {
      anyOf: [{ type: "number" }, { type: "null" }],
      description:
        "In the column's own unit. null = the person's own median. For a flag use 1 with >=, or 0 with <=.",
    },
  },
} as const;

/** The schema the model's hypotheses are held to (structured outputs). */
export const HYPOTHESES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hypotheses"],
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["when", "and", "weekdays", "outcome", "lag", "direction", "why"],
        properties: {
          when: {
            anyOf: [conditionSchema, { type: "null" }],
            description: "null only for a plain weekday effect (then give weekdays, and leave `and` null).",
          },
          and: { anyOf: [conditionSchema, { type: "null" }] },
          weekdays: {
            anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
            description: "0 = Sunday .. 6 = Saturday. null = every day.",
          },
          outcome: { type: "string", enum: [...FEATURE_KEYS] },
          lag: { type: "integer", enum: [0, 1, 2] },
          direction: { type: "string", enum: ["higher", "lower"] },
          why: { type: "string", description: "One short sentence: why this might hold. Never a number." },
        },
      },
    },
  },
} as const;

const present = (v: number | null | undefined): v is number => v !== null && v !== undefined;

/** A column after its transform (streaks are handled with the condition, so they pass through). */
export function transformed(values: (number | null)[], transform: Transform): (number | null)[] {
  const back = transform === "lag1" ? 1 : transform === "lag2" ? 2 : 0;
  if (back > 0) return values.map((_, i) => (i - back >= 0 ? (values[i - back] ?? null) : null));
  const span = transform === "rolling3" ? 3 : transform === "rolling7" ? 7 : 0;
  if (span === 0) return values;
  return values.map((_, i) => {
    const window = values.slice(Math.max(0, i - span + 1), i + 1).filter(present);
    // A mean of the last days needs most of them.
    if (i < span - 1 || window.length < Math.ceil(span / 2)) return null;
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
}

export interface ReadCondition {
  /** Per day: holds, does not, or cannot be told. */
  on: (boolean | null)[];
  /** The threshold used (the given one, or the median). */
  threshold: number;
  /** The column the threshold was held against. */
  values: (number | null)[];
}

export function readCondition(table: FeatureTable, c: Condition): ReadCondition | null {
  const values = transformed(table.cols[c.feature], c.transform);
  const known = values.filter(present);
  if (known.length === 0) return null;
  // A time of day is held on the quarter hour, as the late cut off is: the words say "20:45" and
  // the test counts exactly the days the words describe.
  const raw = c.threshold ?? median(known);
  const threshold = featureDef(c.feature).format === "clock" ? Math.round(raw / 15) * 15 : raw;
  const base = values.map((v) => (present(v) ? (c.op === ">=" ? v >= threshold : v <= threshold) : null));
  const run = c.transform === "streak2" ? 2 : c.transform === "streak3" ? 3 : 1;
  if (run === 1) return { on: base, threshold, values };
  const on = base.map((v, i) => {
    if (v === null) return null;
    if (!v) return false;
    for (let k = 1; k < run; k++) {
      const before = i - k >= 0 ? base[i - k] : null;
      if (before === null || before === undefined) return null;
      if (!before) return false;
    }
    return true;
  });
  return { on, threshold, values };
}

/** The same test written the same way, whoever proposed it: the stable part of the insight's id. */
export function canonical(h: Hypothesis): string {
  const cond = (c: Condition) =>
    `${c.feature}${c.transform === "none" ? "" : `~${c.transform}`}${c.op}${c.threshold === null ? "median" : c.threshold}`;
  const days = h.weekdays ? `@d${[...new Set(h.weekdays)].sort().join("")}` : "";
  return `${h.when ? cond(h.when) : "weekday"}${h.and ? `&${cond(h.and)}` : ""}${days}>${h.outcome}+${h.lag}`;
}

export interface Verified {
  hypothesis: Hypothesis;
  key: string;
  /** Null for a plain weekday effect. */
  when: ReadCondition | null;
  and: ReadCondition | null;
  on: (boolean | null)[];
  cmp: Comparison;
  p: number;
  /** The two sides, kept so the chance value can be looked at deeper when the bar needs it. */
  sides: { a: number[]; b: number[]; seed: number };
  strength: number;
}

/**
 * One hypothesis against the table: the trigger days, the comparison and its chance value. Null
 * when it cannot be read or tested (a column with no data, too few days on a side, a test of a
 * column against itself). Passing the bar is decided over all of them together (`verify`).
 */
export function evaluate(table: FeatureTable, raw: unknown): Verified | null {
  const parsed = Hypothesis.safeParse(raw);
  if (!parsed.success) return null;
  const h = parsed.data;
  const R = MINER_RULES;
  // A column says nothing about itself or its own family on the same day.
  const sameFamily = (f: FeatureKey) => featureDef(f).family === featureDef(h.outcome).family;
  if ((h.when && sameFamily(h.when.feature)) || (h.and && sameFamily(h.and.feature))) return null;
  const when = h.when ? readCondition(table, h.when) : null;
  const and = h.and ? readCondition(table, h.and) : null;
  if ((h.when && !when) || (h.and && !and)) return null;
  const days = h.weekdays ? new Set(h.weekdays) : null;
  const on = table.days.map((_, i) => {
    if (days && !days.has(table.weekdays[i] ?? -1)) return false;
    const w = when ? when.on[i] : true;
    const a = and ? and.on[i] : true;
    if (w === false || a === false) return false;
    return w === null || w === undefined || a === null || a === undefined ? null : true;
  });
  const way = h.direction === "higher" ? 1 : -1;
  const { cmp, a, b } = compare(table, on, table.cols[h.outcome], h.lag, way);
  if (cmp.seen < R.needed || cmp.other < R.needed) return null;
  const key = canonical(h);
  return {
    hypothesis: h,
    key,
    when,
    and,
    on,
    cmp,
    p: permutationP(a, b, hash(`discovered:${key}`)),
    sides: { a, b, seed: hash(`discovered:${key}`) },
    strength: strengthOf(cmp.held, cmp.seen, cmp.effect),
  };
}

/**
 * The hypotheses the data supports, strongest first. The bar is the miner's own: enough days, the
 * same false discovery rate counted over every pair the miner tested plus every hypothesis (so
 * asking more questions never makes any of them easier to pass), the same distance between the
 * sides, the same share of trigger days held, and the direction the hypothesis named.
 */
export function verify(table: FeatureTable, minerPs: number[], hypotheses: unknown[]): Verified[] {
  const R = MINER_RULES;
  if (studiedDays(table) < R.minDays) return [];
  const seen = new Set<string>();
  const read = hypotheses.flatMap((raw) => {
    const v = evaluate(table, raw);
    if (!v || seen.has(v.key)) return [];
    seen.add(v.key);
    return [v];
  });
  const family = [...minerPs.map((p) => ({ p })), ...read.map((v) => ({ p: v.p, sides: v.sides }))];
  const passes = passFalseDiscovery(family, R.falseDiscoveryRate).slice(minerPs.length);
  read.forEach((v, i) => {
    v.p = family[minerPs.length + i]?.p ?? v.p;
  });
  return read
    .filter((v, i) => {
      const way = v.hypothesis.direction === "higher" ? 1 : -1;
      return (
        passes[i] &&
        Math.sign(v.cmp.diff) === way &&
        Math.abs(v.cmp.effect) >= R.minEffect &&
        v.cmp.held / v.cmp.seen >= R.minHeld
      );
    })
    .sort((a, b) => b.strength - a.strength || (a.key < b.key ? -1 : 1));
}
