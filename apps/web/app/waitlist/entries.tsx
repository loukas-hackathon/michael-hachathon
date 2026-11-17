"use client";

import type { WaitlistAdminEntry } from "@michael/shared";
import {
  WAITLIST_CALENDAR_LABELS,
  WAITLIST_COMPUTER_LABELS,
  WAITLIST_PHONE_LABELS,
  WAITLIST_ROLE_LABELS,
} from "@michael/shared/waitlist-labels";
import { useEffect, useRef, useState } from "react";
import { haptic } from "@/components/haptics";

// Everyone on the list, newest first. A phone gets rows (name, email, a meta line, place and
// time); a laptop gets a dense table (36px rows, a sticky header, numbers right aligned) where a
// click on a row copies that email, said in place under the table's title. Admin only: names and
// emails live here, never on /traction.

const athens = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Athens",
});

const separator =
  "[&+&]:before:absolute [&+&]:before:inset-x-0 [&+&]:before:top-0 [&+&]:before:ml-4 [&+&]:before:h-[0.5px] [&+&]:before:bg-separator [&+&]:before:content-['']";

const setup = (e: WaitlistAdminEntry) =>
  `${WAITLIST_COMPUTER_LABELS[e.computer]} · ${WAITLIST_PHONE_LABELS[e.phone]} · ${WAITLIST_CALENDAR_LABELS[e.calendar]}`;

export function Entries({ entries }: { entries: WaitlistAdminEntry[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(email: string) {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(email);
      setCopied(email);
      haptic();
    } catch {
      setCopied(null);
    }
    timer.current = setTimeout(() => setCopied(null), 2000);
  }

  return (
    <section aria-labelledby="everyone" className="mt-8">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="everyone" className="text-title3 font-bold">
          Everyone, newest first
        </h2>
        <p
          key={copied ?? "none"}
          role="status"
          className="m-swap hidden min-w-0 truncate text-footnote text-label-2 lg:block"
        >
          {copied ? `Copied ${copied}.` : "Click a row to copy the email."}
        </p>
      </div>

      <ul className="rounded-group bg-fill lg:hidden">
        {entries.map((e) => (
          <li key={e.id} className={`relative flex items-start gap-3 px-4 py-3 ${separator}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold">{e.name}</p>
              <p className="truncate text-subhead text-label-2">{e.email}</p>
              <p className="mt-0.5 text-footnote text-label-2">
                {[
                  WAITLIST_ROLE_LABELS[e.role],
                  `${e.hours_lost_per_week}h lost a week`,
                  setup(e),
                  e.founding_member ? "Founding member" : null,
                  e.referrals ? `${e.referrals} referred` : null,
                  e.referred_by ? `via ${e.referred_by}` : null,
                  e.source ? `from ${e.source}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="tnum text-body font-semibold">#{e.position}</p>
              <p className="tnum text-footnote text-label-2">{athens.format(new Date(e.created_at))}</p>
            </div>
          </li>
        ))}
      </ul>

      <table className="hidden w-full text-footnote tnum lg:table">
        <thead className="sticky top-0 z-10 bg-bg shadow-[0_0.5px_0_var(--m-separator)]">
          <tr className="text-left text-label-2">
            <th scope="col" className="h-9 pr-3 text-right font-semibold">
              Place
            </th>
            <th scope="col" className="h-9 pr-3 font-semibold">
              Name
            </th>
            <th scope="col" className="h-9 pr-3 font-semibold">
              Email
            </th>
            <th scope="col" className="h-9 pr-3 font-semibold">
              Role
            </th>
            <th scope="col" className="h-9 pr-3 text-right font-semibold">
              Hours
            </th>
            <th scope="col" className="h-9 pr-3 font-semibold">
              Setup
            </th>
            <th scope="col" className="h-9 pr-3 text-right font-semibold">
              Referred
            </th>
            <th scope="col" className="h-9 pr-3 font-semibold">
              Source
            </th>
            <th scope="col" className="h-9 text-right font-semibold">
              Joined
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.id}
              onClick={() => void copy(e.email)}
              className="cursor-pointer shadow-[inset_0_-0.5px_0_var(--m-separator)] hover:bg-fill"
            >
              <td className="h-9 pr-3 text-right font-semibold">{e.position}</td>
              <td className="h-9 max-w-[12rem] truncate pr-3">
                {e.name}
                {e.founding_member ? <span className="text-label-2"> · Founding</span> : null}
              </td>
              <td className="h-9 max-w-[16rem] truncate pr-3">
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void copy(e.email);
                  }}
                  className="max-w-full truncate text-left"
                >
                  {e.email}
                </button>
              </td>
              <td className="h-9 pr-3">{WAITLIST_ROLE_LABELS[e.role]}</td>
              <td className="h-9 pr-3 text-right">{e.hours_lost_per_week}</td>
              <td className="h-9 pr-3 whitespace-nowrap text-label-2">{setup(e)}</td>
              <td className="h-9 pr-3 text-right">{e.referrals || ""}</td>
              <td className="h-9 max-w-[10rem] truncate pr-3 text-label-2">{e.source ?? ""}</td>
              <td className="h-9 text-right whitespace-nowrap text-label-2">
                {athens.format(new Date(e.created_at))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
