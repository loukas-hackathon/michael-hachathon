import { currentUserId } from "./context";
import { writeVersion } from "./writes";

// A short per user memo of computed results (#298): the score, the patterns and the moments are
// asked for many times a minute (Today alone reads the score three times) and each one reads weeks
// of events. A result is reused only while the user's write version (writes.ts, bumped by the
// store before and after every write) is the one it was computed under, and for at most its time
// to live, so a write through the store (an event, a log, a block, a goal) is seen by the very
// next read. Callers asking at the same moment share one computation. One API instance
// (railway.json), so in process.

interface Entry {
  version: string;
  at: number;
  value: Promise<unknown>;
}

const entries = new Map<string, Entry>();
const MAX_ENTRIES = 300;
let stats = { hits: 0, misses: 0 };

/**
 * `compute()` once per user, name and args while nothing of the user's was written and `ttlMs` has
 * not passed. A failure is never kept. Each caller gets its own deep copy.
 */
export function memo<T>(name: string, args: unknown, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const userId = currentUserId();
  const key = `${userId}|${name}|${JSON.stringify(args ?? null)}`;
  // Taken before the work starts: a write that lands meanwhile leaves the entry stale.
  const version = writeVersion(userId);
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.version === version && now - hit.at < ttlMs) {
    stats.hits++;
    // Most recently used last, so eviction drops the oldest.
    entries.delete(key);
    entries.set(key, hit);
    return hit.value.then((v) => structuredClone(v) as T);
  }
  stats.misses++;
  const value = compute();
  const entry: Entry = { version, at: now, value };
  entries.set(key, entry);
  value.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return value.then((v) => structuredClone(v));
}

/** Hits and misses since the start (or the last reset), for tests and timing. */
export const memoStats = () => ({ ...stats, entries: entries.size });

/** Tests only: forget everything. */
export function resetMemo(): void {
  entries.clear();
  stats = { hits: 0, misses: 0 };
}
