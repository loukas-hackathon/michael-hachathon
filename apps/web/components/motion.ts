"use client";

import { useCallback, useEffect, useRef } from "react";

// How long after a key first appears it still counts as arriving: one spring, plus a little.
const WINDOW_MS = 600;

/**
 * Tells a list which items arrived after it mounted, so only those animate in
 * (.claude/skills/michael-motion, "List insertions"). Items present on the first render, on the
 * server or after a refresh of the page, never animate. An item that remounts later with the same
 * key (moved to another group, a temporary id swapped for the stored one long after) does not
 * replay either, because only the first WINDOW_MS after a key was first seen count.
 *
 *   const arriving = useArrival();
 *   <li className={arriving(m.id) ? "m-pop-in" : undefined}>
 */
export function useArrival() {
  const mounted = useRef(false);
  const firstSeen = useRef(new Map<string, number>());
  useEffect(() => {
    mounted.current = true;
  }, []);
  return useCallback((key: string) => {
    const seen = firstSeen.current;
    let at = seen.get(key);
    if (at === undefined) {
      // Before mount, everything is "seen at zero": already on screen, so it never animates.
      at = mounted.current ? performance.now() : Number.NEGATIVE_INFINITY;
      seen.set(key, at);
    }
    return performance.now() - at < WINDOW_MS;
  }, []);
}
