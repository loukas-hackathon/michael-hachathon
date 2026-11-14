"use client";

import { type CSSProperties, type RefObject, useCallback, useEffect, useRef } from "react";

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

// ---------- layout motion: sheets that resize, items that stay while they leave ----------
//
// The skill keeps animation to transform and opacity. useSmoothHeight is the one exception, for a
// box whose size really changes (a sheet whose content grew): it animates height with the Web
// Animations API, briefly, on the smooth spring. Gaps in lists close with FlipList (transform only).

/** True when the user asked for less motion: layout snaps, opacity may still fade. */
export function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A motion token from globals.css, read at run time so JS animations share the CSS values. */
export function motionToken(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** A duration token in milliseconds ("430ms" or "0.43s"). */
export function motionMs(name: string, fallback: number) {
  const raw = motionToken(name, "");
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
}

function smooth(): KeyframeAnimationOptions {
  return {
    duration: motionMs("--m-dur-smooth", 430),
    easing: motionToken("--m-spring-smooth", "cubic-bezier(.23, 1, .32, 1)"),
  };
}

/**
 * When the element's height changes (content arrived, a row opened, a step swapped), it eases from
 * the old height to the new one instead of jumping. Used by <Sheet>, so a sheet whose content
 * changes grows and shrinks on the smooth spring. Only while `enabled`; reduced motion snaps.
 */
export function useSmoothHeight(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof ResizeObserver === "undefined") return;
    let last = el.getBoundingClientRect().height;
    let running: Animation | null = null;
    const settle = () => {
      if (running) return;
      const next = el.getBoundingClientRect().height;
      if (Math.abs(next - last) < 2) {
        last = next;
        return;
      }
      const from = last;
      last = next;
      if (reducedMotion()) return;
      running = el.animate([{ height: `${from}px` }, { height: `${next}px` }], smooth());
      const end = () => {
        running = null;
        // Content may have changed again while it moved: catch up from where it ended.
        settle();
      };
      running.finished.then(end, end);
    };
    // ResizeObserver runs after layout and before paint, so the new size never flashes first.
    const ro = new ResizeObserver(settle);
    ro.observe(el);
    return () => {
      ro.disconnect();
      running?.cancel();
    };
  }, [ref, enabled]);
}

/**
 * Keeps an item on screen, in its old place, while it is still leaving, even when fresh data (a
 * router.refresh after the action) no longer has it. Without this the server's answer unmounts it
 * mid fade and the gap snaps shut. `leaving(key)` says whether that item is still on its way out.
 *
 *   const shown = useDeparting(cards, (c) => c.id, (id) => local[id]?.hidden && !local[id]?.removed);
 */
export function useDeparting<T>(
  items: T[],
  key: (item: T) => string,
  leaving: (key: string) => boolean,
): T[] {
  const last = useRef<T[]>(items);
  const live = new Set(items.map(key));
  const shown = [...items];
  last.current.forEach((item, i) => {
    const k = key(item);
    if (!live.has(k) && leaving(k)) shown.splice(Math.min(i, shown.length), 0, item);
  });
  useEffect(() => {
    last.current = shown;
  });
  return shown;
}

/**
 * A subtle stagger for things that arrive together (first data after a refresh), in reading order:
 * `style={stagger(i)}` with `.m-pop-in` or `.m-live-enter`. 30ms apart (`--m-stagger`), capped at
 * the sixth item, so a long list never waits.
 */
export function stagger(i: number): CSSProperties {
  return { animationDelay: `calc(${Math.min(Math.max(i, 0), 6)} * var(--m-stagger))` };
}
