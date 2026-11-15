import Link from "next/link";
import { syncCalendar } from "@/app/you/google-calendar-actions";
import { ActionButton } from "@/components/action-button";
import { STATE_WORDS } from "@/lib/connection-words";
import type { ConnectionAction, ConnectionStatus } from "@/lib/connections-status";
import { ConnectionIcon } from "./connection-icon";

// One row per connection on You: icon, plain name, real status, one action. The name and status
// open the setup page; the action on the right does the one obvious next thing.

// One button for every row: same shape, same colour, same width. "Connect" until it sends, then
// "Manage". Only the label changes, so the list reads as one calm column.
export const CONNECTION_BUTTON =
  "hit press flex h-9 w-[6.5rem] shrink-0 items-center justify-center rounded-full bg-tint/14 text-subhead font-semibold text-tint-text";

function Action({ action, style }: { action: ConnectionAction; style: string }) {
  if (action.kind === "none") return null;
  if (action.kind === "sync-calendar") {
    return (
      <ActionButton
        action={syncCalendar}
        label={action.label}
        pendingLabel="Syncing"
        className={style}
        showResult={false}
      />
    );
  }
  // Plain <a> for the Google hop, so nothing prefetches a route that redirects off site.
  return action.external ? (
    <a href={action.href} className={style}>
      {action.label}
    </a>
  ) : (
    <Link href={action.href} className={style}>
      {action.label}
    </Link>
  );
}

export function ConnectionRow({ row, sample = false }: { row: ConnectionStatus; sample?: boolean }) {
  // The demo week: this source is replayed, not connected. Say so, with nothing to tap.
  if (sample) {
    return (
      <div className="flex min-h-16 items-center gap-3 py-2.5 pr-4 pl-4">
        <ConnectionIcon id={row.id} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body">{row.name}</span>
          <span className="text-footnote text-label-2">Sample data</span>
        </span>
      </div>
    );
  }
  // Not proven on production yet (#295): the same row, quieter, and nothing to tap.
  if (row.state === "soon") {
    return (
      <div className="flex min-h-16 items-center gap-3 py-2.5 pr-4 pl-4">
        <span className="text-label-2">
          <ConnectionIcon id={row.id} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body text-label-2">{row.name}</span>
          <span className="text-footnote text-label-2">{row.what}</span>
        </span>
        <span className="shrink-0 text-footnote font-semibold text-label-2">Coming soon</span>
      </div>
    );
  }
  const style = CONNECTION_BUTTON;
  const lineColour = row.state === "attention" ? "text-danger" : "text-label-2";
  return (
    <div className="flex min-h-16 items-center gap-3 pr-4">
      <Link href={row.href} className="press flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4">
        <span className={row.state === "on" ? "text-label" : "text-label-2"}>
          <ConnectionIcon id={row.id} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-body">{row.name}</span>
          <span className={`text-footnote ${lineColour}`}>{STATE_WORDS[row.state]}</span>
        </span>
      </Link>
      <Action action={row.action} style={style} />
    </div>
  );
}
