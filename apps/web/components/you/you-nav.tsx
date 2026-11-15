"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useWide } from "@/components/use-wide";
import type { ConnectionId } from "@/lib/connections";
import { ConnectionIcon } from "./connection-icon";

// You on a laptop (#285): the list stays on the left while the section or connection page opens on
// the right, so moving between Mac, iPhone and Privacy never leaves the list. The layout keeps it
// mounted across those pages. Phones never render it: there You is the list, one page at a time.

export type NavRow = { id: ConnectionId; name: string; href: string; state: string; on: boolean };

const SECTIONS = [
  { href: "/you#privacy", label: "Privacy" },
  { href: "/you#michael", label: "Standing instructions" },
  { href: "/you#account", label: "Account" },
];

const row = "press relative flex min-h-11 items-center gap-3 px-4 py-2 text-left";
const current = "bg-[color-mix(in_srgb,var(--m-label)_6%,transparent)]";

function Separator() {
  return <span aria-hidden="true" className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" />;
}

function Group({ label, href, children }: { label: string; href: string; children: ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <Link
        href={href}
        className="press mb-1.5 inline-flex min-h-8 items-center px-4 text-footnote font-semibold text-label-2"
      >
        {label}
      </Link>
      <ul className="overflow-hidden rounded-group bg-fill">{children}</ul>
    </div>
  );
}

export function YouNav({ rows }: { rows: NavRow[] }) {
  const wide = useWide();
  const pathname = usePathname();
  if (!wide) return null;
  return (
    <nav aria-label="You" className="flex flex-col">
      {rows.length > 0 ? (
        <Group label="Connections" href="/you#connections">
          {rows.map((r, i) => {
            const here = pathname === r.href;
            return (
              <li key={r.id} className="relative">
                {i > 0 ? <Separator /> : null}
                <Link
                  href={r.href}
                  aria-current={here ? "page" : undefined}
                  className={`${row} ${here ? current : ""}`}
                >
                  <span className={r.on ? "text-label" : "text-label-2"}>
                    <ConnectionIcon id={r.id} className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body">{r.name}</span>
                    <span className="text-footnote text-label-2">{r.state}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </Group>
      ) : null}
      <Group label="Settings" href="/you">
        {SECTIONS.map((s, i) => (
          <li key={s.href} className="relative">
            {i > 0 ? <Separator /> : null}
            <Link href={s.href} className={`${row} justify-between`}>
              <span className="text-body">{s.label}</span>
              <span aria-hidden="true" className="text-label-2">
                ›
              </span>
            </Link>
          </li>
        ))}
      </Group>
    </nav>
  );
}
