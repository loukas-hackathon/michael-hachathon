import { median } from "../patterns/util";
import { FEATURES, type FeatureDef, featureDef } from "./dictionary";
import type { FeatureKey, FeatureTable } from "./features";
import { benjaminiHochberg, clamp01, hash, mean, permutationP, pooledSd, sd, spearman } from "./stats";

// The miner: every sensible ordered pair of columns, same day and next day, split into the days
// the trigger was there and the days it was not, compared, and kept only when it clears a strict
// bar. Nothing here knows which relations exist. The dictionary says which pairs make sense to
// ask about (what can come first, what can follow); the data says which of them hold.

export const MINER_RULES = {
  /** Times the trigger, and its absence, must be seen before a relation can be a pattern. */
  needed: 4,
  /** Days of data before anything is called a pattern. */
  minDays: 14,
  /** At most this share of the surviving pairs may be chance (Benjamini and Hochberg). */
  falseDiscoveryRate: 0.02,
  /** The two sides differ by at least this many standard deviations. */
  minEffect: 0.6,
  /** The outcome moved the same way on at least this share of the trigger days. */
  minHeld: 0.65,
  /** A chain's direct step (first to last) is one named comparison: this plain bar. */
  chainP: 0.05,
  minChainHeld: 0.6,
  /**
   * Watching: the outcome moved by at least this many deviations of the other days. A trigger
   * seen two or three times must also have moved it every time, and further.
   */
  watchEffect: 0.8,
  watchEffectRare: 1.5,
  watchHeld: 0.75,
  /** Two triggers on at least this share of the same days tell one story. */
  sameStory: 0.6,
  historyCap: 30,
  maxPatterns: 8,
  maxWatching: 3,
} as const;

/**
 * The relations worth watching before there is enough to test them: a rare trigger, or the first
 * days of data. Candidates only. Whether one shows, which way it points and every number in it
 * come from the data, and none of them is a pattern until it passes the same bar as every other pair.
 */
export const WATCH_CANDIDATES: ReadonlySet<string> = new Set([
  "late_phone_min>sleep_score@1",
  "late_phone_min>first_block_lost_min@1",
  "late_phone_min>lost_min@1",
  "phone_before_sleep_min>sleep_score@1",
  "late_streak>recovery@1",
  "late_streak>hrv@1",
  "late_streak>lost_min@1",
  "short_night>lost_min@0",
  "short_night>first_block_lost_min@0",
  "sleep_score>lost_min@0",
  "sleep_score>first_block_lost_min@0",
  "trained>deep_min@1",
  "trained>sleep_score@1",
  "evening_workout>sleep_score@1",
  "heavy_meeting_day>lost_min@0",
  "heavy_meeting_day>hrv@1",
  "caffeine_last_min>sleep_score@1",
]);

/** A fixed seed for every shuffle, mixed with the pair's name: same events in, same insights out. */
const SEED = 20261115;

export interface Trigger {
  key: FeatureKey;
  side: "high" | "low";
  /** Null for a flag (it happened or it did not). */
  threshold: number | null;
  /** True when the threshold itself counts as the trigger ("30 minutes or more"). */
  inclusive: boolean;
  /** Per day: the trigger was there, was not, or there is no reading. */
  on: (boolean | null)[];
}

export interface Occurrence {
  day: string;
  held: boolean;
}

export interface Comparison {
  /** Days the trigger was there, and days it was not, with an outcome to read. */
  seen: number;
  other: number;
  triggerMean: number;
  otherMean: number;
  /** triggerMean - otherMean. */
  diff: number;
  /** The same difference in standard deviations of the two sides. */
  effect: number;
  /** The typical outcome without the trigger: what "it held" is measured against. */
  otherMedian: number;
  held: number;
  occurrences: Occurrence[];
}

export interface Link {
  x: Trigger;
  y: FeatureKey;
  lag: 0 | 1 | 2;
  cmp: Comparison;
  /** The trigger's own figure on the two sides (null for a flag). */
  xMeans: { trigger: number; other: number } | null;
  p: number;
  strength: number;
}

export interface Chain {
  x: Trigger;
  y: FeatureKey;
  z: FeatureKey;
  lagXY: 0 | 1;
  lagYZ: 0 | 1;
  first: Link;
  second: Link;
  direct: Link;
  /** Trigger days with both later readings; held when both moved the way the links say. */
  occurrences: Occurrence[];
  held: number;
  strength: number;
}

export interface Mined {
  links: Link[];
  chains: Chain[];
  watching: Link[];
  /** How many pairs had enough days on both sides to be tested. */
  tested: number;
}

const present = (v: number | null | undefined): v is number => v !== null && v !== undefined;

