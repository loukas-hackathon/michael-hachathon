"use client";

import { useRef, useState } from "react";
import { bookGoalAction } from "@/app/goals/book-actions";
import { formatTime, hm } from "@/lib/format";
import { undoRecommendationAction } from "@/lib/recommendation-actions";
import { dayWord } from "@/lib/recommendations";

// Book time for a goal (#309): one tap finds the first free slot this week and puts it in the
// calendar; the line that replaces the button says when, and Undo takes it back until it starts.
// Not optimistic (michael-feedback R3): only the server knows the slot, so the button shows
// "Booking" until it answers.

type State =
  | { at: "idle" }
  | { at: "booking" }
  | { at: "booked"; id: string; start: string; end: string; undoUntil: string | null }
  | { at: "undoing"; id: string; start: string; end: string; undoUntil: string | null }
  | { at: "undone" };

const filled =
  "press min-h-9 min-w-[7.5rem] rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint disabled:opacity-60";
const tinted =
  "press min-h-9 min-w-[7.5rem] rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text disabled:opacity-60";

export function BookTime({
  goalId,
  minutes,
  primary = false,
}: {
  goalId: string;
  minutes: number;
  /** The screen's one filled button; every other Book button is tinted. */
  primary?: boolean;
}) {
  const [state, setState] = useState<State>({ at: "idle" });
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function book() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setState({ at: "booking" });
    try {
      const r = await bookGoalAction(goalId, minutes);
      if (r.ok) setState({ at: "booked", id: r.id, start: r.start, end: r.end, undoUntil: r.undoUntil });
      else {
        setState({ at: "idle" });
        setError(r.error);
      }
    } catch {
      setState({ at: "idle" });
      setError("I could not reach the server. Nothing changed.");
    } finally {
      busy.current = false;
    }
  }

  async function undo() {
    if (busy.current || (state.at !== "booked" && state.at !== "undoing")) return;
    const before = state;
    busy.current = true;
    setError(null);
    setState({ ...before, at: "undoing" });
    try {
      const r = await undoRecommendationAction(before.id);
      if (r.ok) setState({ at: "undone" });
      else {
        setState({ ...before, at: "booked" });
        setError(r.error);
      }
    } catch {
      setState({ ...before, at: "booked" });
      setError("I could not reach the server. Nothing changed.");
    } finally {
      busy.current = false;
    }
  }

  const now = new Date();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
        {state.at === "booked" || state.at === "undoing" ? (
          <>
            <p role="status" className="m-swap flex-1 text-subhead font-semibold tnum">
              Booked {dayWord(state.start, now).toLowerCase()} {formatTime(state.start)} to{" "}
              {formatTime(state.end)}.
              {state.undoUntil ? (
                <span className="font-normal text-label-2"> Undo until {formatTime(state.undoUntil)}.</span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={undo}
              disabled={state.at === "undoing"}
              aria-busy={state.at === "undoing"}
              className={tinted.replace("min-w-[7.5rem]", "min-w-[5.5rem]")}
            >
              {state.at === "undoing" ? "Undoing" : "Undo"}
            </button>
          </>
        ) : state.at === "undone" ? (
          <p role="status" className="m-swap text-subhead text-label-2">
            Undone. Your calendar is back as it was.
          </p>
        ) : (
          <button
            type="button"
            onClick={book}
            disabled={state.at === "booking"}
            aria-busy={state.at === "booking"}
            className={primary ? filled : tinted}
          >
            {state.at === "booking" ? "Booking" : `Book ${hm(minutes)}`}
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
