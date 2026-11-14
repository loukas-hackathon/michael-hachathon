"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { hm, minutesPhrase } from "@/lib/format";
import { motionMs, reducedMotion } from "./motion";

/**
 * A region that opens and closes in place (a row's details, a key, secondary items): its height
 * eases on the smooth spring (grid rows 0fr to 1fr, so no measuring) and the content fades in just
 * behind it. Closed content is inert, so focus and screen readers skip it. Reduced motion: the
 * height snaps and only the fade remains (globals.css, ".m-collapse").
 */
export function Collapse({
  open,
  id,
  as: El = "div",
  className = "",
  children,
}: {
  open: boolean;
  id?: string;
  /** "span" inside phrasing content (a button's label); it still lays out as a grid. */
  as?: "div" | "span";
  className?: string;
  children: ReactNode;
}) {
  return (
    <El id={id} className={`m-collapse ${className}`} data-open={open ? "" : undefined} inert={!open}>
      <El className="m-collapse-inner">{children}</El>
    </El>
  );
}

/**
 * A number that moves to its new value instead of snapping when it changes after mount (a live
 * refresh, an action that changed the totals). The first value shows as is; the score's first
 * count up is CountUp's job. About 450ms, easing out; reduced motion shows the new value at once.
 */
export function useTween(value: number): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    if (reducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    const duration = motionMs("--m-dur-tween", 450);
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // Ease out, close to --m-ease-out: most of the change lands early, then it settles.
      const next = from + (value - from) * (1 - (1 - p) ** 3);
      current.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // Interrupted by a newer value: the next run starts from wherever this one got to.
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

const FORMATS = {
  int: (n: number) => String(Math.round(n)),
  pct: (n: number) => `${Math.round(n)}%`,
  minutes: (n: number) => minutesPhrase(Math.round(n)),
  hm: (n: number) => hm(Math.round(n)),
} as const;

/**
 * Renders a tweening number with tabular figures, formatted as the sentence around it needs.
 */
export function Tween({ value, format = "int" }: { value: number; format?: keyof typeof FORMATS }) {
  const shown = useTween(value);
  // One text node, so the sentence reads (and matches) as one; it is the real value at rest and
  // moves for under half a second only after a change. Not a live region, so nothing reads per frame.
  return <span className="tnum">{FORMATS[format](shown)}</span>;
}
