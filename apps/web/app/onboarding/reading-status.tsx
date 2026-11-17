"use client";

import { useEffect, useState } from "react";

// A status line for a wait that can pass a few seconds: it moves on in plain words, so the screen
// is never frozen (michael-feedback, rule 12). Fixed height, so a new line never moves anything
// below it. Reading four weeks of calendar is the longest wait, so its steps are the default.

export const CALENDAR_STEPS = [
  "Reading your calendar",
  "Looking back four weeks",
  "Finding what your week is for",
];

export function ReadingStatus({
  steps = CALENDAR_STEPS,
  every = 2500,
  live = true,
}: {
  steps?: string[];
  /** Milliseconds per step; the last one stays. */
  every?: number;
  /** Announce it (role="status"). Off inside a status line that already announces. */
  live?: boolean;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= steps.length - 1) return;
    const t = setTimeout(() => setI(i + 1), every);
    return () => clearTimeout(t);
  }, [i, steps.length, every]);
  return (
    <span key={i} role={live ? "status" : undefined} className="m-swap block min-h-[1.375em]">
      {steps[Math.min(i, steps.length - 1)]}
    </span>
  );
}

/**
 * Whether a thinking state should show: only once it has lasted `delay` ms, so a quick answer
 * never flashes it, and then for at least `hold` ms, so it never flickers (Vercel's interface
 * guidelines; michael-feedback, rule 5).
 */
export function useShown(on: boolean, delay = 250, hold = 400): boolean {
  const [shown, setShown] = useState(false);
  const [since, setSince] = useState(0);
  useEffect(() => {
    if (on && !shown) {
      const t = setTimeout(() => {
        setShown(true);
        setSince(performance.now());
      }, delay);
      return () => clearTimeout(t);
    }
    if (!on && shown) {
      const left = hold - (performance.now() - since);
      if (left <= 0) {
        setShown(false);
        return;
      }
      const t = setTimeout(() => setShown(false), left);
      return () => clearTimeout(t);
    }
  }, [on, shown, since, delay, hold]);
  return shown;
}
