"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { formatTime } from "@/lib/format";
import { stagger } from "./motion";

const POLL_MS = 45_000;
// Coming back to the tab checks at once, unless we checked a moment ago.
const RETURN_GAP_MS = 10_000;

/** Every element marked `data-live-key` on screen, by key. */
function liveKeys(): Set<string> {
  const keys = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-live-key]")) {
    if (el.dataset.liveKey) keys.add(el.dataset.liveKey);
  }
  return keys;
}

/**
 * Keeps Today and Timeline live without a reload. Polls GET /live (a fingerprint of today's events
 * and nudges) every 45 seconds while the tab is visible, pauses while hidden, and calls
 * router.refresh() only when the fingerprint moved. After a refresh, anything marked
 * `data-live-key` that was not on screen before (a new block, a tick that just filled) gets the
 * `m-live-enter` entrance. Renders the quiet " · Updated 19:42" for the screen's context line.
 */
export function LiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updated, setUpdated] = useState<Date | null>(null);
  const stamp = useRef<string | null>(null);
  const lastCheck = useRef(0);
  const before = useRef<Set<string> | null>(null);

  const check = useCallback(async () => {
    lastCheck.current = Date.now();
    try {
      const res = await fetch("/live", { cache: "no-store" });
      if (res.status !== 200) return;
      const { stamp: next } = (await res.json()) as { stamp: string };
      if (stamp.current === null) {
        stamp.current = next;
        return;
      }
      if (next === stamp.current) return;
      stamp.current = next;
      before.current = liveKeys();
      startTransition(() => router.refresh());
    } catch {
      // Offline or asleep: keep what is on screen, the next tick tries again.
    }
  }, [router]);

  useEffect(() => {
    setUpdated(new Date());
    void check();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheck.current > RETURN_GAP_MS) {
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // The refresh has committed: mark what is new so it can arrive, then note the time.
  useEffect(() => {
    if (pending || !before.current) return;
    const seen = before.current;
    before.current = null;
    // In reading order (document order), a subtle stagger so a screen that fills at once (first data
    // of the day) reads top to bottom. Sections marked data-live-pop pop in; blocks and ticks rise.
    let i = 0;
    for (const el of document.querySelectorAll<HTMLElement>("[data-live-key]")) {
      if (!el.dataset.liveKey || seen.has(el.dataset.liveKey)) continue;
      const cls = el.hasAttribute("data-live-pop") ? "m-pop-in" : "m-live-enter";
      el.classList.remove(cls);
      void el.offsetWidth; // restart the animation if the class was already there
      el.style.animationDelay = stagger(i++).animationDelay as string;
      el.classList.add(cls);
      const end = (e: AnimationEvent) => {
        if (e.target !== el) return; // a child's own animation finished, not this entrance
        el.removeEventListener("animationend", end);
        el.classList.remove(cls);
        el.style.animationDelay = "";
      };
      el.addEventListener("animationend", end);
    }
    setUpdated(new Date());
  }, [pending]);

  if (!updated) return null;
  return (
    <span aria-live="polite">
      {" · "}
      <span className="m-live-stamp" key={updated.getTime()}>
        Updated {formatTime(updated)}
      </span>
    </span>
  );
}