/** The days a cause's trigger was there. A fixed threshold when it splits the days, else the median. */
export function triggerOf(
  table: FeatureTable,
  def: FeatureDef,
  needed: number = MINER_RULES.needed,
): Trigger | null {
  const cause = def.cause;
  if (!cause) return null;
  const values = table.cols[def.key];
  const known = values.filter(present);
  if (known.length === 0) return null;
  if (def.format === "flag") {
    return {
      key: def.key,
      side: "high",
      threshold: null,
      inclusive: true,
      on: values.map((v) => (present(v) ? v >= 1 : null)),
    };
  }
  const split = (threshold: number, inclusive: boolean): Trigger => ({
    key: def.key,
    side: cause.side,
    threshold,
    inclusive,
    on: values.map((v) =>
      !present(v)
        ? null
        : cause.side === "high"
          ? inclusive
            ? v >= threshold
            : v > threshold
          : v < threshold,
    ),
  });
  const sides = (t: Trigger) => {
    const on = t.on.filter((v) => v === true).length;
    return Math.min(on, t.on.filter((v) => v === false).length);
  };
  const own = split(median(known), false);
  if (cause.at === undefined) return own;
  const fixed = split(cause.at, true);
  // The usual threshold, unless this person all but never crosses it (or always does) and their
  // own median still splits the days. Crossed two or three times, it stays: that is watched.
  return sides(fixed) < 2 && sides(own) >= needed ? own : fixed;
}

/**
 * The outcome on the days the trigger was there against the days it was not. `lag` days lie
 * between the trigger and the outcome. `direction` fixes which way counts as "held"; without it
 * the way the means differ decides.
 */
export function compare(
  table: Pick<FeatureTable, "days">,
  on: (boolean | null)[],
  outcome: (number | null)[],
  lag: number,
  direction?: 1 | -1,
): { cmp: Comparison; a: number[]; b: number[] } {
  const a: number[] = [];
  const b: number[] = [];
  const seenOn: { day: string; y: number }[] = [];
  for (let i = 0; i + lag < table.days.length; i++) {
    const t = on[i];
    const y = outcome[i + lag];
    if (t === null || t === undefined || !present(y)) continue;
    if (t) {
      a.push(y);
      seenOn.push({ day: table.days[i] ?? "", y });
    } else b.push(y);
  }
  const triggerMean = mean(a);
  const otherMean = mean(b);
  const diff = triggerMean - otherMean;
  const spread = pooledSd(a, b);
  const otherMedian = median(b);
  const way = direction ?? (diff >= 0 ? 1 : -1);
  const occurrences = seenOn.map((o) => ({
    day: o.day,
    held: b.length > 0 && (way > 0 ? o.y > otherMedian : o.y < otherMedian),
  }));
  return {
    cmp: {
      seen: a.length,
      other: b.length,
      triggerMean,
      otherMean,
      diff,
      effect: spread > 0 ? diff / spread : 0,
      otherMedian,
      held: occurrences.filter((o) => o.held).length,
      occurrences,
    },
    a,
    b,
  };
}

/**
 * 0 to 1: half how often it held, half how far apart the two sides are. The distance counts less
 * the larger it gets (1 deviation is 0.49, 2 are 0.74, 4 are 0.93), so it never simply saturates.
 */
export const strengthOf = (held: number, seen: number, effect: number): number =>
  seen === 0
    ? 0
    : Math.round(clamp01(0.5 * (held / seen) + 0.5 * (1 - Math.exp(-Math.abs(effect) / 1.5))) * 100) / 100;

/** Whether asking "x, then y" makes sense: x can come first, y can follow, and they are different things. */
export function sensible(x: FeatureDef, y: FeatureDef, lag: number): boolean {
  if (!x.cause || !y.outcome || x.family === y.family || x.key === y.key) return false;
  if (lag >= 1) return true;
  // The same day: only when x is known before y, or both happen through the day.
  return x.phase < y.phase || (x.phase === 2 && y.phase === 2);
}

function linkOf(table: FeatureTable, x: Trigger, y: FeatureKey, lag: 0 | 1 | 2, direction?: 1 | -1) {
  const { cmp, a, b } = compare(table, x.on, table.cols[y], lag, direction);
  const xs = table.cols[x.key];
  const tx: number[] = [];
  const ox: number[] = [];
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i + lag < table.days.length; i++) {
    const t = x.on[i];
    const xv = xs[i];
    const yv = table.cols[y][i + lag];
    if (t === null || t === undefined || !present(xv) || !present(yv)) continue;
    (t ? tx : ox).push(xv);
    px.push(xv);
    py.push(yv);
  }
  return { cmp, a, b, tx, ox, px, py };
}

const pairSeed = (x: Trigger, y: FeatureKey, lag: number) => (SEED ^ hash(`${x.key}>${y}@${lag}`)) >>> 0;

