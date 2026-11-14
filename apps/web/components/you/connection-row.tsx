import Link from "next/link";
import { syncCalendar } from "@/app/you/google-calendar-actions";
import type { ConnectionAction, ConnectionStatus } from "@/lib/connections-status";
import { ConnectionIcon } from "./connection-icon";

// One row per connection on You: icon, plain name, real status, one action. The name and status
// open the setup page; the action on the right does the one obvious next thing.

// One button for every row: same shape, same colour, same width. "Connect" until it sends, then
// "Manage". Only the label changes, so the list reads as one calm column.
const button =
  "press flex h-9 w-[6.5rem] shrink-0 items-center justify-center rounded-full bg-tint/14 text-subhead font-semibold text-tint-text";

function Action({ action, style }: { action: ConnectionAction; style: string }) {
  if (action.kind === "sync-calendar") {
    return (
      <form action={syncCalendar}>
        <button type="submit" className={style}>
          {action.label}
        </button>
      </form>
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

// The list says the state in the same words on every row; the detail ("Last data 3 min ago",
// "Connected as ...") is on the connection's own page.
const STATE_WORDS: Record<ConnectionStatus["state"], string> = {
  on: "Connected",
  none: "Not connected",
  paused: "Paused",
  attention: "Needs attention",
  unavailable: "Not available yet",
  unknown: "Could not check",
};

export function ConnectionRow({ row }: { row: ConnectionStatus }) {
  const style = button;
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
