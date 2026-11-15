"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

// Keep in step with globals.css (.m-skeleton): a skeleton is invisible for its first 200ms.
const DELAY_MS = 200;
// Once seen, a skeleton stays at least this long, so it never flickers.
const MIN_MS = 500;
// How long the page counts as "just replaced a skeleton" (one cross-fade, plus a little).
const REVEAL_MS = 400;

let revealTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Inside every skeleton. When the skeleton leaves after the user saw it, it marks <html> for one
 * moment so the content that replaces it cross-fades in (globals.css, `html[data-reveal]`, with
 * @starting-style, so only newly inserted content fades, never what was already on screen).
 * Layout effects: the fallback's cleanup runs in the same commit, before the content paints.
 */
export function SkeletonMark() {
  useLayoutEffect(() => {
    const at = performance.now();
    return () => {
      if (performance.now() - at < DELAY_MS) return;
      const root = document.documentElement;
      root.setAttribute("data-reveal", "");
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => root.removeAttribute("data-reveal"), REVEAL_MS);
    };
  }, []);
  return null;
}

/**
 * Content that replaces a section skeleton. Cross-fades in (opacity only) when the skeleton was
 * seen; appears at once when it was not. A plain block: put it where the section's root goes.
 */
export function Reveal({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`m-reveal ${className}`}>{children}</div>;
}

/**
 * For data a client component loads itself (sheets, history): whether to render its skeleton.
 * True while loading (the skeleton's own CSS keeps it invisible for 200ms, so fast loads never
 * flash), and, when the load outlasted those 200ms, held until the skeleton has been visible
 * for 500ms, so it never flickers.
 *
 *   const pending = useSkeleton(list === null);
 *   if (pending) return <Pending label="Loading suggestions"><RowsSkeleton rows={3} /></Pending>;
 */
export function useSkeleton(loading: boolean): boolean {
  const [held, setHeld] = useState(false);
  const since = useRef<number | null>(null);
  useEffect(() => {
    if (loading) {
      since.current ??= performance.now();
      setHeld(true);
      return;
    }
    if (since.current === null) return;
    const elapsed = performance.now() - since.current;
    since.current = null;
    // Never became visible: drop it now. Visible: keep it to its minimum.
    const left = elapsed < DELAY_MS ? 0 : DELAY_MS + MIN_MS - elapsed;
    if (left <= 0) {
      setHeld(false);
      return;
    }
    const t = setTimeout(() => setHeld(false), left);
    return () => clearTimeout(t);
  }, [loading]);
  return loading || held;
}
