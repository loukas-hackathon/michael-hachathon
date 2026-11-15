import Link from "next/link";
import { getInsights, isInsightsPreview } from "@/lib/insights-data";
import { type NumberStat, numberStats, unitOf } from "@/lib/numbers";
import { numbersLine } from "@/lib/today-lines";

/**
 * Today, under "Your next move": the figures Michael reads every day as plain tiles, each with one
 * verdict against the user's own usual. Nothing more on Today: the chart, the comparison in
 * figures, the fix and the patterns behind it are one tap away on /numbers/[key]. Nothing until
 * the API has two readings of something.
 */
export async function TodayNumbers({ demo, className = "" }: { demo?: string; className?: string }) {
  const view = await getInsights(demo);
  if (!view) return null;
  const stats = numberStats(view.series ?? []);
  if (!stats.length) return null;
  const q = isInsightsPreview(demo) && demo ? `?demo=${demo}` : "";
  // Which of their figures to look at first, from today's verdicts; nothing when all are usual.
  const line = numbersLine(stats.map((s) => ({ name: SHORT[s.def.key] ?? s.series.label, tone: s.tone })));
  return (
    <section aria-labelledby="your-numbers" className={`mt-8 ${className}`}>
      <h2 id="your-numbers" className={`text-title3 font-bold ${line ? "" : "mb-2"}`}>
        Your numbers
      </h2>
      {line ? <p className="mt-0.5 mb-2 text-footnote text-label-2">{line}</p> : null}
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6 xl:gap-3">
        {stats.map((s) => (
          <NumberTile key={s.def.key} stat={s} q={q} />
        ))}
      </ul>
    </section>
  );
}

/** One word for anyone: is it good or bad for me. The figures behind it are on the detail page. */
const VERDICT: Record<NumberStat["tone"], string> = {
  better: "Better than usual",
  usual: "About usual",
  worse: "Worse than usual",
};

/** Names short enough for a tile. */
const SHORT: Partial<Record<NumberStat["def"]["key"], string>> = {
  lost_min: "Lost in goal blocks",
  hrv: "Heart rate variability",
};

function NumberTile({ stat, q }: { stat: NumberStat; q: string }) {
  const { def, series, last, tone } = stat;
  const name = SHORT[def.key] ?? series.label;
  return (
    <li>
      <Link
        href={`/numbers/${def.key}${q}`}
        aria-label={`${name}: ${last.value}${unitOf(series)}, ${VERDICT[tone].toLowerCase()}. Open the detail`}
        className="press flex h-full flex-col rounded-card bg-fill px-3.5 pt-3 pb-3"
      >
        <span className="line-clamp-2 text-footnote text-label-2">{name}</span>
        <span className="mt-auto pt-1 tnum">
          <b className="font-num text-[28px] leading-8 font-bold">{last.value}</b>
          <span className="text-footnote font-semibold text-label-2">{unitOf(series)}</span>
        </span>
        <span className={`text-footnote ${tone === "worse" ? "font-semibold text-label" : "text-label-2"}`}>
          {VERDICT[tone]}
        </span>
      </Link>
    </li>
  );
}
