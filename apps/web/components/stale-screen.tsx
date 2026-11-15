"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Coming back after a long time away (#502). The screen on show is never thrown away for a skeleton:
// - a cold open may paint the tab's last known screen from the device (public/sw.js marks it with
//   data-m-snapshot on <html>);
// - a resume after a while shows the screen iOS kept in memory.
// Either way it stays, tappable, with a quiet "Updated 10:41" above the tab bar, while the day
// refreshes in place behind it (a transition: no skeleton, no jump). The line goes when it lands.

// A resume after this long refreshes the screen behind what is shown.
const RESUME_AFTER_MS = 2 * 60 * 1000;
// A copy younger than this is fresh enough to show without the line.
const QUIET_UNDER_MS = 60 * 1000;
// Signed out screens have nothing of anyone's day to refresh.
const SIGNED_OUT = /^\/(login|auth|setup|connect|stage)(\/|$)/;

const hhmm = (at: number) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);

export function StaleScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // When the screen on show was drawn, while it is older than what the server has; null when fresh.
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const drawnAt = useRef(Date.now());
  const started = useRef(false);

  useEffect(() => {
    const refresh = (since: number) => {
      if (SIGNED_OUT.test(location.pathname)) return;
      setStaleSince(Date.now() - since > QUIET_UNDER_MS ? since : null);
      started.current = true;
      startTransition(() => router.refresh());
    };

    const html = document.documentElement;
    const snapshot = Number(html.dataset.mSnapshot);
    if (snapshot > 0) {
      // Painted from the device: refresh now; the real page swaps in where this one stands.
      html.removeAttribute("data-m-snapshot");
      drawnAt.current = snapshot;
      refresh(snapshot);
    }

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > RESUME_AFTER_MS) refresh(drawnAt.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  // The refresh landed: what is on show is current.
  useEffect(() => {
    if (pending || !started.current) return;
    started.current = false;
    drawnAt.current = Date.now();
    setStaleSince(null);
  }, [pending]);

  // A tap to another tab draws a fresh screen of its own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation only
  useEffect(() => {
    drawnAt.current = Date.now();
  }, [pathname]);

  if (staleSince === null || SIGNED_OUT.test(pathname)) return null;
  return (
    <p
      role="status"
      className="m-swap pointer-events-none fixed inset-x-0 bottom-[calc(var(--m-tabbar-h)+24px+env(safe-area-inset-bottom))] z-20 mx-auto w-max rounded-full bg-[var(--m-glass)] px-3 py-1 text-footnote text-label-2 tabular-nums backdrop-blur-xl lg:bottom-6"
    >
      Updated {hhmm(staleSince)}
    </p>
  );
}
