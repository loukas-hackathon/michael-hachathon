"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { syncCalendar } from "@/app/you/google-calendar-actions";
import { ActionButton } from "@/components/action-button";
import { TelegramConnectLink } from "@/components/telegram-connect-link";
import { Thinking } from "@/components/thinking";
import { FINISH_ELSEWHERE, STATE_WORDS } from "@/lib/connection-words";
import type { ConnectionId } from "@/lib/connections";
import type { ConnectionAction, ConnectionStatus } from "@/lib/connections-status";
import { isOn, rowLine, waitingLine } from "@/lib/live-connections";
import { TELEGRAM_CONNECT } from "@/lib/one-tap";
import { ConnectionIcon } from "./connection-icon";
import { useLiveConnection } from "./connections-live";

// One row per connection on You: icon, plain name, real status, one action. The name and status
// open the setup page; the action on the right does the one obvious next thing. Live (#466): the
// row follows components/you/connections-live.tsx, so it flips to Connected the moment the
// connection lands, without a reload.

// One button for every row: same shape, same colour, same width. "Connect" until it sends, then
// "Manage". Only the label changes, so the list reads as one calm column.
export const CONNECTION_BUTTON =
  "hit press flex h-9 w-[6.5rem] shrink-0 items-center justify-center rounded-full bg-tint/14 text-subhead font-semibold text-tint-text";

// The new word grows from where the line starts.
const FROM_LEFT = { "--m-origin": "0 50%" } as CSSProperties;

function Action({
  action,
  style,
  onConnect,
  swap,
}: {
  action: ConnectionAction;
  style: string;
  onConnect?: () => void;
  swap: boolean;
}) {
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
  const label: ReactNode = (
    <span key={action.label} className={swap ? "m-swap" : undefined}>
      {action.label}
    </span>
  );
  const onClick = action.label === "Connect" ? onConnect : undefined;
  // Plain <a> for the Google and Telegram hops, so nothing prefetches a route that redirects off
  // site. Telegram opens beside the app, so this page stays here, waiting, and flips by itself.
  if (action.external) {
    const beside = onConnect !== undefined && action.label === "Connect";
    // Telegram from the installed app: handed to the Telegram app (tg://), never t.me in place,
    // since the app has no back button and its cookies do not reach Safari.
    if (action.href === TELEGRAM_CONNECT) {
      return (
        <TelegramConnectLink className={style} onOpen={onClick} newTab={beside}>
          {label}
        </TelegramConnectLink>
      );
    }
    return (
      <a
        href={action.href}
        className={style}
        onClick={onClick}
        target={beside ? "_blank" : undefined}
        rel={beside ? "noopener" : undefined}
      >
        {label}
      </a>
    );
  }
  return (
    <Link href={action.href} className={style} onClick={onClick}>
      {label}
    </Link>
  );
}

export function ConnectionRow({
  row,
  sample = false,
  arrived: arrivedHere = false,
}: {
  row: ConnectionStatus;
  sample?: boolean;
  /** The server knows it just landed (back from Google with ?connected=): pop on first paint. */
  arrived?: boolean;
}) {
  const live = useLiveConnection(row.id as ConnectionId, row.state, row.fresh);
  // The demo week: this source is replayed, not connected. Say so, with nothing to tap.
  if (sample) {
    return (
      <div className="flex min-h-16 items-center gap-3 py-2.5 pr-4 pl-4">
        <ConnectionIcon id={row.id} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body">{row.name}</span>
          <span className="text-footnote text-label-2">Replayed</span>
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
  // Back from Google with ?connected=: Connected on first paint, before any poll.
  const state = arrivedHere ? "on" : live.state;
  const on = isOn(state);
  const arrived = on && (live.arrived || arrivedHere);
  // Flipped before the server render caught up: the button already says Manage.
  const action: ConnectionAction =
    on && row.action.kind === "link" && row.action.label === "Connect"
      ? { kind: "link", label: "Manage", href: row.href }
      : row.action;
  const lineColour = state === "attention" ? "text-danger" : "text-label-2";
  const word = STATE_WORDS[state];
  const waitsElsewhere = FINISH_ELSEWHERE.has(row.id);
  return (
    <div className="flex min-h-16 items-center gap-3 pr-4" data-connection={row.id} data-state={state}>
      <Link href={row.href} className="press flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4">
        <span className={on ? "text-label" : "text-label-2"}>
          <ConnectionIcon id={row.id} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-body">{row.name}</span>
          {live.waiting ? (
            <Thinking text={waitingLine(row.name)} />
          ) : (
            <span
              key={word}
              style={arrived ? FROM_LEFT : undefined}
              className={`truncate text-footnote tnum ${lineColour} ${arrived ? "m-pop-in" : ""}`}
            >
              {on ? rowLine(word, live.fresh, arrived) : rowLine(word, row.note, true)}
            </span>
          )}
        </span>
      </Link>
      <Action
        action={action}
        style={CONNECTION_BUTTON}
        swap={arrived}
        onConnect={waitsElsewhere ? live.wait : undefined}
      />
    </div>
  );
}
