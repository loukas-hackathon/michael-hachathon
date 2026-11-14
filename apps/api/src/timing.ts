import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Per request counters for the Server-Timing header (#234): how many database (and Supabase Auth)
// round trips a request made and how long they took. Every round trip from Railway to Supabase
// costs about 90 to 100 ms, so the count is the number to keep small.

export interface RequestTiming {
  dbCount: number;
  /** Summed duration of the round trips; parallel ones overlap, so this can exceed the wall time. */
  dbMs: number;
  authMs: number;
}

const timing = new AsyncLocalStorage<RequestTiming>();

export const runTimed = <T>(fn: () => T): { t: RequestTiming; result: T } => {
  const t: RequestTiming = { dbCount: 0, dbMs: 0, authMs: 0 };
  return { t, result: timing.run(t, fn) };
};

export const currentTiming = (): RequestTiming | undefined => timing.getStore();

/** Runs `fn` outside the current request's counters (background work such as the demo refresh). */
export const untimed = <T>(fn: () => T): T => timing.exit(fn);

/** globalThis.fetch, counted against the current request. Resolved per call so tests can stub it. */
export const countedFetch: typeof fetch = async (input, init) => {
  const t = timing.getStore();
  if (!t) return fetch(input, init);
  const start = performance.now();
  try {
    return await fetch(input, init);
  } finally {
    t.dbCount += 1;
    t.dbMs += performance.now() - start;
  }
};

/** A service role Supabase client whose round trips show up in Server-Timing. */
export const dbClient = (url: string, serviceRoleKey: string, opts: { fetch?: typeof fetch } = {}) =>
  createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: opts.fetch ?? countedFetch },
  }) as SupabaseClient;

export const serverTimingEntries = (t: RequestTiming): string[] => [
  `db;desc="${t.dbCount} round trips";dur=${t.dbMs.toFixed(1)}`,
  `auth;dur=${t.authMs.toFixed(1)}`,
];
