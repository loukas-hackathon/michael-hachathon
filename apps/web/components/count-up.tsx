"use client";

import { type CSSProperties, useEffect, useRef } from "react";

const KEY = "m-counted";

// Runs before first paint, right after the splash script. Marks the document when the score has
// already counted up this session (no replay), and when the splash is playing (count after it).
// Storage can throw in private modes: then the count simply plays.
const SCRIPT = `(function(){var d=document.documentElement;try{if(sessionStorage.getItem("${KEY}"))d.setAttribute("data-counted","")}catch(_){}var s=document.getElementById("m-splash");if(s&&!s.hasAttribute("data-done"))d.setAttribute("data-splashing","")})()`;

/** Mounted once in the root layout, after <Splash />. */
export function MotionScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: static inline script, no user input
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

/**
 * The headline number counts up from zero once per session (700ms, no bounce), drawn by CSS so it
 * starts with the first paint and never flashes the final value first. The real number is always
 * in the DOM for screen readers; reduced motion shows it at once (globals.css, "Motion").
 */
export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const done = () => {
      document.documentElement.setAttribute("data-counted", "");
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        // Private mode: it may count again next time, which is harmless.
      }
    };
    const el = ref.current;
    if (!el || document.documentElement.hasAttribute("data-counted") || el.getAnimations().length === 0) {
      done();
      return;
    }
    // Leaving mid count means it counts again next time, which beats never counting at all.
    el.addEventListener("animationend", done, { once: true });
    return () => el.removeEventListener("animationend", done);
  }, []);

  return (
    <>
      <span className="sr-only">
        {value}
        {suffix}
      </span>
      <span
        ref={ref}
        aria-hidden="true"
        className="m-count"
        style={{ "--m-count-to": Math.round(value) } as CSSProperties}
      >
        {suffix}
      </span>
    </>
  );
}
