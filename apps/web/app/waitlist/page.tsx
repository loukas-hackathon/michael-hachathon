import {
  WAITLIST_CALENDAR_LABELS,
  WAITLIST_COMPUTER_LABELS,
  WAITLIST_PHONE_LABELS,
  WAITLIST_ROLE_LABELS,
} from "@michael/shared/waitlist-labels";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ScreenHeader } from "@/components/screen";
import { getWaitlistAdmin } from "@/lib/waitlist";

export const metadata = { title: "Waiting list · Michael", robots: { index: false } };

// The waiting list for the founders (ADMIN_EMAILS on the API): the numbers, then everyone, newest
// first, and the CSV. Anyone else gets the plain not found page, as if it did not exist.

const athens = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Athens",
});

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

export default async function WaitlistPage() {
  const data = await getWaitlistAdmin();
  if (!data) notFound();
  const { stats, entries } = data;

  return (
    <main className="screen">
      <ScreenHeader context="Admin" title="Waiting list" />

      <p className="mt-3 text-insight text-label-2">
        <span className="tnum font-semibold text-label">{people(stats.total)}</span> waiting.{" "}
        <span className="tnum font-semibold text-label">{stats.last_7_days}</span> joined in the last 7 days.
        {stats.founding_members > 0 ? (
          <>
            {" "}
            <span className="tnum font-semibold text-label">{stats.founding_members}</span> would prepay as
            founding {stats.founding_members === 1 ? "member" : "members"}.
          </>
        ) : null}
      </p>

      {stats.total > 0 ? (
        <a
          href="/waitlist/csv"
          download
          className="press mt-4 inline-flex h-11 items-center rounded-full bg-fill px-5 text-body font-semibold text-label"
        >
          Download CSV
        </a>
      ) : null}

      {stats.total > 0 ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <Group title="By role">
            {Object.entries(stats.by_role)
              .filter(([, n]) => n > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([role, n]) => (
                <CountRow
                  key={role}
                  label={WAITLIST_ROLE_LABELS[role as keyof typeof WAITLIST_ROLE_LABELS]}
                  n={n}
                />
              ))}
          </Group>
          <Group title="By computer">
            {Object.entries(stats.by_computer)
              .filter(([, n]) => n > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([computer, n]) => (
                <CountRow
                  key={computer}
                  label={WAITLIST_COMPUTER_LABELS[computer as keyof typeof WAITLIST_COMPUTER_LABELS]}
                  n={n}
                />
              ))}
          </Group>
          {stats.top_referrers.length ? (
            <Group title="Top referrers">
              {stats.top_referrers.map((r) => (
                <CountRow key={r.referral_code} label={r.name} detail={r.email} n={r.referrals} />
              ))}
            </Group>
          ) : null}
        </div>
      ) : (
        <p className="mt-6 text-body text-label-2">Nobody yet. Share /join and the first names land here.</p>
      )}

      {entries.length ? (
        <section aria-labelledby="everyone" className="mt-8">
          <h2 id="everyone" className="mb-2 text-title3 font-bold">
            Everyone, newest first
          </h2>
          <ul className="rounded-group bg-fill">
            {entries.map((e) => (
              <li key={e.id} className={`relative flex items-start gap-3 px-4 py-3 ${separator}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-semibold">{e.name}</p>
                  <p className="truncate text-subhead text-label-2">{e.email}</p>
                  <p className="mt-0.5 text-footnote text-label-2">
                    {[
                      WAITLIST_ROLE_LABELS[e.role],
                      `${e.hours_lost_per_week}h lost a week`,
                      WAITLIST_COMPUTER_LABELS[e.computer],
                      WAITLIST_PHONE_LABELS[e.phone],
                      `${WAITLIST_CALENDAR_LABELS[e.calendar]} calendar`,
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
        </section>
      ) : null}
    </main>
  );
}

const separator =
  "[&+&]:before:absolute [&+&]:before:inset-x-0 [&+&]:before:top-0 [&+&]:before:ml-4 [&+&]:before:h-[0.5px] [&+&]:before:bg-separator [&+&]:before:content-['']";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-title3 font-bold">{title}</h2>
      <ul className="rounded-group bg-fill">{children}</ul>
    </section>
  );
}

function CountRow({ label, detail, n }: { label: string; detail?: string; n: number }) {
  return (
    <li className={`relative flex min-h-11 items-center gap-3 px-4 py-2.5 ${separator}`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{label}</span>
        {detail ? <span className="block truncate text-footnote text-label-2">{detail}</span> : null}
      </span>
      <span className="tnum shrink-0 text-body text-label-2">{n}</span>
    </li>
  );
}