function toLink(
  x: Trigger,
  y: FeatureKey,
  lag: 0 | 1 | 2,
  built: ReturnType<typeof linkOf>,
  p: number,
): Link {
  const { cmp, tx, ox } = built;
  return {
    x,
    y,
    lag,
    cmp,
    xMeans: x.threshold === null ? null : { trigger: mean(tx), other: mean(ox) },
    p,
    strength: strengthOf(cmp.held, cmp.seen, cmp.effect),
  };
}

/** Keep the strongest of the entries that say the same thing. */
function strongestPer<T extends { strength: number }>(list: T[], sameAs: (item: T) => string): T[] {
  const best = new Map<string, T>();
  for (const item of [...list].sort((a, b) => b.strength - a.strength)) {
    const key = sameAs(item);
    if (!best.has(key)) best.set(key, item);
  }
  return [...best.values()];
}

const familyOf = (key: FeatureKey) => featureDef(key).family;

/** How much two triggers fall on the same days, 0 to 1, allowing one day's shift either way. */
function sameDays(a: (boolean | null)[], b: (boolean | null)[]): number {
  let best = 0;
  for (const shift of [-1, 0, 1]) {
    let both = 0;
    let either = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] === true;
      const y = b[i + shift] === true;
      if (x && y) both++;
      if (x || y) either++;
    }
    if (either > 0) best = Math.max(best, both / either);
  }
  return best;
}

/** Local days with any reading at all. */
export const studiedDays = (table: FeatureTable): number =>
  table.days.filter((_, i) => Object.values(table.cols).some((col) => present(col[i]))).length;

