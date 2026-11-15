"use client";

import type { CSSProperties, ReactNode } from "react";
import { Thinking } from "@/components/thinking";
import { FINISH_ELSEWHERE } from "@/lib/connection-words";
import type { ConnectionId } from "@/lib/connections";
import type { ConnectionStatus } from "@/lib/connections-status";
import { isOn, rowLine, waitingLine } from "@/lib/live-connections";
import { useLiveConnection } from "./connections-live";

// A connection's own page, live (#466): its status line flips to Connected the moment the
// connection lands, and while it is on its way it says "Waiting for Mac…" with the Mi mark.

const FROM_LEFT = { "--m-origin": "0 50%" } as CSSProperties;

export function LiveStatusLine({ row }: { row: ConnectionStatus }) {
  const live = useLiveConnection(row.id as ConnectionId, row.state, row.fresh);
  const box = `mt-4 rounded-group bg-fill px-4 py-3 text-subhead tnum ${
    live.state === "attention" ? "text-danger" : ""
  }`;
  if (live.waiting) {
    return (
      <p className={box}>
        <Thinking text={waitingLine(row.name)} className="text-subhead text-label-2" />
      </p>
    );
  }
  // Flipped before the server render caught up, or just landed: say Connected and what arrived.
  const flipped = isOn(live.state) && !isOn(row.state);
  if (live.arrived || flipped) {
    return (
      <p className={box}>
        <span key="on" className="m-pop-in inline-block" style={FROM_LEFT}>
          {rowLine("Connected", live.fresh, true)}
        </span>
      </p>
    );
  }
  return <p className={box}>{row.line}</p>;
}

/**
 * The setup steps of a connection that finishes elsewhere (the Mac, the watch, the iPhone, Claude):
 * a tap on any of its links or buttons starts the wait, so the page flips once the first event or
 * link lands. Switches (inputs) do not count.
 */
export function WaitOnTap({ row, children }: { row: ConnectionStatus; children: ReactNode }) {
  const live = useLiveConnection(row.id as ConnectionId, row.state, row.fresh);
  const waits = FINISH_ELSEWHERE.has(row.id) && !isOn(live.state);
  return (
    <div
      className="mt-6 flex flex-col gap-6"
      onClickCapture={(e) => {
        if (!waits) return;
        const hit = (e.target as HTMLElement).closest("a, button");
        if (hit && !hit.closest("[data-no-wait]")) live.wait();
      }}
    >
      {children}
    </div>
  );
}
