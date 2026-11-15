"use client";

import type { FocusSession } from "@michael/shared";
import { voiceShortDuration } from "@michael/shared/voice";
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { endFocusAction, extendFocusAction, focusActiveAction } from "@/app/focus-actions";
import { haptic } from "@/components/haptics";
import { Michael } from "@/components/michael";
import { formatTime } from "@/lib/format";
import { minutesLeft, minutesSoFar, shareLeft } from "./focus-events";
import { iphoneFocusReady, onIphone, runIphoneFocus } from "./iphone-focus";

// Focus now (#397): the calm full screen session. The goal, one continuous ring counting down,
// what Michael is guarding (only when it is true), +15 min and End early. End early asks once
// whether to count the minutes so far. At zero the session ends on time: the server counts it and
// buzzes the watch; this screen says the same line.

const RING = 248;
const STROKE = 10;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;

const tinted =
  "press min-h-11 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-5 text-body font-semibold text-tint-text disabled:opacity-60";
const filled =
  "press min-h-11 rounded-full bg-tint px-5 text-body font-semibold text-on-tint disabled:opacity-60";
const plain = "press h-11 px-3 text-body font-semibold text-tint-text disabled:opacity-60";

/** Reduced motion: the ring and the minutes move once a minute instead of every second. */
function useNow(reduced: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, reduced ? 60_000 : 1_000);
    const onShow = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [reduced]);
  return now;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * The ring drains in real time (#534), as Apple's Timer does: one linear CSS animation from where
 * it is now to empty at the end, restarted only when the end moves (+15). Under reduced motion it
 * stays still and steps once a minute with the clock.
 */
function useDrain(session: FocusSession, now: number, reduced: boolean) {
  // Read once per end time: the animation carries it from here, not the one second clock.
  const [from, setFrom] = useState(() => ({ end: session.end_at, share: shareLeft(session, now) }));
  if (from.end !== session.end_at) setFrom({ end: session.end_at, share: shareLeft(session, now) });
  if (reduced) return { share: shareLeft(session, now), drainMs: undefined, key: "still" };
  return { share: from.share, drainMs: Math.max(1, Date.parse(session.end_at) - now), key: from.end };
}

export function FocusRing({
  share,
  label,
  drainMs,
}: {
  share: number;
  label: string;
  /** Drain smoothly from `share` to empty over this many milliseconds. */
  drainMs?: number;
}) {
  return (
    <svg
      width={RING}
      height={RING}
      viewBox={`0 0 ${RING} ${RING}`}
      role="img"
      aria-label={label}
      className="block max-w-[70vw] h-auto"
    >
      <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke="var(--m-context)" strokeWidth={STROKE} />
      {share > 0 ? (
        <circle
          cx={RING / 2}
          cy={RING / 2}
          r={R}
          fill="none"
          stroke="var(--m-spark)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - share)}
          className={drainMs ? "m-ring-drain" : undefined}
          style={
            drainMs
              ? ({ "--m-ring-empty": C, animationDuration: `${drainMs}ms` } as CSSProperties)
              : undefined
          }
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      ) : null}
    </svg>
  );
}

/**
 * Keeps keyboard focus inside a full screen view while it is open (Tab and Shift Tab wrap, as in a
 * native dialog), and hands focus back to whatever opened it when it closes.
 */
function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected && !opener.closest("dialog:not([open])")) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}

type Ask = null | "count";

