"use client";

import type { Recommendation } from "@michael/shared";
import { useState, useTransition } from "react";
import { formatTime } from "@/lib/format";
import {
  dismissRecommendationAction,
  doRecommendation,
  undoRecommendationAction,
} from "@/lib/recommendation-actions";

type State = "proposed" | "done" | "dismissed" | "undone";

/**
 * A change Michael proposed in chat (#188): a goal's weekly budget or a set of moves on the user's
 * own calendar. Nothing happens until Accept; once accepted it can be undone like any other action.
 */
export function ProposalCard({ action }: { action: Recommendation }) {
  const [state, setState] = useState<State>(
    action.status === "proposed" ? "proposed" : (action.status as State),
  );
  const [until, setUntil] = useState<string | null>(action.action?.undo_until ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const act = (call: (id: string) => ReturnType<typeof doRecommendation>, next: State) =>
    startTransition(async () => {
      setError(null);
      const res = await call(action.id);
      if (!res.ok) return setError(res.error);
      setState(next);
      if (next === "done") setUntil(res.rec.action?.undo_until ?? null);
    });

  const pill = "press min-h-9 rounded-full px-3.5 text-subhead font-semibold disabled:opacity-40";
  return (
    <div className="flex max-w-[85%] flex-col gap-2 rounded-card bg-fill px-3.5 py-2.5">
      <p className="text-body text-label">{action.title}</p>
      {state === "proposed" ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => act(doRecommendation, "done")}
            className={`${pill} bg-tint text-on-tint`}
          >
            Accept
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(dismissRecommendationAction, "dismissed")}
            className={`${pill} text-tint-text`}
          >
            Not now
          </button>
        </div>
      ) : state === "done" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => act(undoRecommendationAction, "undone")}
          className={`${pill} self-start bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] text-tint-text`}
        >
          Done. Undo{until ? ` until ${formatTime(until)}` : ""}
        </button>
      ) : (
        <p className="text-footnote text-label-2" role="status">
          {state === "dismissed" ? "Left as it was." : "Undone. Back as it was."}
        </p>
      )}
      {error ? (
        <span role="alert" className="text-footnote text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
