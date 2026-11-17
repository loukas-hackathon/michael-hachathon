import type { Traction, TractionCohort, TractionGoalWeek, TractionWaitingList } from "@michael/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BarLabel, ProgressBar } from "@/components/progress-bar";
import { CopyJoinLink, CopySummary } from "@/components/traction/copy-summary";
import { HoursChart, RolesBar, SourcesList, WaitlistTrend } from "@/components/traction/waitlist-charts";
import {
  FOUNDING_PRICE_EUR,
  headlineRows,
  hoursPhrase,
  investorSummary,
  pct,
  rolesPhrase,
  setupPhrase,
  sourcesPhrase,
  total,
  weekChange,
  weekLabel,
} from "@/lib/traction";
import { getTraction } from "@/lib/traction-data";

// Traction (admins only): the founders' numbers for investors, from GET /v1/admin/traction. Numbers
// and charts only, no names and no emails anywhere, so it is safe on a projector or a shared
// screen (the names live on /waitlist). Anyone else meets a calm not found, the same as a page that
// is not there. Number first: the waiting list as the one headline and its sentence, Copy for
// investors, then the evidence, each block a sentence first and a chart second; then the app's own
// accounts, retention, goal time and what Michael did. No pink above the app section: pink is goal
// time and there is none on a waiting list.

export const metadata = { title: "Traction", robots: { index: false, follow: false } };

const sectionTitle = "mb-2 text-title3 font-bold";
const sentence = "mb-3 text-subhead text-label-2";

export default async function TractionPage() {
  let t: Traction | null;
  try {
    t = await getTraction();
  } catch (err) {
    console.error("traction:", err);
    return (
      <Shell context="Traction">
        <p className="mt-4 text-body">I could not read the numbers just now. Try again in a minute.</p>
      </Shell>
    );
  }
  if (!t) notFound();
  const at = new Date(t.generated_at);
  const stamp = `${at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: t.timezone })}, ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: t.timezone })}`;
  const w = t.waiting_list;
  return (
    <Shell context={`Traction · ${stamp}`}>
      <Headline t={t} />
      {w.total > 0 ? <Evidence w={w} /> : null}

      <h2 className="mt-12 text-large-title font-bold tracking-[0.01em]" id="in-the-app">
        In the app
      </h2>
      <AppHeadline t={t} />
      <div className="lg:grid lg:grid-cols-2 lg:gap-x-6">
        <SignUpChart t={t} />
        <Retention cohorts={t.retention.cohorts} />
        <GoalTime t={t} />
        <Engagement t={t} />
      </div>
      <p className="mt-8 text-footnote text-label-2">
        Real users only: the demo account, its visitors and the judges&apos; copies, and our own addresses are
        left out ({t.excluded_accounts} {t.excluded_accounts === 1 ? "account" : "accounts"}, {w.excluded} on
        the waiting list). {t.active.rule} Weeks run Monday to Sunday, Athens time. Hours lost are self
        reported.
      </p>
    </Shell>
  );
}

function Shell({ context, children }: { context: string; children: ReactNode }) {
  return (
    <main className="screen screen-wide">
      <header className="flex min-h-11 items-center justify-between gap-3 pt-2">
        <Link
          href="/"
          className="press -ml-2 flex h-11 items-center gap-1 px-2 text-body font-semibold text-tint-text"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path
              d="m15 5-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Today
        </Link>
        <p className="min-w-0 truncate text-footnote font-semibold text-label-2 tnum">{context}</p>
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">Waiting list</h1>
      {children}
    </main>
  );
}

const athensDay = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(iso));

/** The one headline number: people waiting, and the sentence that says what it means. */
function Headline({ t }: { t: Traction }) {
  const w = t.waiting_list;
  if (w.total === 0) {
    return (
      <section aria-label="Headline" className="mt-3">
        <p className="text-insight text-label-2">Nobody yet. Share /join and the first names land here.</p>
        <CopyJoinLink />
      </section>
    );
  }
  const change = weekChange(w, athensDay(t.generated_at, t.timezone));
  return (
    <section aria-label="Headline" className="mt-3" data-testid="traction-headline">
      <p className="font-num text-score font-extrabold tracking-[-0.02em] tnum [font-size:min(var(--text-score),24vw)]">
        {w.total.toLocaleString("en-GB")}
      </p>
      <p className="mt-1 max-w-[34ch] text-insight text-label-2">
        {w.total === 1 ? "person" : "people"} waiting.{" "}
        <span className="tnum font-semibold text-label">{w.last_7_days}</span> joined this week
        {change === "First week." || change === null ? "." : <>, {change}.</>}
        {change === "First week." ? " First week." : null}
      </p>
      <CopySummary text={investorSummary(t)} />
    </section>
  );
}

function Block({
  id,
  title,
  line,
  children,
}: {
  id: string;
  title: string;
  line: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className={sectionTitle}>
        {title}
      </h2>
      <p className={sentence}>{line}</p>
      {children}
    </section>
  );
}

