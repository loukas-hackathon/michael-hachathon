import type { ReactNode } from "react";
import { DEMO_SAMPLE } from "@/components/you/connections-list";
import { ConnectionsLive } from "@/components/you/connections-live";
import { type NavRow, YouNav } from "@/components/you/you-nav";
import { signedInAs } from "@/lib/account";
import { STATE_WORDS } from "@/lib/connection-words";
import { getConnections } from "@/lib/connections-status";

// You on a laptop (#285): two panes. The list on the left (YouNav, laptop only), the page on the
// right: You itself, or a connection's page, without leaving the list. A phone gets the page alone,
// exactly as before: the grid and the list only exist from 1280 px.
export default async function YouLayout({ children }: { children: ReactNode }) {
  // Shared with the page (cached per request); a failure leaves the list out, never the page.
  const [view, account] = await Promise.all([getConnections().catch(() => null), signedInAs()]);
  const demo = account === "The demo week";
  // Every connection, as on the phone's list (#380), in the same words.
  const rows: NavRow[] = (view?.rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    href: r.href,
    state: demo && DEMO_SAMPLE.has(r.id) ? "Sample data" : STATE_WORDS[r.state],
    on: r.state === "on",
    live: demo && DEMO_SAMPLE.has(r.id) ? undefined : r.state,
  }));
  // Live rows (#466): You, its list on a laptop and every connection page flip the moment a
  // connection lands. Demo visitors watch nothing: the demo week is replayed.
  const initial = demo ? [] : (view?.rows ?? []).map((r) => ({ id: r.id, state: r.state }));
  return (
    <ConnectionsLive initial={initial}>
      <div className="m-dash m-panes xl:grid xl:grid-cols-[18rem_minmax(0,1fr)] xl:items-start xl:gap-4">
        <aside className="hidden xl:sticky xl:top-0 xl:block xl:max-h-dvh xl:overflow-y-auto xl:pt-[3.75rem] xl:pb-8 xl:pl-4">
          <YouNav rows={rows} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </ConnectionsLive>
  );
}
