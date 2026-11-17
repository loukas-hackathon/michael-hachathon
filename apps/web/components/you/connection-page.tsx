import Link from "next/link";
import type { ReactNode } from "react";
import type { ConnectionStatus } from "@/lib/connections-status";
import { ConnectionIcon } from "./connection-icon";
import { LiveStatusLine, WaitOnTap } from "./connection-live-status";

// The frame of every connection's setup page: back to You, the name, what it gives Michael, and
// its real status in one line. The page's own steps and switches go below.
// Opened from onboarding's connect step (?from=onboarding), back goes to that step instead.
export function ConnectionPage({
  row,
  children,
  from,
}: {
  row: ConnectionStatus;
  children: ReactNode;
  from?: string;
}) {
  const back =
    from === "onboarding"
      ? { href: "/onboarding?step=connect", label: "Setup" }
      : { href: "/you#connections", label: "You" };
  return (
    <main className="screen">
      <header className="flex min-h-11 items-center pt-2">
        <Link
          href={back.href}
          className="press -ml-2 flex h-11 items-center gap-1 px-2 text-body text-tint-text"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {back.label}
        </Link>
      </header>
      <div className="mt-1 flex items-center gap-3">
        <ConnectionIcon id={row.id} className="size-8" />
        <h1 className="text-large-title font-bold tracking-[0.01em]">{row.name}</h1>
      </div>
      <p className="mt-1 text-subhead text-label-2">{row.what}</p>
      {/* Live (#466): flips to Connected the moment it lands, and says when it is waiting. */}
      <LiveStatusLine row={row} />
      {/* Coming soon (#295): no steps, no keys, nothing that could fail on stage. */}
      {row.state === "soon" ? null : <WaitOnTap row={row}>{children}</WaitOnTap>}
    </main>
  );
}

/** A titled block on a setup page. */
export function SetupSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-title3 font-bold">{title}</h2>
      {children}
      {note ? <p className="mt-2 px-4 text-footnote text-label-2">{note}</p> : null}
    </section>
  );
}