const Num = ({ children }: { children: ReactNode }) => (
  <span className="tnum font-semibold text-label">{children}</span>
);

/** The evidence, each block a sentence first and a chart second: two columns on a laptop. */
function Evidence({ w }: { w: TractionWaitingList }) {
  const referredShare = w.total ? w.referred / w.total : 0;
  const perReferrer = w.referrers ? Math.round((w.referred / w.referrers) * 10) / 10 : 0;
  const roles = rolesPhrase(w);
  const sources = sourcesPhrase(w);
  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-x-6">
      <WaitlistTrend w={w} />
      <Block
        id="time-lost"
        title="Time lost"
        line={
          w.median_hours === null ? (
            "Nobody said yet."
          ) : (
            <>
              They lose a median of <Num>{hoursPhrase(w.median_hours)}</Num> a week.
            </>
          )
        }
      >
        <HoursChart w={w} />
        <p className="mt-2 text-footnote text-label-2">Self reported, when they joined.</p>
      </Block>
      <div>
        <Block
          id="intent"
          title="Founding members"
          line={
            w.founding_members === 0 ? (
              "Nobody has said they would prepay yet."
            ) : (
              <>
                <Num>{w.founding_members}</Num> would prepay as founding{" "}
                {w.founding_members === 1 ? "member" : "members"}. That&apos;s{" "}
                <Num>€{(w.founding_members * FOUNDING_PRICE_EUR).toLocaleString("en-GB")}</Num> a month of
                stated intent.
              </>
            )
          }
        >
          <p className="-mt-1 text-footnote text-label-2">Stated intent, not revenue.</p>
        </Block>
        <Block
          id="referrals"
          title="Referrals"
          line={
            w.referred === 0 ? (
              "Nobody has joined through a friend yet."
            ) : (
              <>
                <Num>{Math.round(referredShare * 100)}%</Num> joined through a friend. Each referrer brought{" "}
                <Num>{perReferrer}</Num>.
              </>
            )
          }
        >
          {w.referred > 0 ? (
            <ProgressBar value={referredShare} size="sm" label="Joined through a friend" />
          ) : null}
        </Block>
      </div>
      <Block id="who" title="Who" line={roles ? `${roles}.` : "Nobody yet."}>
        <RolesBar w={w} />
      </Block>
      <div>
        <Block id="setup" title="Setup" line={setupPhrase(w) ?? "Nobody yet."} />
        <Block id="sources" title="Sources" line={sources ? `Top sources: ${sources}.` : "Nobody yet."}>
          <SourcesList w={w} />
        </Block>
      </div>
    </div>
  );
}

