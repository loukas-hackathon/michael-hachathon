import { type Insight, joinNames, sourceNames } from "@/lib/insights";
import { Chain } from "./chain";
import { Evidence } from "./evidence";
import { FixRow } from "./fix-button";

function kindLabel(i: Insight) {
  if (i.kind === "discovered" || i.found_by === "model") return "Found in your data";
  return i.kind === "chain" ? `Chain of ${i.steps.length}` : "Link";
}

/** One pattern on /learnt: what it is, its steps, the proof, and the fix with its one tap. */
export function PatternCard({ insight, preview }: { insight: Insight; preview: boolean }) {
  const names = sourceNames(insight.sources ?? []);
  return (
    <article className="flex flex-col rounded-card bg-fill px-4 pt-3.5 pb-4">
      <p className="flex flex-wrap items-baseline gap-x-2 text-footnote">
        <span className="font-semibold">{kindLabel(insight)}</span>
        {names.length ? <span className="text-label-2">{joinNames(names)}</span> : null}
      </p>
      <h3 className="mt-1 text-title3 font-bold">{insight.title}</h3>
      <p className="sr-only">{insight.line}</p>
      <Chain steps={insight.steps} />
      <Evidence insight={insight} className="mt-4" />
      {insight.fix ? <FixRow id={insight.id} fix={insight.fix} preview={preview} /> : null}
    </article>
  );
}
