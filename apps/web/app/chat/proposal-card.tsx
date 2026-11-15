"use client";

import type { Recommendation } from "@michael/shared";
import { useState } from "react";
import { ActionError } from "@/components/action-feedback";
import { formatTime } from "@/lib/format";
import {
  dismissRecommendationAction,
  doRecommendation,
  type RecActionResult,
  undoRecommendationAction,
} from "@/lib/recommendation-actions";
import { undoneLine } from "@/lib/say";
import { useAction } from "@/lib/use-action";

type State = "proposed" | "done" | "dismissed" | "undone";

const CALLS: Record<Exclude<State, "proposed">, (id: string) => Promise<RecActionResult>> = {
  done: doRecommendation,
  dismissed: dismissRecommendationAction,
  undone: undoRecommendationAction,
};

/**
 * A change Michael proposed in chat (#188): a goal's weekly budget or a set of moves on the user's
 * own calendar. Nothing happens until Accept; once accepted it can be undone like any other action.
 * Every tap shows its result at once and rolls back with Michael's reason if the server says no.
 */
export function ProposalCard({ action }: { action: Recommendation }) {
  const [state, setState] = useState<State>(
    action.status === "proposed" ? "proposed" : (action.status as State),
  );
  const [until, setUntil] = useState<string | null>(action.action?.undo_until ?? null);
  const act = useAction((next: Exclude<State, "proposed">) => CALLS[next](action.id), {
    optimistic: (next) => {
      const before = state;
      setState(next);
      return () => setState(before);
    },
    onSuccess: (res, next) => {
      if (res.ok && next === "done") setUntil(res.rec.action?.undo_until ?? null);
    },
  });

  const pill = "hit press min-h-9 rounded-full px-3.5 text-subhead font-semibold disabled:opacity-40";
  return (
    <div className="flex max-w-[85%] flex-col gap-2 rounded-card bg-fill px-3.5 py-2.5">
      <p className="text-body text-label">{action.title}</p>
      {state === "proposed" ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={act.pending}
            onClick={() => void act.run("done")}
            className={`${pill} bg-tint text-on-tint`}
          >
            Accept
          </button>
          <button
            type="button"
            disabled={act.pending}
            onClick={() => void act.run("dismissed")}
            className={`${pill} text-tint-text`}
          >
            Not now
          </button>
        </div>
      ) : state === "done" ? (
        <button
          type="button"
          disabled={act.pending}
          aria-busy={act.pending || undefined}
          onClick={() => void act.run("undone")}
          className={`m-swap ${pill} self-start bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] text-tint-text`}
        >
          Done. Undo{until ? ` until ${formatTime(until)}` : ""}
        </button>
      ) : (
        <p className="m-swap text-footnote text-label-2" role="status">
          {state === "dismissed" ? "Left as it was." : undoneLine("Back as it was.")}
        </p>
      )}
      <ActionError error={act.error} onRetry={act.retry} />
    </div>
  );
}