/** The table in, what holds out. Pure and seeded. */
export function mine(table: FeatureTable): Mined {
  const R = MINER_RULES;
  const causes = FEATURES.flatMap((def) => {
    const trigger = triggerOf(table, def);
    return trigger ? [{ def, trigger }] : [];
  });
  const outcomes = FEATURES.filter((f) => f.outcome);
  const studied = studiedDays(table);

  interface Tested {
    link: Link;
    rho: number;
  }
  const tested: Tested[] = [];
  const rare: Link[] = [];
  for (const { def: x, trigger } of causes) {
    for (const y of outcomes) {
      for (const lag of [0, 1] as const) {
        if (!sensible(x, y, lag)) continue;
        const built = linkOf(table, trigger, y.key, lag);
        const { cmp, a, b } = built;
        if (cmp.seen >= R.needed && cmp.other >= R.needed) {
          if (sd([...a, ...b]) === 0) continue;
          const p = permutationP(a, b, pairSeed(trigger, y.key, lag));
          tested.push({ link: toLink(trigger, y.key, lag, built, p), rho: spearman(built.px, built.py) });
        }
        // Too rare to test, or too early to call: a candidate is watched when the outcome moved
        // far, and every time while it has been seen fewer times than a pattern needs.
        const early = cmp.seen < R.needed || cmp.other < R.needed || studied < R.minDays;
        if (early && cmp.seen >= 2 && cmp.other >= 2 && WATCH_CANDIDATES.has(`${x.key}>${y.key}@${lag}`)) {
          const spread = sd(b);
          const heldEnough = cmp.seen < R.needed ? cmp.held === cmp.seen : cmp.held / cmp.seen >= R.watchHeld;
          const far = cmp.seen < R.needed ? R.watchEffectRare : R.watchEffect;
          if (heldEnough && spread > 0 && Math.abs(cmp.diff) >= far * spread) {
            rare.push(toLink(trigger, y.key, lag, built, 1));
          }
        }
      }
    }
  }

  // The bar. The more pairs were tested, the smaller a pair's chance value must be.
  const passes = benjaminiHochberg(
    tested.map((t) => t.link.p),
    R.falseDiscoveryRate,
  );
  const found = (studied < R.minDays ? [] : tested)
    .filter((t, i) => {
      const { link, rho } = t;
      if (!passes[i]) return false;
      if (Math.abs(link.cmp.effect) < R.minEffect) return false;
      if (link.cmp.held / link.cmp.seen < R.minHeld) return false;
      // The rank correlation over all the days must point the same way as the two sides do.
      if (link.x.threshold === null) return true;
      const expected = Math.sign(link.cmp.diff) * (link.x.side === "high" ? 1 : -1);
      return rho * expected > 0;
    })
    .map((t) => t.link);

  // Chains: x then y, y then z, and x then z all hold.
  const chains: Chain[] = [];
  for (const first of found) {
    if (first.lag > 1) continue;
    for (const second of found) {
      if (second.lag > 1 || second.x.key !== first.y) continue;
      // The second link must start from the side the first one lands on.
      const landsLow = first.cmp.diff < 0;
      if ((second.x.side === "low") !== landsLow) continue;
      if (familyOf(second.y) === familyOf(first.x.key)) continue;
      const lag = (first.lag + second.lag) as 0 | 1 | 2;
      const way = second.cmp.diff >= 0 ? 1 : -1;
      const built = linkOf(table, first.x, second.y, lag, way);
      const { cmp, a, b } = built;
      if (cmp.seen < R.needed || cmp.other < R.needed || Math.sign(cmp.diff) !== way) continue;
      const p = permutationP(a, b, pairSeed(first.x, second.y, lag));
      if (p > R.chainP) continue;
      const direct = toLink(first.x, second.y, lag, built, p);
      const ys = table.cols[first.y];
      const zs = table.cols[second.y];
      const occurrences: Occurrence[] = [];
      for (let i = 0; i + lag < table.days.length; i++) {
        const y = ys[i + first.lag];
        const z = zs[i + lag];
        if (first.x.on[i] !== true || !present(y) || !present(z)) continue;
        const yHeld = first.cmp.diff >= 0 ? y > first.cmp.otherMedian : y < first.cmp.otherMedian;
        const zHeld = way > 0 ? z > cmp.otherMedian : z < cmp.otherMedian;
        occurrences.push({ day: table.days[i] ?? "", held: yHeld && zHeld });
      }
      const held = occurrences.filter((o) => o.held).length;
      if (occurrences.length < R.needed || held / occurrences.length < R.minChainHeld) continue;
      chains.push({
        x: first.x,
        y: first.y,
        z: second.y,
        lagXY: first.lag as 0 | 1,
        lagYZ: second.lag as 0 | 1,
        first,
        second,
        direct,
        occurrences,
        held,
        strength: strengthOf(
          held,
          occurrences.length,
          Math.min(Math.abs(first.cmp.effect), Math.abs(direct.cmp.effect)),
        ),
      });
    }
  }
  // One chain per kind of trigger. The strongest; between equals, the one that crosses the most
  // sources, then the one whose middle step comes soonest after the trigger.
  const reach = (c: Chain) => new Set([c.x.key, c.y, c.z].flatMap((k) => featureDef(k).sources)).size;
  const ranked = [...chains].sort(
    (a, b) =>
      b.strength - a.strength ||
      reach(b) - reach(a) ||
      featureDef(a.y).phase - featureDef(b.y).phase ||
      (`${a.x.key}>${a.y}>${a.z}` < `${b.x.key}>${b.y}>${b.z}` ? -1 : 1),
  );
  const keptChains: Chain[] = [];
  for (const c of ranked) {
    if (!keptChains.some((k) => familyOf(k.x.key) === familyOf(c.x.key))) keptChains.push(c);
  }

  // A link a chain already tells is not told twice.
  const told = new Set(
    keptChains.flatMap((c) => [
      `${familyOf(c.x.key)}>${familyOf(c.y)}`,
      `${familyOf(c.y)}>${familyOf(c.z)}`,
      `${familyOf(c.x.key)}>${familyOf(c.z)}`,
    ]),
  );
  const pairKey = (l: Link) => `${familyOf(l.x.key)}>${familyOf(l.y)}`;
  const freeLinks = strongestPer(found, pairKey).filter((l) => !told.has(pairKey(l)));

  // The same story told from another column is told once: two triggers that fall on the same
  // days (or the day after, like a short night after a late one) and end in the same kind of
  // outcome are one finding. The strongest stays; a chain stays before a link of equal strength.
  interface Story {
    on: (boolean | null)[];
    ends: string[];
    strength: number;
    chain?: Chain;
    link?: Link;
  }
  const stories: Story[] = [
    ...keptChains.map(
      (c): Story => ({ on: c.x.on, ends: [familyOf(c.y), familyOf(c.z)], strength: c.strength, chain: c }),
    ),
    ...freeLinks.map((l): Story => ({ on: l.x.on, ends: [familyOf(l.y)], strength: l.strength, link: l })),
  ].sort((a, b) => b.strength - a.strength || Number(Boolean(b.chain)) - Number(Boolean(a.chain)));
  const kept: Story[] = [];
  const retold = (s: Story) =>
    kept.some((k) => k.ends.some((e) => s.ends.includes(e)) && sameDays(k.on, s.on) >= R.sameStory);
  for (const s of stories) if (!retold(s)) kept.push(s);
  const finalChains = kept.flatMap((s) => (s.chain ? [s.chain] : []));
  const links = kept.flatMap((s) => (s.link ? [s.link] : []));
  const shownPairs = new Set([...told, ...links.map(pairKey)]);
  const watching: Link[] = [];
  for (const l of strongestPer(rare, pairKey).sort((a, b) => b.strength - a.strength)) {
    const story = { on: l.x.on, ends: [familyOf(l.y)], strength: l.strength, link: l };
    if (shownPairs.has(pairKey(l)) || retold(story) || watching.length >= R.maxWatching) continue;
    watching.push(l);
  }

  return { links, chains: finalChains, watching, tested: tested.length };
}
