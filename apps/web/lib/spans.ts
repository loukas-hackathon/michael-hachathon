/** Total length of a set of [start, end] spans in ms, overlaps counted once. Empty spans add nothing. */
export function unionMs(spans: readonly (readonly [number, number])[]): number {
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (e <= s) continue;
    if (cur && s <= cur[1]) cur[1] = Math.max(cur[1], e);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [s, e];
    }
  }
  return cur ? total + cur[1] - cur[0] : total;
}
