import Link from "next/link";
import { syncCalendar } from "@/app/you/google-calendar-actions";
import type { ConnectionAction, ConnectionStatus } from "@/lib/connections-status";
import { ConnectionIcon } from "./connection-icon";

// One row per connection on You: icon, plain name, real status, one action. The name and status
// open the setup page; the action on the right does the one obvious next thing.

const filled =
  "press flex h-9 shrink-0 items-center rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint";
const tinted =
  "press flex h-9 shrink-0 items-center rounded-full bg-tint/14 px-4 text-subhead font-semibold text-tint-text";
const plain = "press flex h-11 shrink-0 items-center px-1 text-subhead font-semibold text-tint-text";

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

export function ConnectionRow({ row, isNext }: { row: ConnectionStatus; isNext: boolean }) {
  const style = row.state === "none" ? (isNext ? filled : tinted) : plain;
  const lineColour = row.state === "attention" ? "text-danger" : "text-label-2";
  return (
    <div className="flex min-h-16 items-center gap-3 pr-4">
      <Link href={row.href} className="press flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4">
        <span className={row.state === "on" ? "text-label" : "text-label-2"}>
          <ConnectionIcon id={row.id} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-body">{row.name}</span>
          <span className={`text-footnote tnum ${lineColour}`}>{row.line}</span>
        </span>
      </Link>
      <Action action={row.action} style={style} />
    </div>
  );
}
