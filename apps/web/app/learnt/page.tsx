import Link from "next/link";
import { Progress } from "@/components/learnt/evidence";
import { PatternCard } from "@/components/learnt/pattern-card";
import { StudySeries } from "@/components/learnt/study-series";
import { Studying } from "@/components/learnt/studying";
import {
  type Insight,
  type Insights,
  joinNames,
  sortInsights,
  sourceNames,
  studyProgress,
  watchingLine,
} from "@/lib/insights";
import { getInsights, isInsightsPreview } from "@/lib/insights-data";

export const metadata = { title: "What I have learnt · Michael" };

const sectionTitle = "mb-2 flex items-baseline justify-between gap-3 text-title3 font-bold";
const BACK: Record<string, { href: string; label: string }> = {
  you: { href: "/you", label: "You" },
  today: { href: "/", label: "Today" },
};

/** "84 days studied. 31,204 data points from 8 sources." The days lead, as the score does on Today. */
function StudyCounter({ studied }: { studied: Insights["studied"] }) {
  const names = sourceNames(studied.sources);
  return (
    <section aria-label="What I studied" className="mt-4">
      <p className="flex items-baseline gap-2">
        <span className="font-num text-[56px] leading-none font-extrabold tracking-[-0.02em] tnum">
          {studied.days}
        </span>
        <span className="text-title3 font-semibold">{studied.days === 1 ? "day" : "days"} studied.</span>
      </p>
      <p className="mt-2 text-subhead text-label-2 tnum">
        <b className="font-semibold text-label">{studied.data_points.toLocaleString("en-GB")}</b> data points
        from {names.length} {names.length === 1 ? "source" : "sources"}: {joinNames(names)}.
      </p>
    </section>
  );
}

// What I have learnt (#432): Michael studies the user across sources. The study at the top (days,
// data points, the body over 12 weeks), then the patterns that held, then what he is still
// watching. A new account sees how far the study has come, never a blank page.
export default async function LearntPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; from?: string }>;
}) {
  const { demo, from } = await searchParams;
  const view = await getInsights(demo);
  const preview = isInsightsPreview(demo);
  const back = BACK[from ?? ""] ?? { href: "/", label: "Today" };
  const sorted = view ? sortInsights(view.insights) : { patterns: [], watching: [] };
  const { patterns, watching } = sorted;
  const progress = view ? studyProgress(view.studied) : null;
  // The nights the sleep line marks: the late phone chain's trigger evenings, when it is a pattern.
  // A sleep figure marking its own nights says nothing, so no other trigger is marked.
  const late = lateNights(patterns);

  return (
    <main className="screen screen-mid">
      <header className="flex min-h-11 items-center pt-2">
        <Link
          href={back.href}
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
          {back.label}
        </Link>
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">What I have learnt</h1>

      {!view ? (
        <p className="mt-4 rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
          I can't read what I have learnt right now. Try again in a minute.
        </p>
      ) : (
        <>
          <StudyCounter studied={view.studied} />
          {view.series?.length ? (
            <StudySeries series={view.series} triggerDays={late?.days} occasion={late?.occasion} />
          ) : null}

          {patterns.length ? (
            <section className="mt-8">
              <h2 className={sectionTitle}>
                Patterns
                <span className="text-footnote font-semibold text-label-2 tnum">{patterns.length}</span>
              </h2>
              <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
                {patterns.map((i) => (
                  <PatternCard key={i.id} insight={i} preview={preview} />
                ))}
              </div>
            </section>
          ) : progress && !progress.done ? (
            <Studying studied={view.studied} />
          ) : (
            <p className="mt-8 rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
              {/* (Brand) */}Nothing has held 4 times yet. I keep watching.
            </p>
          )}

          {watching.length ? (
            <section className="mt-8">
              <h2 className={sectionTitle}>Still studying</h2>
              <ul className="overflow-hidden rounded-group bg-fill">
                {watching.map((i, n) => (
                  <li key={i.id} className="relative px-4 py-3">
                    {n > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                    <p className="text-body font-semibold">{i.title}</p>
                    <p className="mt-0.5 text-subhead text-label-2 tnum">{i.line}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Progress insight={i} />
                      <span className="text-footnote text-label-2 tnum">{watchingLine(i)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="mt-6 px-4 text-footnote text-label-2">
            {/* (Brand) */}A pattern has to hold at least 4 times before I show it here. I drop any that stop
            holding.
          </p>
        </>
      )}
    </main>
  );
}

const LATE = ["late_phone_min", "late_screen_min", "phone_before_sleep_min"];

/**
 * The late phone pattern's trigger evenings and how the line names them ("nights with 30 minutes or
 * more on your phone after 23:45"), read from "23 of 30 nights with ... gave ...". Chains first.
 */
function lateNights(patterns: Insight[]) {
  const trigger = (i: Insight) => /^(?:chain|link):([^>]+)>/.exec(i.id)?.[1] ?? "";
  const found = [...patterns]
    .filter((i) => LATE.includes(trigger(i)) && i.evidence.days.length)
    .sort((a, b) => (a.kind === "chain" ? 0 : 1) - (b.kind === "chain" ? 0 : 1))[0];
  const occasion = found ? /^\d+ of \d+ (nights with .+?) gave /.exec(found.line)?.[1] : undefined;
  return found && occasion ? { days: found.evidence.days, occasion } : null;
}
