"use client";

import { type FocusSession, voiceShortDuration } from "@michael/shared";
import { useEffect, useRef, useState } from "react";
import { endFocusAction, extendFocusAction, focusActiveAction } from "@/app/focus-actions";
import { haptic } from "@/components/haptics";
import { formatTime } from "@/lib/format";
import { minutesLeft, minutesSoFar, shareLeft } from "./focus-events";

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

export function FocusRing({ share, label }: { share: number; label: string }) {
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
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      ) : null}
    </svg>
  );
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

  const left = minutesLeft(session.end_at, now);
  const soFar = minutesSoFar(session.start_at, now);
  const share = shareLeft(session, now);

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
      if (r.ok) onChange(r.session);
      else setError(r.error);
    } catch {
      setError("I could not reach the server. Nothing changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
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
        <h1
          id="focus-goal"
          ref={heading}
          tabIndex={-1}
          className="max-w-full truncate text-large-title font-bold outline-none"
        >
          {session.goal_title}
        </h1>
        <div className="relative mt-8">
          <FocusRing share={share} label={`${left} minutes left of ${session.minutes}`} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-num text-score leading-none font-extrabold tracking-[-0.02em] tnum">
              {left}
            </span>
            <span className="mt-1 text-subhead font-semibold text-label-2">
              {left === 1 ? "minute left" : "minutes left"}
            </span>
          </div>
        </div>
        <p className="mt-6 text-body text-label-2 tnum">Until {formatTime(session.end_at)}</p>
        {session.guarded ? (
          <p className="mt-2 text-subhead text-label-2">Michael is guarding your Mac.</p>
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
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const done = session.status === "done";
  const counted = session.counted_minutes ?? 0;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="focus-result"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-50 flex flex-col bg-bg px-4 pt-[calc(12px+var(--m-safe-top))] pb-[calc(24px+env(safe-area-inset-bottom))]"
    >
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-footnote font-semibold text-label-2">{session.goal_title}</p>
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
