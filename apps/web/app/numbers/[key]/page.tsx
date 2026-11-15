import Link from "next/link";
import { notFound } from "next/navigation";
import { Evidence } from "@/components/learnt/evidence";
import { FixRow } from "@/components/learnt/fix-button";
import { PatternCard } from "@/components/learnt/pattern-card";
import { NumberChart } from "@/components/numbers/number-chart";
import { sortInsights } from "@/lib/insights";
import { getInsights, isInsightsPreview } from "@/lib/insights-data";
import { numberDef, numberStat, patternsFor, unitOf, weekly } from "@/lib/numbers";

const sectionTitle = "mb-2 text-title3 font-bold";

/**
 * One of Today's numbers in full: the last reading against the usual in a sentence, its chart over
 * 2 or 12 weeks, four figures to compare, the fix (one tap when Michael found it in the data), the
 * patterns behind it and how it is measured.
 */
export default async function NumberPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ demo?: string }>;
}) {
  const [{ key }, { demo }] = await Promise.all([params, searchParams]);
  const def = numberDef(key);
  if (!def) notFound();
  const view = await getInsights(demo);
  const preview = isInsightsPreview(demo);
  const series = view?.series?.find((s) => s.key === def.key);
  const stat = series ? numberStat(series) : null;
  const patterns = view ? patternsFor(def.key, sortInsights(view.insights).patterns) : [];
  const top = patterns[0];
  const back = `/${preview && demo ? `?demo=${demo}` : ""}`;

  return (
    <main className="screen screen-mid">
      <header className="flex min-h-11 items-center pt-2">
        <Link
          href={back}
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
      <h1 className="text-large-title font-bold tracking-[0.01em]">{series?.label ?? "Your numbers"}</h1>

      {!series || !stat ? (
        <p className="mt-4 rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
          {view
            ? "Not enough readings of this yet. It shows here after two."
            : "I can't read your numbers right now. Try again in a minute."}
        </p>
      ) : (
        <>
          <p className="mt-2 text-title3 font-semibold tnum">
            <span className="font-num text-[44px] leading-[48px] font-extrabold tracking-[-0.02em]">
              {stat.last.value}
            </span>
            <span className="text-title3 font-bold text-label-2">{unitOf(series)}</span>
            <span className="block">
              {stat.when}, {stat.compare}.
            </span>
          </p>

          <section aria-label="Over time" className="mt-6">
            <NumberChart daily={series} weekly={weekly(series)} usual={stat.usual} unit={unitOf(series)} />
          </section>

          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-group bg-separator sm:grid-cols-4">
            {[
              ["Last 7 days", stat.week],
              ["7 days before", stat.weekBefore],
              ["Your usual", stat.usual],
              ["Best in 12 weeks", stat.best],
            ].map(([label, v]) => (
              <div key={label as string} className="bg-fill px-4 py-3">
                <dt className="text-footnote text-label-2">{label}</dt>
                <dd className="font-num text-title3 font-bold tnum">
                  {v == null ? "No readings" : `${v}${unitOf(series)}`}
                </dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="what-to-do" className="mt-8">
            <h2 id="what-to-do" className={sectionTitle}>
              What to do
            </h2>
            {top ? (
              <div className="rounded-card bg-fill px-4 pt-3.5 pb-4">
                <p className="text-subhead font-semibold">{top.title}</p>
                <p className="mt-1 text-subhead text-label-2 tnum">{top.line}</p>
                <Evidence insight={top} className="mt-3" />
                <FixRow id={top.id} fix={top.fix} preview={preview} />
              </div>
            ) : (
              <div className="rounded-card bg-fill px-4 py-3.5">
                <p className="text-subhead font-semibold">{def.fallback}</p>
                {/* (Brand) */}
                <p className="mt-1 text-footnote text-label-2">
                  General advice. I haven't seen it hold in your own data yet; when I do, it shows here with
                  the proof.
                </p>
              </div>
            )}
          </section>

          {patterns.length > 1 ? (
            <section aria-labelledby="what-moves-it" className="mt-8">
              <h2 id="what-moves-it" className={sectionTitle}>
                Also linked to it
              </h2>
              <div className="grid gap-3">
                {patterns.slice(1, 4).map((i) => (
                  <PatternCard key={i.id} insight={i} preview={preview} />
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="how-measured" className="mt-8">
            <h2 id="how-measured" className={sectionTitle}>
              How I measure it
            </h2>
            <p className="text-subhead text-label-2">{def.what}</p>
            <p className="mt-2 text-subhead text-label-2">
              Your usual is the mean of the 28 readings before the last one.{" "}
              <Link
                href={`/learnt${preview && demo ? `?demo=${demo}` : ""}`}
                className="font-semibold text-tint-text"
              >
                Everything I have learnt ›
              </Link>
            </p>
          </section>
        </>
      )}
    </main>
  );
}
