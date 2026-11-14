"use client";

import type { Recommendation } from "@michael/shared";
import { useState, useTransition } from "react";
import { formatTime } from "@/lib/format";
import { undoAction } from "./actions";
import { ProposalCard } from "./proposal-card";

/** What Michael did while answering, each with its undo until the block starts. */
export function ActionChips({ actions }: { actions: Recommendation[] }) {
  return (
    <ul className="mt-1 flex flex-col items-start gap-1">
      {actions.map((a) => (
        <li key={a.id}>
          <ActionChip action={a} />
        </li>
      ))}
    </ul>
  );
}

function ActionChip({ action }: { action: Recommendation }) {
  // A proposal (#188) waits for the user's tap instead.
  if (action.status === "proposed") return <ProposalCard action={action} />;
  return <DoneChip action={action} />;
}

function DoneChip({ action }: { action: Recommendation }) {
  const [undone, setUndone] = useState(action.status === "undone");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const until = action.action?.undo_until;
  const open = !undone && action.status === "done" && (!until || Date.parse(until) > Date.now());

  if (!open) {
    return (
      <p className="px-1 text-footnote text-label-2" role="status">
        {undone ? `Undone: ${action.title}` : `Done: ${action.title}`}
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await undoAction(action.id);
            if (res.ok) setUndone(true);
            else setError(res.error);
          })
        }
        className="press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text disabled:opacity-40"
      >
        Done. Undo{until ? ` until ${formatTime(until)}` : ""}
      </button>
      {error ? (
        <span role="alert" className="text-footnote text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
