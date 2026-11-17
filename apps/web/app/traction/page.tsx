import type { Traction, TractionCohort, TractionGoalWeek } from "@michael/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarLabel, ProgressBar } from "@/components/progress-bar";
import { CopySummary } from "@/components/traction/copy-summary";
import { headlineRows, investorSummary, pct, total, weekLabel } from "@/lib/traction";
import { getTraction } from "@/lib/traction-data";

// Traction (admins only): the founders' numbers for investors, from GET /v1/admin/traction. Real
// users only, aggregates only. Anyone else meets a calm not found, the same as a page that is not
// there. Read top down: sign ups as the one headline, the four numbers investors ask next, sign ups
// by week, retention by cohort, goal time and what Michael did.

export const metadata = { title: "Traction", robots: { index: false, follow: false } };

const sectionTitle = "mb-2 text-title3 font-bold";

export default async function TractionPage() {
  let t: Traction | null;
  try {
    t = await getTraction();
  } catch (err) {
    console.error("traction:", err);
    return (
      <Shell>
        <p className="mt-4 text-body">I could not read the numbers just now. Try again in a minute.</p>
      </Shell>
    );
  }
  if (!t) notFound();
  return (
    <Shell>
      <Headline t={t} />
      <div className="lg:grid lg:grid-cols-2 lg:gap-x-10">
        <SignUpChart t={t} />
        <Retention cohorts={t.retention.cohorts} />
        <GoalTime t={t} />
        <Engagement t={t} />
      </div>
      <p className="mt-8 text-footnote text-label-2">
        Real users only: the demo account, its visitors and the judges&apos; copies, and our own addresses are
        left out ({t.excluded_accounts}). {t.active.rule} Weeks run Monday to Sunday, Athens time. Updated{" "}
        {new Date(t.generated_at).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: t.timezone,
        })}
        .
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="screen screen-mid">
      <header className="flex min-h-11 items-center pt-2">
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
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">Traction</h1>
      {children}
    </main>
  );
}

function Headline({ t }: { t: Traction }) {
  const thisWeek = t.sign_ups.weeks.at(-1)?.sign_ups ?? 0;
  return (
    <section aria-label="Headline numbers" className="mt-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10">
      <div className="lg:col-start-1 lg:row-start-1">
        <h2 className="flex flex-col">
          <span className="font-num text-score font-extrabold tracking-[-0.02em] tnum [font-size:min(var(--text-score),24vw)]">
            {t.sign_ups.total.toLocaleString("en-GB")}
          </span>
          <span className="text-title3 font-semibold">
            {t.sign_ups.total === 1 ? "person signed up" : "people signed up"}
            {thisWeek > 0 ? `, ${thisWeek} this week.` : "."}
          </span>
        </h2>
      </div>
      <ul className="mt-4 rounded-group bg-fill lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-2">
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
      <div className="lg:col-start-1 lg:row-start-2">
        <CopySummary text={investorSummary(t)} />
      </div>
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
