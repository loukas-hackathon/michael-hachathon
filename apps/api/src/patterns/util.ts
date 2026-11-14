import type { PatternSubject } from "@michael/shared";
import { MINUTE } from "./time";

export interface Span {
  start: number;
  end: number;
}

export const length = (s: Span) => s.end - s.start;

/** Middle value. Callers check the sample size first: this returns 0 for an empty list. */
export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/** Quantile with linear interpolation between neighbours. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Never divides by zero: an empty denominator gives 0. */
export const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round2 = (n: number) => Math.round(n * 100) / 100;
/** Milliseconds to minutes with one decimal. */
export const mins = (ms: number) => round1(ms / MINUTE);
/** Milliseconds to whole seconds. */
export const secs = (ms: number) => Math.round(ms / 1000);

/** Merge overlapping or touching spans. Input order does not matter. */
export function union(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

export const unionLength = (spans: Span[]) => sum(union(spans).map(length));

/** The parts of [start, end) not covered by `holes` (which must be merged and sorted). */
export function subtractSpans(span: Span, holes: Span[]): Span[] {
  const out: Span[] = [];
  let cursor = span.start;
  for (const h of holes) {
    if (h.end <= cursor) continue;
    if (h.start >= span.end) break;
    if (h.start > cursor) out.push({ start: cursor, end: h.start });
    cursor = Math.max(cursor, h.end);
    if (cursor >= span.end) break;
  }
  if (cursor < span.end) out.push({ start: cursor, end: span.end });
  return out;
}

/** Time of [start, end) covered by `spans` (merged and sorted). */
export function overlapWith(span: Span, spans: Span[]): number {
  let total = 0;
  for (const s of spans) {
    if (s.end <= span.start) continue;
    if (s.start >= span.end) break;
    total += Math.min(s.end, span.end) - Math.max(s.start, span.start);
  }
  return total;
}

/** First index whose `start` is >= t, in a list sorted by start. */
export function lowerBound<T extends { start: number }>(list: T[], t: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid]?.start ?? Number.POSITIVE_INFINITY) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const iso = (ms: number) => new Date(ms).toISOString();

/** Keep the first `cap` distinct ids, in order. */
export function capIds(ids: Iterable<string>, cap = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

export const subjectId = (s: PatternSubject) => `${s.kind}:${s.key}`;

/** Count things per key and return the entries, largest first. */
export function tally<K>(keys: Iterable<K>): [K, number][] {
  const counts = new Map<K, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function add<K>(map: Map<K, number>, key: K, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}
