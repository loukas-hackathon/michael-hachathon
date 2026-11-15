"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/components/haptics";

// One pattern for every tap that changes something (.claude/skills/michael-feedback):
//
//   1. Pressed state at once: `.press` on the control (michael-motion skill).
//   2. `pending` the same frame: the button shows its pending verb and is disabled, so a double tap
//      never sends twice. A pending label, once shown, stays at least MIN_PENDING_MS (no flash).
//   3. Reversible, own data actions update optimistically and roll back if the server says no.
//   4. Success settles in place (`done` for a moment) with a haptic tick.
//   5. Errors in Michael's words next to the control, with `retry` for the same call.
//   6. Pending always clears, whatever the call does (finally).
//
//   const save = useAction(saveSource, {
//     optimistic: (source, on) => { setOn(on); return () => setOn(!on); },
//   });
//   <input onChange={(e) => save.run(source, e.target.checked)} />
//   <ActionError error={save.error} onRetry={save.retry} />

/** A pending label, once shown, stays at least this long so it never flashes. */
export const MIN_PENDING_MS = 300;
/** How long `done` stays true after a success, for a settled label or status line. */
export const DONE_MS = 2400;
export const NETWORK_ERROR = "I lost the line. Nothing changed.";

export type ActionOptions<A extends unknown[], R> = {
  /** Show the result before the server answers. Return a function that puts it back. */
  optimistic?: (...args: A) => (() => void) | undefined;
  /**
   * Reads a result that resolved but is a failure, and returns Michael's words for it (or null).
   * By default `{ ok: false, error }` and `{ ok: false, message }` count as failures.
   */
  failure?: (result: R) => string | null;
  onSuccess?: (result: R, ...args: A) => void;
  onError?: (error: string, ...args: A) => void;
  /** Message for a thrown error (network, server crash). */
  errorMessage?: string;
  /** Haptic tick on success. On by default. */
  haptic?: boolean;
};

export type Action<A extends unknown[], R> = {
  run: (...args: A) => Promise<R | undefined>;
  /** True from the tap until the server answers: show the pending verb, disable the control. */
  pending: boolean;
  /** True for DONE_MS after a success. */
  done: boolean;
  error: string | null;
  /** Runs the last failed call again with the same arguments. */
  retry: () => void;
  /** Clears the error and done state. */
  reset: () => void;
};

/** Michael's words if a resolved result is a failure (`{ ok: false, error | message }`), else null. */
export function failureOf(result: unknown): string | null {
  if (result && typeof result === "object" && "ok" in result && result.ok === false) {
    const r = result as { error?: unknown; message?: unknown };
    if (typeof r.error === "string" && r.error) return r.error;
    if (typeof r.message === "string" && r.message) return r.message;
    return NETWORK_ERROR;
  }
  return null;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function useAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: ActionOptions<A, R> = {},
): Action<A, R> {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const lastArgs = useRef<A | null>(null);
  const alive = useRef(true);
  const doneTimer = useRef<number | undefined>(undefined);
  // The latest function and options, so `run` stays stable across renders.
  const latest = useRef({ fn, options });
  useEffect(() => {
    latest.current = { fn, options };
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(doneTimer.current);
    };
  }, []);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    lastArgs.current = args;
    const { fn: call, options: o } = latest.current;
    window.clearTimeout(doneTimer.current);
    setDone(false);
    setError(null);
    setPending(true);
    const started = performance.now();
    const rollback = o.optimistic?.(...args) ?? undefined;

    let result: R | undefined;
    let failed: string | null = null;
    try {
      result = await call(...args);
      failed = (o.failure ?? failureOf)(result);
    } catch (err) {
      console.error("action failed:", err);
      failed = o.errorMessage ?? NETWORK_ERROR;
    } finally {
      // Without an optimistic result the pending label is what the user sees: hold it briefly.
      if (!o.optimistic) {
        const left = MIN_PENDING_MS - (performance.now() - started);
        if (left > 0) await wait(left);
      }
      inFlight.current = false;
      if (alive.current) setPending(false);
    }

    if (failed !== null) {
      rollback?.();
      if (alive.current) setError(failed);
      o.onError?.(failed, ...args);
      return result;
    }
    if (o.haptic !== false) haptic();
    if (alive.current) {
      setDone(true);
      doneTimer.current = window.setTimeout(() => alive.current && setDone(false), DONE_MS);
    }
    o.onSuccess?.(result as R, ...args);
    return result;
  }, []);

  const retry = useCallback(() => {
    if (lastArgs.current) void run(...lastArgs.current);
  }, [run]);
  const reset = useCallback(() => {
    setError(null);
    setDone(false);
  }, []);

  return { run, pending, done, error, retry, reset };
}

/**
 * Wraps a form's server action for `useActionState`, so a network failure becomes Michael's line
 * under the form instead of the whole screen falling over to error.tsx.
 */
export function safeFormAction<S extends { ok: boolean; message: string | null }>(
  action: (prev: S, form: FormData) => Promise<S>,
): (prev: S, form: FormData) => Promise<S> {
  return async (prev, form) => {
    try {
      return await action(prev, form);
    } catch (err) {
      console.error("form action failed:", err);
      return { ...prev, ok: false, message: NETWORK_ERROR };
    }
  };
}
