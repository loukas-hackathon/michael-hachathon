import type { ReactNode } from "react";
import { ProgressBar } from "@/components/progress-bar";
import type { FirstInsight } from "@/lib/first-insight";
import { hm } from "@/lib/format";

// The first number about the user's own week, shown on the connect step as soon as Google Calendar
// is in (docs/ux-audit.md, "Proposed first minute", step 4). The number leads the sentence; the
// evidence sits under it: one bar per goal, the booked hours outlined (still ahead, as on the tape),
// the unbooked rest in the context grey. No pink: nothing is spent yet.

const N = ({ children }: { children: ReactNode }) => (
  <span className="font-semibold text-label tnum">{children}</span>
);

export function FirstInsightCard({ insight }: { insight: FirstInsight }) {
  const { planned, budget } = insight;
  const gap = Math.max(0, budget - planned);

  return (
    <section aria-label="Your week so far" className="rounded-card bg-fill px-4 pt-3.5 pb-4">
      <p className="text-footnote font-semibold text-label-2">This week, from your calendar</p>

      <p className="mt-1.5 text-insight text-label-2">
        {planned > 0 ? (
          <>
            You planned <N>{hm(planned)}</N> for your goals this week.{" "}
            {gap > 0 ? (
              <>
                They ask for <N>{hm(budget)}</N>. I'll find room for the other <N>{hm(gap)}</N>.
              </>
            ) : (
              <>
                That covers the <N>{hm(budget)}</N> they ask for. Now we hold it.
              </>
            )}
          </>
        ) : (
          <>
            Nothing on your calendar is booked for your goals this week. They ask for <N>{hm(budget)}</N>.
            That's the first thing we fix.
          </>
        )}
      </p>

      {/* Nothing booked at all: the sentence says it, a column of empty bars would only repeat it. */}
      {planned > 0 ? (
        <ul className="mt-4 flex flex-col gap-3">
          {insight.goals.map((g) => (
            <li key={g.title}>
              <div className="flex items-baseline justify-between gap-3 text-subhead">
                <span className="min-w-0 truncate font-semibold">{g.title}</span>
                <span className="shrink-0 text-label-2 tnum">
                  {hm(g.planned)} of {hm(g.budget)}
                </span>
              </div>
              <ProgressBar
                value={0}
                planned={g.budget > 0 ? g.planned / g.budget : 0}
                label={`${g.title}: ${hm(g.planned)} of ${hm(g.budget)} booked`}
                className="mt-1.5"
              />
            </li>
          ))}
        </ul>
      ) : null}

      {insight.sample ? (
        <p className="mt-3 text-footnote text-label-2">Sample numbers, for the preview.</p>
      ) : (
        <p className="mt-3 text-footnote text-label-2">
          Calendar only so far. The watch and the Mac add what really happened.
        </p>
      )}
    </section>
  );
}
