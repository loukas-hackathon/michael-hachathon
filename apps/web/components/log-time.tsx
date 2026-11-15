"use client";

import { useRouter } from "next/navigation";
import { startTransition, useId, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { type LogActionResult, logTimeAction, settleBlockAction, undoLogAction } from "@/lib/log-actions";
import { undoneLine } from "@/lib/say";

// Saying "I did x" in one or two taps (#317). The result only the server knows (the week's maths)
// shows in place where the button was, with Undo; Undo itself is optimistic and rolls back with one
// line if it fails (michael-feedback). No toast, no new colour: the tinted pill of a quiet row.

export type LoggableGoal = { id: string; title: string };

const PILL =
  "press inline-flex min-h-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text tnum disabled:opacity-60";
const CHIP =
  "press min-h-9 rounded-full px-3 text-subhead font-semibold tnum aria-pressed:bg-label aria-pressed:text-bg bg-bg text-label";
const MINUTES = [15, 30, 45, 60] as const;

/** The line after a log, with Undo; "Taken back. Off the books." (today's phrasing) once undone. */
function Logged({ message, recommendationId }: { message: string; recommendationId: string }) {
  const router = useRouter();
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  async function undo() {
    if (busy.current) return;
    busy.current = true;
    setUndone(true);
    setError(null);
    const r = await undoLogAction(recommendationId).catch(() => ({
      ok: false,
      error: "I lost the line. It's still logged.",
    }));
    busy.current = false;
    if (r.ok) startTransition(() => router.refresh());
    else {
      setUndone(false);
      setError(r.error ?? "I couldn't undo that. It's still logged.");
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-swap flex min-h-9 flex-wrap items-center gap-x-3 text-subhead" role="status">
        <span className={undone ? "text-label-2" : ""}>
          {undone ? undoneLine("Off the books.") : message}
        </span>
        {undone ? null : (
          <button type="button" onClick={undo} className="press font-semibold text-tint-text">
            Undo
          </button>
        )}
      </p>
      {error ? (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Pick the goal (unless given), how long, and when: just now, or at a time today. One tap on Log.
 */
export function LogTimeForm({
  goals,
  goalId,
  onLogged,
}: {
  goals: LoggableGoal[];
  goalId?: string;
  onLogged?: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [goal, setGoal] = useState(goalId ?? goals[0]?.id ?? "");
  const [minutes, setMinutes] = useState<number>(30);
  const [at, setAt] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<LogActionResult | null>(null);

  if (goals.length === 0 && !goalId) {
    return <p className="text-subhead text-label-2">Add a goal first, then log time against it.</p>;
  }
  if (result?.ok) return <Logged message={result.message} recommendationId={result.recommendationId} />;

  async function submit() {
    if (pending) return;
    setPending(true);
    setResult(null);
    try {
      const r = await logTimeAction({ goalId: goal, minutes, at: at || null });
      setResult(r);
      if (r.ok) {
        onLogged?.();
        startTransition(() => router.refresh());
      }
    } catch {
      setResult({ ok: false, error: "I lost the line. Nothing was logged." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {goalId ? null : (
        <label className="flex items-center justify-between gap-3 text-subhead" htmlFor={`${ids}-goal`}>
          <span className="text-label-2">Goal</span>
          <select
            id={`${ids}-goal`}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="min-h-9 max-w-[60%] truncate rounded-[9px] bg-bg px-2 text-subhead font-semibold"
          >
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset aria-label="How long" className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
        {MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={minutes === m}
            onClick={() => setMinutes(m)}
            className={CHIP}
          >
            {m} min
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-subhead text-label-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={960}
            aria-label="Other minutes"
            value={MINUTES.includes(minutes as (typeof MINUTES)[number]) ? "" : minutes}
            placeholder="Other"
            onChange={(e) => setMinutes(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            className="min-h-9 w-[4.5rem] rounded-full bg-bg px-3 text-subhead font-semibold text-label tnum outline-none placeholder:font-normal placeholder:text-label-2"
          />
        </label>
      </fieldset>
      <label className="flex items-center justify-between gap-3 text-subhead" htmlFor={`${ids}-at`}>
        <span className="text-label-2">Started at</span>
        <input
          id={`${ids}-at`}
          type="time"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          aria-describedby={`${ids}-at-hint`}
          className="min-h-9 rounded-[9px] bg-bg px-2 text-subhead font-semibold tnum"
        />
      </label>
      <p id={`${ids}-at-hint`} className="-mt-2 text-footnote text-label-2">
        {at ? `From ${at}, ${minutes} min.` : "Leave it empty for just now."}
      </p>
      {result && !result.ok ? (
        <p role="alert" className="text-footnote text-danger">
          {result.error}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !goal || minutes < 1}
          aria-busy={pending}
          className={`${PILL} min-w-[7.5rem]`}
        >
          {pending ? "Logging" : `Log ${minutes} min`}
        </button>
      </div>
    </div>
  );
}

/** A goal row's quiet "Log time": opens a sheet with the form for that goal. */
export function LogTimeButton({ goal, className }: { goal: LoggableGoal; className?: string }) {
  const [open, setOpen] = useState(false);
  // A fresh form each time the sheet opens, so the last result does not linger.
  const [round, setRound] = useState(0);
  // Once logged there is nothing left to cancel: the sheet closes with Done.
  const [logged, setLogged] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRound((r) => r + 1);
          setLogged(false);
          setOpen(true);
        }}
        aria-label={`Log time for ${goal.title}`}
        className={className ?? "press text-footnote font-semibold text-tint-text"}
      >
        Log time
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Log time: ${goal.title}`}
        closeLabel={logged ? "Done" : "Cancel"}
      >
        <div className="px-1 pb-2">
          <LogTimeForm key={round} goals={[goal]} goalId={goal.id} onLogged={() => setLogged(true)} />
        </div>
      </Sheet>
    </>
  );
}

/**
 * Did it / Didn't on an unconfirmed past goal block (Timeline detail sheet). Did it confirms all of
 * it; "Part of it" asks how many minutes from its start. Didn't counts it as lost.
 */
export function SettleBlock({ eventId, minutes }: { eventId: string; minutes: number }) {
  const router = useRouter();
  const [pending, setPending] = useState<"did" | "part" | "didnt" | null>(null);
  const [part, setPart] = useState(false);
  const [partMinutes, setPartMinutes] = useState(Math.max(5, Math.round(minutes / 2 / 5) * 5));
  const [result, setResult] = useState<LogActionResult | null>(null);

  if (result?.ok) return <Logged message={result.message} recommendationId={result.recommendationId} />;

  async function settle(did: boolean, which: "did" | "part" | "didnt", m?: number) {
    if (pending) return;
    setPending(which);
    setResult(null);
    try {
      const r = await settleBlockAction({ eventId, did, minutes: m ?? null });
      setResult(r);
      if (r.ok) startTransition(() => router.refresh());
    } catch {
      setResult({ ok: false, error: "I lost the line. Nothing changed." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-subhead text-label-2">No data proves this block yet. Did you do it?</p>
      {part ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-subhead text-label-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={minutes}
              aria-label="Minutes done"
              value={partMinutes}
              onChange={(e) => setPartMinutes(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              className="min-h-9 w-[4.5rem] rounded-full bg-fill px-3 text-subhead font-semibold text-label tnum outline-none"
            />
            of {minutes} min
          </label>
          <button
            type="button"
            onClick={() => settle(true, "part", Math.min(partMinutes, minutes))}
            disabled={pending !== null}
            aria-busy={pending === "part"}
            className={PILL}
          >
            {pending === "part" ? "Saving" : "Save"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => settle(true, "did")}
            disabled={pending !== null}
            aria-busy={pending === "did"}
            className={`${PILL} min-w-[5.5rem]`}
          >
            {pending === "did" ? "Saving" : "Did it"}
          </button>
          <button
            type="button"
            onClick={() => setPart(true)}
            disabled={pending !== null}
            className="press min-h-9 px-2 text-subhead font-semibold text-tint-text"
          >
            Part of it
          </button>
          <button
            type="button"
            onClick={() => settle(false, "didnt")}
            disabled={pending !== null}
            aria-busy={pending === "didnt"}
            className="press min-h-9 px-2 text-subhead font-semibold text-label-2"
          >
            {pending === "didnt" ? "Saving" : "Didn't"}
          </button>
        </div>
      )}
      {result && !result.ok ? (
        <p role="alert" className="text-footnote text-danger">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}
