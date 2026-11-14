import { EmptyState } from "@/components/empty-state";
import { DayColumns, NotchTrack, SleepBars, SplitBar } from "@/components/goals/goal-charts";
import { ScreenHeader } from "@/components/screen";
import { getGoalsWeek } from "@/lib/api";
import { formatWeekday, hm } from "@/lib/format";
import { pace, rank, todayIndex } from "@/lib/goals-view";

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const week = await getGoalsWeek(demo);
  const p = pace(week);
  const today = todayIndex(week);
  const daysLeft = 7 - today - 1;
  const ranked = rank(week);
  const need = ranked.reduce((n, r) => n + r.leftMinutes, 0);
  const cap = Math.max(60, ...week.goals.flatMap((g) => g.daily.map((m) => m ?? 0)));
  const context = `${formatWeekday(week.now)}. ${daysLeft === 0 ? "Last day" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go`}.`;

  return (
    <main className="screen">
      <ScreenHeader context={context} title="Goals" />

      {week.goals.length === 0 ? (
        <EmptyState title="No goals yet.">
          Tell Michael what you're working towards and how many hours a week it needs.
        </EmptyState>
      ) : (
        <>
          <p className="mt-1.5 text-subhead text-label-2">
            Furthest behind first. The black tick is where you should be by now.
          </p>

          <ul className="mt-4 overflow-hidden rounded-group bg-fill">
            {ranked.map(({ goal, behind, leftMinutes }, i) => (
              <li key={goal.id} className="relative px-4 pt-3 pb-3.5">
                {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-body font-semibold">{goal.title}</h2>
                  <p className="shrink-0 text-subhead text-label-2 tnum">
                    <b className="font-semibold text-label">{hm(goal.spentMinutes)}</b> of{" "}
                    {hm(goal.budgetMinutes)}
                  </p>
                </div>
                <div className="mt-1.5 flex items-end gap-3.5">
                  <div className="min-w-0 flex-1">
                    <NotchTrack
                      budget={goal.budgetMinutes}
                      spent={goal.spentMinutes}
                      pace={p}
                      label={`${hm(goal.spentMinutes)} of ${hm(goal.budgetMinutes)}, ${behind ? "behind" : "ahead of"} pace`}
                    />
                  </div>
                  <DayColumns daily={goal.daily} today={today} cap={cap} />
                </div>
                <p className="mt-1.5 text-footnote text-label-2 tnum">
                  {leftMinutes === 0 ? (
                    <b className="font-semibold text-label">Done for the week.</b>
                  ) : (
                    <>
                      {behind ? <b className="font-semibold text-label">Behind pace.</b> : "Ahead of pace."}{" "}
                      {hm(leftMinutes)} left.
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>

          {need > week.freeMinutesLeft ? (
            <section className="mt-6">
              <h2 className="mb-2 text-title3 font-bold">The maths</h2>
              <div className="rounded-group bg-fill px-4 pt-3 pb-3.5">
                <p className="text-subhead">
                  {ranked.length === 1
                    ? "This goal needs"
                    : `${["", "", "These two", "These three", "These four"][ranked.length] ?? `These ${ranked.length}`} need`}{" "}
                  <b className="font-semibold tnum">{hm(need)}</b> more this week. You have{" "}
                  <b className="font-semibold tnum">{hm(week.freeMinutesLeft)}</b> free. Which one gives?
                </p>
                <SplitBar
                  parts={[...ranked]
                    .sort((a, b) => b.leftMinutes - a.leftMinutes)
                    .map((r) => ({ title: r.goal.title, minutes: r.leftMinutes }))}
                  freeMinutes={week.freeMinutesLeft}
                />
              </div>
            </section>
          ) : null}

          {week.sleep ? (
            <section className="mt-6">
              <h2 className="mb-2 text-title3 font-bold">Sleep</h2>
              <div className="flex items-end justify-between gap-4 rounded-group bg-fill px-4 py-3">
                <div className="min-w-0">
                  {(() => {
                    const nights = week.sleep.nightly.filter((n): n is number => n != null);
                    const avg = nights.length ? nights.reduce((a, b) => a + b, 0) / nights.length : 0;
                    return (
                      <>
                        <p className="text-body font-semibold tnum">{hm(avg)} a night</p>
                        <p className="text-footnote text-label-2 tnum">
                          Goal {hm(week.sleep.goalMinutes)}. Outside the score.
                        </p>
                      </>
                    );
                  })()}
                </div>
                <SleepBars nightly={week.sleep.nightly} goal={week.sleep.goalMinutes} />
              </div>
            </section>
          ) : null}
        </>
      )}

      {week.sample ? (
        <p className="mt-8 text-footnote text-label-2">
          Sample week. Your goals appear here once you set them with Michael.
        </p>
      ) : null}
    </main>
  );
}
