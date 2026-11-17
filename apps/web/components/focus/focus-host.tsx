"use client";

import type { FocusActiveResponse, FocusSession } from "@michael/shared";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useState } from "react";
import { TABS_STALE } from "@/components/tab-bar";
import { FOCUS_EVENT, minutesLeft } from "./focus-events";
import { FocusResult, FocusSessionView } from "./focus-session";

// Focus now (#397): the one place the live session is shown, mounted once in the layout. It reads
// the session from the server when the app opens or comes back to the front, so leaving the app
// never loses the countdown, and when a screen announces a session it just started. Hidden, the
// session stays as one slim row above the tab bar. A result the user already closed is not shown
// again (remembered on this device).

// Screens with no signed in app around them.
const OUTSIDE = /^\/(login|auth|join|onboarding|connect|setup|stage|live)(\/|$)/;
const SEEN_KEY = "michael:focus-seen";

function seen(id: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === id;
  } catch {
    return false;
  }
}
function markSeen(id: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, id);
  } catch {
    // Private mode: the result may show once more, nothing else.
  }
}

export function FocusHost() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<FocusSession | null>(null);
  const [result, setResult] = useState<FocusSession | null>(null);
  const [hidden, setHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const outside = OUTSIDE.test(pathname ?? "/");
  const onChat = /^\/chat(\/|$)/.test(pathname ?? "/");

  const load = useCallback(async () => {
    // A plain GET, not a server action: actions run one at a time and this must never queue.
    const r = await fetch("/focus/state", { cache: "no-store", signal: AbortSignal.timeout(6_000) })
      .then((res) => (res.ok ? (res.json() as Promise<FocusActiveResponse | null>) : null))
      .catch(() => null);
    if (!r) return;
    setSession((before) => {
      if (r.session && r.session.id !== before?.id) setHidden(false);
      return r.session;
    });
    if (!r.session && r.last && !seen(r.last.id)) setResult(r.last);
  }, []);

  useEffect(() => {
    if (outside) return;
    void load();
    const onShow = () => document.visibilityState === "visible" && void load();
    const onAnnounce = (e: Event) => {
      const s = (e as CustomEvent<FocusSession | undefined>).detail;
      if (s) {
        setResult(null);
        setSession(s);
        setHidden(false);
      } else void load();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener(FOCUS_EVENT, onAnnounce);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener(FOCUS_EVENT, onAnnounce);
    };
  }, [outside, load]);

  // The slim row counts the minutes while the full screen is hidden.
  useEffect(() => {
    if (!session || !hidden) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    setNow(Date.now());
    return () => window.clearInterval(id);
  }, [session, hidden]);

  // The open screen keeps the page still behind it.
  const covering = !outside && (result !== null || (session !== null && !hidden));
  useEffect(() => {
    if (!covering) return;
    const before = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = before;
    };
  }, [covering]);

  if (outside) return null;

  if (result) {
    return (
      <FocusResult
        session={result}
        onClose={() => {
          markSeen(result.id);
          setResult(null);
          startTransition(() => router.refresh());
        }}
      />
    );
  }
  if (!session) return null;
  if (hidden) {
    const left = minutesLeft(session.end_at, now);
    // Chat keeps its composer just above the tab bar, so there the row sits at the top as a
    // compact chip and never covers "Ask Michael" (Loukas, 15 Nov).
    const place = onChat
      ? "inset-x-0 top-[calc(8px+var(--m-safe-top))] mx-auto w-max max-w-[calc(100%-28px)] lg:top-6 lg:right-6 lg:left-auto lg:mx-0"
      : "inset-x-[14px] bottom-[calc(16px+var(--m-tabbar-h)+8px+env(safe-area-inset-bottom))] lg:right-6 lg:bottom-6 lg:left-auto lg:w-80";
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        aria-label={`${session.goal_title}, ${left} min left. Open Focus now`}
        className={`press fixed z-30 flex min-h-11 items-center gap-3 rounded-full bg-[var(--m-glass)] px-4 text-left shadow-[0_0_0_0.5px_var(--m-separator),0_6px_18px_-8px_rgb(0_0_0/0.25)] backdrop-blur-xl ${place}`}
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-spark" />
        <span className="min-w-0 flex-1 truncate text-subhead font-semibold">{session.goal_title}</span>
        <span className="shrink-0 text-subhead text-label-2 tnum">{left} min left</span>
      </button>
    );
  }
  return (
    <FocusSessionView
      key={session.id}
      session={session}
      onChange={setSession}
      onHide={() => setHidden(true)}
      onDone={(s) => {
        setSession(null);
        setResult(s);
        // Today, Goals and the Timeline read the counted time now, behind the result.
        window.dispatchEvent(new Event(TABS_STALE));
        startTransition(() => router.refresh());
      }}
    />
  );
}
