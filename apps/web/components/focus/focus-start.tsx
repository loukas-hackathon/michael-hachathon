"use client";

import { voiceShortDuration } from "@michael/shared/voice";
import { useRef, useState } from "react";
import { startFocusAction } from "@/app/focus-actions";
import { Sheet } from "@/components/sheet";
import { formatTime } from "@/lib/format";
import { announceFocus, LENGTHS } from "./focus-events";

// Focus now (#397): one tap starts a session. Each length is its own button, so choosing how long
// is the tap that starts it; with a goal block running now, "Until 12:00" uses that block. Not
// optimistic (michael-feedback R3): the server makes the block, so the tapped button says
// "Starting" until it answers, then the session screen opens.

const chip =
  "press min-h-11 min-w-[4.5rem] rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text tnum disabled:opacity-60";

export function FocusLengths({
  goalId,
  eventId,
  until,
  lengths = LENGTHS,
  onStarted,
}: {
  goalId: string;
  /** A goal block running now: the first button uses it, to its end. */
  eventId?: string;
  until?: string;
  lengths?: number[];
  onStarted?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  async function start(key: string, minutes?: number) {
    if (lock.current) return;
    lock.current = true;
    setBusy(key);
    setError(null);
    try {
      const r = await startFocusAction({ goalId, minutes, eventId: key === "block" ? eventId : undefined });
      if (r.ok) {
        onStarted?.();
        announceFocus(r.session);
      } else setError(r.error);
    } catch {
      setError("I could not reach the server. Nothing changed.");
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0" aria-label="How long">
        {eventId && until ? (
          <button
            type="button"
            onClick={() => start("block")}
            disabled={busy !== null}
            aria-busy={busy === "block"}
            className={chip}
          >
            {busy === "block" ? "Starting" : `Until ${formatTime(until)}`}
          </button>
        ) : null}
        {lengths.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => start(String(m), m)}
            disabled={busy !== null}
            aria-busy={busy === String(m)}
            aria-label={`Focus for ${m} minutes`}
            className={chip}
          >
            {busy === String(m) ? "Starting" : voiceShortDuration(m)}
          </button>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Today: the goal block running now, or a free stretch, as one tap to protected time. */
export function TodayFocus({
  goalId,
  goalTitle,
  line,
  eventId,
  until,
  lengths,
}: {
  goalId: string;
  goalTitle: string;
  line: string;
  eventId?: string;
  until?: string;
  lengths: number[];
}) {
  return (
    <section aria-label="Focus now" className="mt-6 rounded-group bg-fill px-4 py-3">
      <h2 className="truncate text-body font-semibold">Focus on {goalTitle} now</h2>
      <p className="mt-0.5 mb-3 text-footnote text-label-2 tnum">{line}</p>
      <FocusLengths goalId={goalId} eventId={eventId} until={until} lengths={lengths} />
    </section>
  );
}

/** Goals: "Focus now" on a goal row opens the lengths in a sheet. */
export function FocusNowButton({
  goal,
  className,
}: {
  goal: { id: string; title: string };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Focus now on ${goal.title}`}
        className={className ?? "press text-footnote font-semibold text-tint-text"}
      >
        Focus now
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Focus on ${goal.title}`}>
        <div className="px-1 pb-4">
          <p className="mb-3 text-subhead text-label-2">
            From now, in your own block. At the end your watch buzzes and it counts.
          </p>
          <FocusLengths goalId={goal.id} onStarted={() => setOpen(false)} />
        </div>
      </Sheet>
    </>
  );
}
