import Link from "next/link";
import { GoalBar } from "@/components/goals/goal-charts";
import { getGoalsWeek } from "@/lib/api";
import { hm } from "@/lib/format";
import { closeState, pace, rank } from "@/lib/goals-view";

// Today on a laptop (#285): the week at a glance in the right column. Each time goal as one bar
// against its weekly budget with the pace tick, furthest behind first, the same bar as Goals. The
// whole group opens Goals. Hidden on phones, where Goals is one tap away in the tab bar.

const MAX = 5;

export async function WeekGlance({ demo, className = "" }: { demo?: string; className?: string }) {
  const week = await getGoalsWeek(demo).catch(() => null);
  if (!week) return null;
  const ranked = rank(week).filter((r) => r.goal.budgetMinutes > 0);
  if (ranked.length === 0) return null;
  const p = pace(week);
  const shown = ranked.slice(0, MAX);
  const spent = ranked.reduce((n, r) => n + r.goal.spentMinutes, 0);
  const budget = ranked.reduce((n, r) => n + r.goal.budgetMinutes, 0);
  return (
    <section aria-labelledby="week-glance" className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="week-glance" className="text-title3 font-bold">
          This week
        </h2>
        <p className="text-footnote text-label-2 tnum">
          {hm(spent)} of {hm(budget)}
        </p>
      </div>
      <Link
        href={`/goals${demo === "sample" ? "?demo=sample" : ""}`}
        aria-label="This week's goals. Open Goals"
        className="press block rounded-group bg-fill px-4 pt-3 pb-1"
      >
        <ul className="flex flex-col">
          {shown.map((r) => (
            <li key={r.goal.id} className="pb-3">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-subhead font-semibold">{r.goal.title}</span>
                <span className="shrink-0 text-footnote text-label-2 tnum">
                  {hm(r.goal.spentMinutes)} of {hm(r.goal.budgetMinutes)}
                </span>
              </div>
              <GoalBar
                budget={r.goal.budgetMinutes}
                spent={r.goal.spentMinutes}
                unverified={r.goal.unverifiedMinutes}
                planned={r.goal.plannedMinutes}
                pace={p}
                close={closeState(r.goal.budgetMinutes, r.goal.spentMinutes, r.leftMinutes)}
                label={`${r.goal.title}: ${hm(r.goal.spentMinutes)} of ${hm(r.goal.budgetMinutes)}, ${r.behind ? "behind" : "on or ahead of"} pace`}
              />
            </li>
          ))}
        </ul>
        {ranked.length > shown.length ? (
          <p className="pb-3 text-footnote text-label-2">{ranked.length - shown.length} more in Goals.</p>
        ) : null}
      </Link>
    </section>
  );
}
