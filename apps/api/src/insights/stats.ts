// The statistics the miner and the discovery pass share. Pure and seeded: the same numbers in
// give the same numbers out, on any machine.

export const mean = (v: number[]) => (v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length);

/** Sample standard deviation. 0 for fewer than two values. */
export function sd(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / (v.length - 1));
}

/** The two sides' spread as one figure, for the size of a difference in standard deviations. */
export function pooledSd(a: number[], b: number[]): number {
  const df = a.length + b.length - 2;
  if (df <= 0) return 0;
  return Math.sqrt(((a.length - 1) * sd(a) ** 2 + (b.length - 1) * sd(b) ** 2) / df);
}

/** A small seeded generator (mulberry32): the permutation test must not depend on Math.random. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable number from a string (FNV-1a), so every comparison gets its own repeatable shuffle. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const ranks = (v: number[]): number[] => {
  const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(v.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.[0] === order[i]?.[0]) j++;
    // Ties share the middle rank.
    for (let k = i; k <= j; k++) out[order[k]?.[1] ?? 0] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
};

/** Spearman's rank correlation, -1 to 1. 0 when either side does not vary. */
export function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  const rx = ranks(x);
  const ry = ranks(y);
  const sx = sd(rx);
  const sy = sd(ry);
  if (sx === 0 || sy === 0) return 0;
  const mx = mean(rx);
  const my = mean(ry);
  let cov = 0;
  for (let i = 0; i < rx.length; i++) cov += ((rx[i] ?? 0) - mx) * ((ry[i] ?? 0) - my);
  return cov / (rx.length - 1) / (sx * sy);
}

export const PERMUTATIONS = { first: 200, second: 2000, usual: 10_000, deep: 50_000 } as const;

/**
 * How often a shuffle of the days gives a difference in means at least as large as the one seen
 * (two sided). Stops early once the answer is settled: after 200 or 2,000 shuffles with 20 or
 * more as large, the value is known well enough and the remaining shuffles are saved. Up to
 * 10,000 shuffles as a rule, so the smallest value is 1 / 10,001; `deep` runs 50,000 for a
 * difference no shuffle has matched yet, when that floor is not small enough to decide
 * (`passFalseDiscovery`).
 */
export function permutationP(a: number[], b: number[], seed: number, deep = false): number {
  if (a.length === 0 || b.length === 0) return 1;
  const all = [...a, ...b];
  const total = all.reduce((t, x) => t + x, 0);
  const na = a.length;
  const nb = b.length;
  const observed = Math.abs(mean(a) - mean(b));
  // The same comparison up to rounding: a shuffle that reproduces the data must count.
  const bar = observed - 1e-9;
  const next = seeded(seed);
  let asLarge = 0;
  let done = 0;
  const run = (until: number) => {
    for (; done < until; done++) {
      // A partial Fisher-Yates shuffle: the first `na` places are a random side A.
      let sumA = 0;
      for (let i = 0; i < na; i++) {
        const j = i + Math.floor(next() * (all.length - i));
        const picked = all[j] ?? 0;
        all[j] = all[i] ?? 0;
        all[i] = picked;
        sumA += picked;
      }
      if (Math.abs(sumA / na - (total - sumA) / nb) >= bar) asLarge++;
    }
  };
  run(PERMUTATIONS.first);
  if (asLarge < 20) run(PERMUTATIONS.second);
  if (asLarge < 20) run(PERMUTATIONS.usual);
  if (deep && asLarge < 5) run(PERMUTATIONS.deep);
  return (asLarge + 1) / (done + 1);
}

/**
 * Benjamini and Hochberg: which of many comparisons survive when at most a share `q` of the
 * survivors may be chance. The more pairs are tested, the smaller a value must be to pass.
 */
export function benjaminiHochberg(ps: number[], q: number): boolean[] {
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  let cut = -1;
  for (let k = 0; k < order.length; k++) {
    if ((order[k]?.[0] ?? 1) <= (q * (k + 1)) / order.length) cut = k;
  }
  const out = new Array<boolean>(ps.length).fill(false);
  for (let k = 0; k <= cut; k++) out[order[k]?.[1] ?? 0] = true;
  return out;
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** One comparison in a family: its chance value, and its two sides when it can be looked at deeper. */
export interface FamilyTest {
  p: number;
  sides?: { a: number[]; b: number[]; seed: number };
}

/**
 * Which comparisons of a family pass the false discovery bar. 10,000 shuffles cannot give a value
 * under 1 / 10,001, and among several hundred pairs a single true relation needs less than that.
 * So a comparison that no shuffle matched and that still fails is shuffled 50,000 times, and the
 * bar is applied again. Only those few are: the rest keep their value. Updates `p` in place.
 */
export function passFalseDiscovery(tests: FamilyTest[], q: number): boolean[] {
  const floor = 1 / (PERMUTATIONS.usual + 1);
  let passes = benjaminiHochberg(
    tests.map((t) => t.p),
    q,
  );
  const stuck = tests.filter((t, i) => !passes[i] && t.sides && t.p <= floor * 1.0001);
  if (stuck.length === 0) return passes;
  for (const t of stuck) if (t.sides) t.p = permutationP(t.sides.a, t.sides.b, t.sides.seed, true);
  passes = benjaminiHochberg(
    tests.map((t) => t.p),
    q,
  );
  return passes;
}
