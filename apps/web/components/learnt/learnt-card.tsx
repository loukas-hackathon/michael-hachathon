import Link from "next/link";
import { type Insights, sortInsights, studyProgress } from "@/lib/insights";
import { getInsights, isInsightsPreview } from "@/lib/insights-data";
import { Evidence } from "./evidence";
import { FixRow } from "./fix-button";

/**
 * Today: the strongest pattern Michael has learnt, with its proof and the fix (#432). It sits
 * after "Your next move", so the score and the next move keep the first screen. Until something is
 * a pattern, one quiet line says how far the study has come. Nothing when the API cannot be read.
 */
export function LearntCard({
  view,
  demo,
  preview,
}: {
  view: Insights | null;
  demo?: string;
  preview: boolean;
}) {
  if (!view) return null;
  const href = `/learnt${preview && demo ? `?demo=${demo}` : ""}`;
  const { patterns, watching } = sortInsights(view.insights);
  const top = patterns[0];

  if (!top) {
    // Before anything is a pattern: one quiet line, so the study shows from day one (#432).
    const { have, needed, done } = studyProgress(view.studied);
    const bar = watching[0]?.evidence.needed ?? 4;
    const rest = done
      ? watching.length
        ? `${watching.length} ${watching.length === 1 ? "thing" : "things"} seen, none held ${bar} times yet.`
        : `Nothing has held ${bar} times yet.`
      : have === 0
        ? `I start tonight and need ${needed} nights.`
        : `${have} of ${needed} nights so far.`;
    return (
      <Link
        href={href}
        className="press mt-6 flex items-start justify-between gap-3 text-subhead text-label-2 tnum"
      >
        <span>
          <b className="font-semibold text-label">Studying you.</b> {rest}
        </span>
        <span aria-hidden="true" className="shrink-0">
          ›
        </span>
      </Link>
    );
  }

  return (
    <article className="mt-6 rounded-card bg-fill px-4 pt-3.5 pb-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-footnote font-semibold text-label-2">Michael has learnt</h2>
        <Link
          href={href}
          className="press -my-2 -mr-2 flex min-h-11 items-center px-2 text-footnote font-semibold text-tint-text tnum"
        >
          {patterns.length > 1 ? `All ${patterns.length} patterns` : "What I have learnt"}
          <span aria-hidden="true" className="ml-1">
            ›
          </span>
        </Link>
      </header>
      <p className="text-title3 font-bold">{top.title}</p>
      <p className="mt-1 text-subhead text-label-2 tnum">{top.line}</p>
      <Evidence insight={top} className="mt-3" />
      <FixRow id={top.id} fix={top.fix} preview={preview} />
    </article>
  );
}

/** Today's slot: reads the insights behind its own Suspense, so the score never waits on them. */
export async function TodayLearnt({ demo }: { demo?: string }) {
  const view = await getInsights(demo);
  return <LearntCard view={view} demo={demo} preview={isInsightsPreview(demo)} />;
}
