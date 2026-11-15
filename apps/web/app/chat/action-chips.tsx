"use client";

import type { Recommendation } from "@michael/shared";
import { useState } from "react";
import { ActionError } from "@/components/action-feedback";
import { formatUntil } from "@/lib/format";
import { useAction } from "@/lib/use-action";
import { undoAction } from "./actions";
import { ProposalCard } from "./proposal-card";

/**
 * What Michael did while answering, each with its undo until the block starts. `quiet` (the voice
 * conversation, where no reply is on screen): each chip names what changed, small and centred.
 */
export function ActionChips({ actions, quiet = false }: { actions: Recommendation[]; quiet?: boolean }) {
  return (
    <ul className={`flex flex-col gap-1 ${quiet ? "items-center" : "mt-1 items-start"}`}>
      {actions.map((a) => (
        <li key={a.id} className={quiet ? "m-pop-in max-w-full" : undefined}>
          <ActionChip action={a} quiet={quiet} />
        </li>
      ))}
    </ul>
  );
}

function ActionChip({ action, quiet }: { action: Recommendation; quiet: boolean }) {
  // A proposal (#188) waits for the user's tap instead.
  if (action.status === "proposed") return <ProposalCard action={action} />;
  return quiet ? <QuietChip action={action} /> : <DoneChip action={action} />;
}

/** The voice conversation's chip: what changed, and Undo beside it until the block starts. */
function QuietChip({ action }: { action: Recommendation }) {
  const [undone, setUndone] = useState(action.status === "undone");
  const undo = useAction(() => undoAction(action.id), {
    optimistic: () => {
      setUndone(true);
      return () => setUndone(false);
    },
  });
  const until = action.action?.undo_until;
  const open = !undone && action.status === "done" && (!until || Date.parse(until) > Date.now());
  return (
    <div className="flex max-w-full flex-col items-center gap-1" data-testid="voice-action">
      <div className="flex min-h-9 max-w-full items-center gap-1 rounded-full bg-fill py-0.5 pr-0.5 pl-3.5 text-footnote">
        <span key={undone ? "undone" : "done"} role="status" className="m-swap min-w-0 truncate text-label-2">
          {undone ? `Undone: ${action.title}` : action.title}
        </span>
        {open ? (
          <button
            type="button"
            disabled={undo.pending}
            aria-busy={undo.pending || undefined}
            aria-label={`Undo ${action.title}${until ? ` until ${formatUntil(until)}` : ""}`}
            onClick={() => void undo.run()}
            className="press min-h-8 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3 font-semibold text-tint-text disabled:opacity-40"
          >
            Undo
          </button>
        ) : (
          <span aria-hidden="true" className="w-3 shrink-0" />
        )}
      </div>
      <ActionError error={undo.error} onRetry={undo.retry} className="px-1" />
    </div>
  );
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