/** The app's own accounts: the four numbers investors ask next, under the waiting list. */
function AppHeadline({ t }: { t: Traction }) {
  const thisWeek = t.sign_ups.weeks.at(-1)?.sign_ups ?? 0;
  return (
    <section aria-label="Accounts" className="mt-2">
      <p className="text-insight text-label-2">
        <Num>{t.sign_ups.total.toLocaleString("en-GB")}</Num>{" "}
        {t.sign_ups.total === 1 ? "person signed up" : "people signed up"}
        {thisWeek > 0 ? (
          <>
            , <Num>{thisWeek}</Num> this week.
          </>
        ) : (
          "."
        )}
      </p>
      <ul className="mt-4 rounded-group bg-fill lg:max-w-[calc(50%-12px)]">
        {headlineRows(t).map((r) => (
          <li
            key={r.label}
            className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 relative [&+li]:before:absolute [&+li]:before:inset-x-0 [&+li]:before:top-0 [&+li]:before:ml-4 [&+li]:before:h-[0.5px] [&+li]:before:bg-separator [&+li]:before:content-['']"
          >
            <span className="min-w-0">
              <span className="block truncate text-body">{r.label}</span>
              <span className="block truncate text-footnote text-label-2 tnum">{r.note}</span>
            </span>
            <span className="shrink-0 text-body font-semibold tnum">{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SignUpChart({ t }: { t: Traction }) {
  const weeks = t.sign_ups.weeks;
  const max = Math.max(...weeks.map((w) => w.sign_ups));
  return (
    <section aria-labelledby="signups" className="mt-8">
      <h2 id="signups" className={sectionTitle}>
        Sign ups by week
      </h2>
      {max === 0 ? (
        <p className="text-subhead text-label-2">No sign ups in the last 8 weeks.</p>
      ) : (
        <ol className="flex h-40 items-end gap-2" aria-label="Sign ups in each of the last 8 weeks">
          {weeks.map((w, i) => {
            const now = i === weeks.length - 1;
            return (
              <li
                key={w.week_start}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-caption font-medium text-label-2 tnum">
                  {w.sign_ups > 0 ? w.sign_ups : ""}
                </span>
                <span
                  aria-hidden="true"
                  className={`block w-full max-w-10 rounded-t-[4px] ${now ? "bg-label" : "bg-context"}`}
                  style={{ height: `${(w.sign_ups / max) * 100}px` }}
                />
                <span className="text-caption font-medium text-label-2 tnum whitespace-nowrap">
                  {now ? "Now" : weekLabel(w.week_start)}
                </span>
                <span className="sr-only">
                  {`${w.sign_ups} in the week of ${weekLabel(w.week_start)}, ${w.active} active`}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Retention({ cohorts }: { cohorts: TractionCohort[] }) {
  return (
    <section aria-labelledby="retention" className="mt-8">
      <h2 id="retention" className={sectionTitle}>
        Retention
      </h2>
      {cohorts.length === 0 ? (
        <p className="text-subhead text-label-2">No sign up cohorts in the last 8 weeks.</p>
      ) : (
        <>
          <table className="w-full rounded-group bg-fill text-subhead tnum">
            <thead>
              <tr className="text-footnote text-label-2">
                <th scope="col" className="py-2.5 pl-4 text-left font-normal">
                  Signed up
                </th>
                <th scope="col" className="py-2.5 text-right font-normal">
                  People
                </th>
                <th scope="col" className="py-2.5 text-right font-normal">
                  Week 1
                </th>
                <th scope="col" className="py-2.5 text-right font-normal">
                  Week 2
                </th>
                <th scope="col" className="py-2.5 pr-4 text-right font-normal">
                  Week 4
                </th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.week_start} className="shadow-[inset_0_0.5px_0_0_var(--m-separator)]">
                  <th scope="row" className="py-2.5 pl-4 text-left font-semibold whitespace-nowrap">
                    {weekLabel(c.week_start)}
                  </th>
                  <td className="py-2.5 text-right">{c.sign_ups}</td>
                  {c.retention.map((r) => (
                    <td
                      key={r.week}
                      className={`py-2.5 text-right last:pr-4 ${r.complete ? "font-semibold" : "text-label-2"}`}
                    >
                      {r.share === null ? <span className="sr-only">not yet</span> : pct(r.share)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-footnote text-label-2">
            Share of each week&apos;s sign ups active in the 1st, 2nd and 4th week after. Grey: that week is
            still running.
          </p>
        </>
      )}
    </section>
  );
}

function GoalRow({ title, w }: { title: string; w: TractionGoalWeek }) {
  if (w.users === 0 || w.elapsed_minutes === 0) {
    return (
      <div>
        <BarLabel title={title} value="Nothing planned yet" />
      </div>
    );
  }
  return (
    <div>
      <BarLabel
        title={title}
        value={`${pct(w.share)}, ${total(w.spent_minutes)} of ${total(w.elapsed_minutes)}`}
      />
      <ProgressBar
        value={w.share ?? 0}
        tone="spark"
        className="mt-2"
        label={`${title}: ${total(w.spent_minutes)} of ${total(w.elapsed_minutes)} planned goal time kept`}
      />
      <p className="mt-1.5 text-footnote text-label-2 tnum">
        {w.users} {w.users === 1 ? "person" : "people"}
        {w.won_back_minutes > 0 ? `, ${total(w.won_back_minutes)} won back` : ""}
      </p>
    </div>
  );
}

function GoalTime({ t }: { t: Traction }) {
  const g = t.goal_time;
  return (
    <section aria-labelledby="goal-time" className="mt-8">
      <h2 id="goal-time" className={sectionTitle}>
        Goal time kept
      </h2>
      <div className="flex flex-col gap-5">
        <GoalRow title="This week, so far" w={g.this_week} />
        <GoalRow title="Last week" w={g.last_week} />
      </div>
      {g.capped ? (
        <p className="mt-2 text-footnote text-label-2">The {g.users_scored} most active people are scored.</p>
      ) : null}
    </section>
  );
}

function Engagement({ t }: { t: Traction }) {
  const e = t.engagement;
  const rows: [string, number][] = [
    ["Actions carried out", e.actions_done],
    ["Of those, undone", e.actions_undone],
    ["Chat messages", e.chat_messages],
    ["Nudges sent", e.nudges_sent],
    ["Claude connector queries", e.connector_queries],
  ];
  return (
    <section aria-labelledby="engagement" className="mt-8">
      <h2 id="engagement" className={sectionTitle}>
        Michael at work
      </h2>
      {rows.every(([, n]) => n === 0) ? (
        <p className="text-subhead text-label-2">Nothing carried out, asked or sent yet.</p>
      ) : (
        <ul className="rounded-group bg-fill">
          {rows.map(([label, n]) => (
            <li
              key={label}
              className="flex min-h-12 items-center justify-between gap-3 px-4 relative [&+li]:before:absolute [&+li]:before:inset-x-0 [&+li]:before:top-0 [&+li]:before:ml-4 [&+li]:before:h-[0.5px] [&+li]:before:bg-separator [&+li]:before:content-['']"
            >
              <span className="min-w-0 truncate text-body">{label}</span>
              <span className="shrink-0 text-body font-semibold tnum">{n.toLocaleString("en-GB")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