export function FocusSessionView({
  session,
  onChange,
  onDone,
  onHide,
}: {
  session: FocusSession;
  onChange: (s: FocusSession) => void;
  /** The session stopped (on time or early): the host shows the result. */
  onDone: (s: FocusSession) => void;
  onHide: () => void;
}) {
  const reduced = useReducedMotion();
  const now = useNow(reduced);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState<null | "extend" | "end">(null);
  const [error, setError] = useState<string | null>(null);
  const ending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  useFocusTrap(screen);

  const left = minutesLeft(session.end_at, now);
  const soFar = minutesSoFar(session.start_at, now);
  const drain = useDrain(session, now, reduced);
  const msLeft = Math.max(0, Date.parse(session.end_at) - now);
  // The last minute counts seconds, as a timer does (still minutes under reduced motion).
  const lastMinute = !reduced && msLeft > 0 && msLeft < 60_000;
  const secondsLeft = Math.ceil(msLeft / 1000);
  // On an iPhone without Michael Focus, one quiet offer: the phone could follow the session.
  const [offerPhone, setOfferPhone] = useState(false);
  useEffect(() => setOfferPhone(onIphone() && !iphoneFocusReady()), []);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  async function end(count: boolean) {
    if (ending.current) return;
    ending.current = true;
    setBusy("end");
    setError(null);
    try {
      const r = await endFocusAction(session.id, count);
      if (r.ok) {
        haptic();
        onDone(r.session);
        // Ended early by a tap: the iPhone's Focus ends with it (on time, its own timer ends it).
        if (Date.parse(session.end_at) > Date.now() + 5_000) runIphoneFocus(null);
      } else setError(r.error);
    } catch {
      // The answer was lost on the way back, not necessarily the end: ask the server what happened.
      const state = await focusActiveAction().catch(() => null);
      const last = state?.last;
      if (state && !state.session && last?.id === session.id) {
        haptic();
        onDone(last);
      } else setError("I could not reach the server. Nothing changed.");
    } finally {
      ending.current = false;
      setBusy(null);
    }
  }

  // At zero the session ends on time (the server does it too, with the app closed).
  const due = Date.parse(session.end_at) <= now;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once when it becomes due
  useEffect(() => {
    if (due) void end(true);
  }, [due]);

  async function extend() {
    if (busy) return;
    setBusy("extend");
    setError(null);
    try {
      const r = await extendFocusAction(session.id);
      if (r.ok) {
        onChange(r.session);
        // The iPhone's Focus moves with the new end.
        runIphoneFocus(r.session.end_at);
      } else setError(r.error);
    } catch {
      setError("I could not reach the server. Nothing changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      ref={screen}
      role="dialog"
      aria-modal="true"
      aria-labelledby="focus-goal"
      onKeyDown={(e) => {
        // Escape hides the full screen focus view, as it closes every sheet on a laptop.
        if (e.key === "Escape") onHide();
      }}
      className="fixed inset-0 z-50 flex flex-col bg-bg px-4 pt-[calc(12px+var(--m-safe-top))] pb-[calc(24px+env(safe-area-inset-bottom))]"
    >
      <div className="flex h-11 items-center justify-between">
        <button type="button" onClick={onHide} className={plain.replace("text-tint-text", "text-label-2")}>
          Hide
        </button>
        <p className="text-footnote font-semibold text-label-2">Focus now</p>
        <span className="w-[58px]" aria-hidden="true" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {/* The living Mi breathes, slowly, while you focus; still under reduced motion. */}
        <div className="m-focus-breath mb-4" aria-hidden="true">
          <Michael className="h-7 w-auto" title="" />
        </div>
        {/* The whole goal, on up to two balanced lines; a long name steps down a size. */}
        <h1
          id="focus-goal"
          ref={heading}
          tabIndex={-1}
          className={`max-w-[22rem] text-balance font-bold outline-none [overflow-wrap:anywhere] ${
            session.goal_title.length > 28 ? "text-insight" : "text-large-title"
          }`}
        >
          {session.goal_title}
        </h1>
        <div className="relative mt-8">
          <FocusRing
            key={drain.key}
            share={drain.share}
            drainMs={drain.drainMs}
            label={`${left} minutes left of ${session.minutes}`}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-num text-score leading-none font-extrabold tracking-[-0.02em] tnum">
              {lastMinute ? `0:${String(secondsLeft).padStart(2, "0")}` : left}
            </span>
            <span className="mt-1 text-subhead font-semibold text-label-2">
              {lastMinute ? "left" : left === 1 ? "minute left" : "minutes left"}
            </span>
          </div>
        </div>
        {/* Started by Michael when a synced goal block began: he says so, once, here. */}
        {session.message ? (
          <p className="mt-6 max-w-[22rem] text-body text-label-2 tnum">{session.message}</p>
        ) : (
          <p className="mt-6 text-body text-label-2 tnum">Until {formatTime(session.end_at)}</p>
        )}
        {/* What is already won, counting up a minute at a time, in the goal's own pink. */}
        <p className="mt-1 min-h-5 text-subhead font-semibold text-tint-text tnum">
          {soFar > 0 ? `${voiceShortDuration(soFar)} kept` : ""}
        </p>
        {session.guarded ? (
          <p className="mt-2 text-subhead text-label-2">Michael is guarding your Mac.</p>
        ) : null}
        {offerPhone ? (
          <p className="mt-1 flex items-center text-subhead text-label-2">
            Also turn on iPhone Focus.
            <a
              href="/you/connections/iphone"
              className="press -my-3 flex h-11 items-center px-2 font-semibold text-tint-text"
            >
              Set up
            </a>
          </p>
        ) : null}
      </div>

      <div className="flex min-h-[112px] flex-col items-center justify-end gap-2">
        {ask === "count" ? (
          <fieldset
            className="m-swap m-0 flex w-full min-w-0 flex-col items-center gap-2 border-0 p-0"
            aria-label="End early"
          >
            <p className="text-title3 font-semibold tnum">
              {soFar > 0 ? `Count ${voiceShortDuration(soFar)}?` : "End without counting?"}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {soFar > 0 ? (
                <button
                  type="button"
                  onClick={() => end(true)}
                  disabled={busy !== null}
                  aria-busy={busy === "end"}
                  className={`${filled} min-w-[9rem]`}
                >
                  {busy === "end" ? "Saving" : `Count ${voiceShortDuration(soFar)}`}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => end(false)}
                disabled={busy !== null}
                className={soFar > 0 ? plain : `${filled} min-w-[9rem]`}
              >
                {soFar > 0 ? "Don't count" : busy === "end" ? "Ending" : "End"}
              </button>
              <button type="button" onClick={() => setAsk(null)} disabled={busy !== null} className={plain}>
                Keep going
              </button>
            </div>
          </fieldset>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={extend}
              disabled={busy !== null}
              aria-busy={busy === "extend"}
              className={`${tinted} min-w-[7.5rem]`}
            >
              {busy === "extend" ? "Adding" : "+15 min"}
            </button>
            <button type="button" onClick={() => setAsk("count")} disabled={busy !== null} className={plain}>
              End early
            </button>
          </div>
        )}
        <p role="alert" className="min-h-5 text-footnote text-danger">
          {error ?? ""}
        </p>
      </div>
    </div>
  );
}

/** What the session came to: "Done. 45 min for University." and one way out. */
export function FocusResult({ session, onClose }: { session: FocusSession; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  useFocusTrap(screen);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const done = session.status === "done";
  const counted = session.counted_minutes ?? 0;
  return (
    <div
      ref={screen}
      role="dialog"
      aria-modal="true"
      aria-labelledby="focus-result"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-50 flex flex-col bg-bg px-4 pt-[calc(12px+var(--m-safe-top))] pb-[calc(24px+env(safe-area-inset-bottom))]"
    >
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {/* The finish moment: Mi lifts once when time was kept (still under reduced motion). */}
        <div className="mb-4" aria-hidden="true">
          <Michael state={counted > 0 ? "pleased" : "idle"} className="h-7 w-auto" title="" />
        </div>
        <p className="max-w-[22rem] text-balance text-footnote font-semibold text-label-2">
          {session.goal_title}
        </p>
        <div className="relative mt-6">
          <FocusRing share={done ? 1 : counted > 0 ? counted / Math.max(1, session.minutes) : 0} label="" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-num text-score leading-none font-extrabold tracking-[-0.02em] tnum">
              {counted}
            </span>
            <span className="mt-1 text-subhead font-semibold text-label-2">min counted</span>
          </div>
        </div>
        <h1
          id="focus-result"
          ref={heading}
          tabIndex={-1}
          role="status"
          className="m-swap mt-8 max-w-full text-insight font-bold outline-none"
        >
          {session.message ?? (done ? `Done. ${voiceShortDuration(counted)}.` : "Ended.")}
        </h1>
        {counted > 0 ? (
          <p className="mt-2 text-subhead text-label-2">It counts as goal time on Today and Goals.</p>
        ) : null}
      </div>
      <div className="flex justify-center">
        <button type="button" onClick={onClose} className={`${filled} min-w-[9rem]`}>
          Done
        </button>
      </div>
    </div>
  );
}
