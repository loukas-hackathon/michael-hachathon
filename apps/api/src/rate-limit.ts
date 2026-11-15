// A small in-memory limiter: at most `max` hits per `windowMs` per key. One API process holds it,
// which is all we run; a restart forgets it, which is fine for a guard against runaway clients.
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    /** Records a hit and says whether it is allowed. Refused hits are not counted. */
    take(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // Keep the map small: drop keys whose hits have all expired.
      if (hits.size > 5000) {
        for (const [k, ts] of hits) if (!ts.some((t) => t > now - windowMs)) hits.delete(k);
      }
      return true;
    },
    reset(): void {
      hits.clear();
    },
  };
}
