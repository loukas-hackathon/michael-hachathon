import Link from "next/link";
import { type Insight, sortInsights } from "@/lib/insights";
import { getInsights, isInsightsPreview } from "@/lib/insights-data";
import { firstSentence, type NumberStat, numberStats, patternsFor, unitOf } from "@/lib/numbers";
import { Spark } from "./spark";

/**
 * Today, under "Your next move": the figures Michael reads every day, each against the user's own
 * usual, with its last two weeks and one fix. A fix with proof comes from a pattern Michael found;
 * otherwise it is advice and says nothing about proof. Each row opens its detail. Nothing until
 * the API has two readings of something.
 */
export async function TodayNumbers({ demo, className = "" }: { demo?: string; className?: string }) {
  const view = await getInsights(demo);
  if (!view) return null;
  const stats = numberStats(view.series ?? []);
  if (!stats.length) return null;
  const { patterns } = sortInsights(view.insights);
  const q = isInsightsPreview(demo) && demo ? `?demo=${demo}` : "";
  return (
    <section aria-labelledby="your-numbers" className={`mt-8 ${className}`}>
      <h2 id="your-numbers" className="text-title3 font-bold">
        Your numbers
      </h2>
      {/* (Brand) */}
      <p className="mt-0.5 mb-2 text-footnote text-label-2">
        Each against your own usual over the last 4 weeks. Tap one for the detail and the fix.
      </p>
      {/* A phone: one grouped list. A laptop: a band of tiles across the dashboard. */}
      <ul className="overflow-hidden rounded-group bg-fill xl:grid xl:grid-cols-3 xl:gap-3 xl:overflow-visible xl:rounded-none xl:bg-transparent">
        {stats.map((s) => (
          <NumberRow key={s.def.key} stat={s} pattern={patternsFor(s.def.key, patterns)[0]} q={q} />
        ))}
      </ul>
    </section>
  );
}

const LEAD = { worse: "Fix:", usual: "To do better:" } as const;

/**
 * The line under a figure. Worse or usual: one fix, from the pattern when Michael found one.
 * Better than usual: a pattern's fix is about the bad days ("on mornings like that"), so it would
 * read wrong after "Keep it up"; the pattern shows as the reason to keep it, and advice is left out.
 */
function FixLine({
  tone,
  pattern,
  fallback,
}: {
  tone: NumberStat["tone"];
  pattern?: Insight;
  fallback: string;
}) {
  if (tone === "better") {
    return (
      <>
        <b className="font-semibold">Keep it up.</b>
        {pattern ? (
          <span className="text-label-2">
            {" "}
            Found in your data: {pattern.title.charAt(0).toLowerCase()}
            {pattern.title.slice(1)}.
          </span>
        ) : null}
      </>
    );
  }
  return (
    <>
      <b className="font-semibold">{LEAD[tone]}</b> {firstSentence(pattern?.fix.text ?? fallback)}
      <span className="text-label-2">
        {pattern ? " Found in your data." : " General advice, not yet seen in your data."}
      </span>
    </>
  );
}

function NumberRow({ stat, pattern, q }: { stat: NumberStat; pattern?: Insight; q: string }) {
  const { def, series, last, usual, tone, compare, when } = stat;
  return (
    <li className="border-separator border-b last:border-b-0 xl:rounded-card xl:border-b-0 xl:bg-fill">
      <Link
        href={`/numbers/${def.key}${q}`}
        className="press grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-4 py-2.5 xl:py-3"
      >
        <span className="min-w-0">
          <span className="block truncate text-footnote text-label-2">
            {series.label} <span aria-hidden="true">·</span> {when}
          </span>
          <span className="block tnum">
            <b className="font-num text-[24px] leading-7 font-bold">{last.value}</b>
            <span className="text-footnote font-semibold text-label-2">{unitOf(series)}</span>
          </span>
          <span
            className={`block text-footnote tnum ${tone === "worse" ? "font-semibold text-label" : "text-label-2"}`}
          >
            {compare.charAt(0).toUpperCase() + compare.slice(1)}.
          </span>
        </span>
        <Spark series={series} usual={usual} />
        <span aria-hidden="true" className="text-label-2">
          ›
        </span>
        <span className="col-span-3 mt-1.5 block text-footnote">
          <FixLine tone={tone} pattern={pattern} fallback={def.fallback} />
        </span>
      </Link>
    </li>
  );
}
