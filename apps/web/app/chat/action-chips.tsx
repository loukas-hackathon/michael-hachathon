"use client";

import type { Recommendation } from "@michael/shared";
import { useState } from "react";
import { ActionError } from "@/components/action-feedback";
import { formatUntil } from "@/lib/format";
import { useAction } from "@/lib/use-action";
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
  // Optimistic: the chip reads Undone at once and comes back with the reason if it fails.
  const undo = useAction(() => undoAction(action.id), {
    optimistic: () => {
      setUndone(true);
      return () => setUndone(false);
    },
  });
  const until = action.action?.undo_until;
  const open = !undone && action.status === "done" && (!until || Date.parse(until) > Date.now());

  if (!open) {
    return (
      <p className={`px-1 text-footnote text-label-2 ${undone ? "m-swap" : ""}`} role="status">
        {undone ? `Undone: ${action.title}` : `Done: ${action.title}`}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={undo.pending}
        aria-busy={undo.pending || undefined}
        onClick={() => void undo.run()}
        className="press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text disabled:opacity-40"
      >
        Done. Undo{until ? ` until ${formatUntil(until)}` : ""}
      </button>
      <ActionError error={undo.error} onRetry={undo.retry} className="px-1" />
    </div>
  );
}
