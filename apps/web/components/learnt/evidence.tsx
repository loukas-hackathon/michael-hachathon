import { evidenceDots, heldLine, type Insight } from "@/lib/insights";

/**
 * The proof under a pattern: one dot per time the first step happened, oldest first. Filled when
 * the rest of the chain followed, a ring when it did not. "Held 9 of 11 times." beside it.
 */
export function Evidence({ insight, className = "" }: { insight: Insight; className?: string }) {
  const dots = evidenceDots(insight);
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}>
      <span aria-hidden="true" className="flex flex-wrap gap-[5px]">
        {dots.map((held, n) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional, oldest first
            key={n}
            className={`size-2 rounded-full ${held ? "bg-label" : "shadow-[inset_0_0_0_1.5px_var(--m-label-2)]"}`}
          />
        ))}
      </span>
      <span className="text-footnote font-semibold tnum">{heldLine(insight)}</span>
    </p>
  );
}

/** Still studying: how far a watched pattern is from counting, as segments to `needed`. */
export function Progress({ insight }: { insight: Insight }) {
  const { times_held: held, needed } = insight.evidence;
  return (
    <span aria-hidden="true" className="flex gap-1">
      {Array.from({ length: needed }, (_, n) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          key={n}
          className={`h-1.5 w-5 rounded-full ${n < held ? "bg-label" : "bg-separator"}`}
        />
      ))}
    </span>
  );
}
