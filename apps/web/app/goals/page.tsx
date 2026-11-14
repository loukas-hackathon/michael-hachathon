import { type Goal, GoalCategory } from "@michael/shared";
import { EmptyState } from "@/components/empty-state";
import { DayColumns, NotchTrack, SleepBars, SplitBar } from "@/components/goals/goal-charts";
import { AddGoal, EditGoal, type GoalDraft } from "@/components/goals/goal-sheets";
import { ScreenHeader } from "@/components/screen";
import { getGoals, getGoalsWeek } from "@/lib/api";
import { CATEGORIES, CATEGORY_TITLE, categoryOf } from "@/lib/categories";
import { formatWeekday, hm } from "@/lib/format";
import { type GoalStatus, pace, rank, todayIndex } from "@/lib/goals-view";

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const [week, all] = await Promise.all([getGoalsWeek(demo), getGoals().catch(() => [] as Goal[])]);
  const personalReady = (GoalCategory.options as readonly string[]).includes("personal");
  const drafts = new Map(all.map((g) => [g.id, draftOf(g)]));
  const paused = all.filter((g) => !g.active);
  const p = pace(week);
  const today = todayIndex(week);
  const daysLeft = 7 - today - 1;
  const ranked = rank(week);
  const need = ranked.reduce((n, r) => n + r.leftMinutes, 0);
  const cap = Math.max(60, ...week.goals.flatMap((g) => g.daily.map((m) => m ?? 0)));
  const context = `${formatWeekday(week.now)}. ${daysLeft === 0 ? "Last day" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go`}.`;
  const groups = CATEGORIES.map((c) => ({ c, items: ranked.filter((r) => r.goal.category === c) })).filter(
    (g) => g.items.length > 0,
  );
  const anyUnverified = week.goals.some((g) => g.unverifiedMinutes > 0);

  return (
    <main className="screen">
      <ScreenHeader context={context} title="Goals" actions={<AddGoal personalReady={personalReady} />} />

      {week.goals.length === 0 ? (
        <EmptyState title="No goals yet.">
          Tell Michael what you're working towards and how many hours a week it needs.
        </EmptyState>
      ) : (
        <>
          <p className="mt-1.5 text-subhead text-label-2">
            Furthest behind first. The black tick is where you should be by now.
            {anyUnverified ? " Pale pink is time not confirmed by data yet." : ""}
          </p>

          {groups.map(({ c, items }) => {
            const spent = items.reduce((n, r) => n + r.goal.spentMinutes, 0);
            const budget = items.reduce((n, r) => n + r.goal.budgetMinutes, 0);
            return (
              <section key={c} className="mt-6">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h2 className="text-title3 font-bold">{CATEGORY_TITLE[c]}</h2>
                  <p className="text-footnote text-label-2 tnum">
                    {hm(spent)} of {hm(budget)}
                  </p>
                </div>
                <ul className="overflow-hidden rounded-group bg-fill">
                  {items.map((r, i) => {
                    const row = (
                      <GoalRow key={r.goal.id} status={r} first={i === 0} pace={p} today={today} cap={cap} />
                    );
                    const draft = drafts.get(r.goal.id);
                    return draft ? (
                      <li key={r.goal.id}>
                        <EditGoal draft={draft} personalReady={personalReady}>
                          {row}
                        </EditGoal>
                      </li>
                    ) : (
                      <li key={r.goal.id}>{row}</li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {week.freeMinutesLeft != null && need > week.freeMinutesLeft ? (
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

          {week.sleep ? <SleepSection sleep={week.sleep} /> : null}

          {paused.length ? (
            <section className="mt-6">
              <h2 className="mb-2 text-title3 font-bold">Paused</h2>
              <ul className="overflow-hidden rounded-group bg-fill">
                {paused.map((g, i) => (
                  <li key={g.id} className="relative">
                    {i > 0 ? (
                      <span className="absolute inset-x-0 top-0 z-10 ml-4 h-[0.5px] bg-separator" />
                    ) : null}
                    <EditGoal draft={draftOf(g)} personalReady={personalReady}>
                      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
                        <span className="text-body text-label-2">{g.title}</span>
                        <span className="text-footnote text-label-2">
                          {CATEGORY_TITLE[categoryOf(g.category)]}
                        </span>
                      </div>
                    </EditGoal>
                  </li>
                ))}
              </ul>
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

function GoalRow({
  status,
  first,
  pace,
  today,
  cap,
}: {
  status: GoalStatus;
  first: boolean;
  pace: number;
  today: number;
  cap: number;
}) {
  const { goal, behind, leftMinutes } = status;
  return (
    <div className="relative px-4 pt-3 pb-3.5">
      {first ? null : <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" />}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold">{goal.title}</h3>
        <p className="shrink-0 text-subhead text-label-2 tnum">
          <b className="font-semibold text-label">{hm(goal.spentMinutes)}</b> of {hm(goal.budgetMinutes)}
        </p>
      </div>
      <div className="mt-1.5 flex items-end gap-3.5">
        <div className="min-w-0 flex-1">
          <NotchTrack
            budget={goal.budgetMinutes}
            spent={goal.spentMinutes}
            unverified={goal.unverifiedMinutes}
            pace={pace}
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
    </div>
  );
}

function SleepSection({ sleep }: { sleep: { goalMinutes: number; nightly: (number | null)[] } }) {
  const nights = sleep.nightly.filter((n): n is number => n != null);
  const avg = nights.length ? nights.reduce((a, b) => a + b, 0) / nights.length : null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-title3 font-bold">Sleep</h2>
      <div className="flex items-end justify-between gap-4 rounded-group bg-fill px-4 py-3">
        <div className="min-w-0">
          <p className="text-body font-semibold tnum">
            {avg != null ? `${hm(avg)} a night` : "No nights yet"}
          </p>
          <p className="text-footnote text-label-2 tnum">
            {avg != null
              ? `Goal ${hm(sleep.goalMinutes)}. Outside the score.`
              : `Goal ${hm(sleep.goalMinutes)}. Wear the watch tonight.`}
          </p>
        </div>
        {nights.length ? <SleepBars nightly={sleep.nightly} goal={sleep.goalMinutes} /> : null}
      </div>
    </section>
  );
}

/** The edit sheet's starting values, from the goal as the API stores it. */
function draftOf(g: Goal): GoalDraft {
  const t = (g.target ?? {}) as Record<string, unknown>;
  const kind = (
    ["time", "target", "count", "checklist"].includes(String(t.kind)) ? t.kind : "time"
  ) as GoalDraft["kind"];
  const unit = (
    ["hours_a_day", "by_time", "number_a_day"].includes(String(t.unit)) ? t.unit : "hours_a_day"
  ) as GoalDraft["unit"];
  return {
    id: g.id,
    category: categoryOf(g.category),
    title: g.title,
    kind,
    hours: g.weekly_budget_minutes ? String(Math.round((g.weekly_budget_minutes / 60) * 10) / 10) : "",
    calendarTitles: Array.isArray(t.calendar_titles) ? (t.calendar_titles as string[]).join(", ") : "",
    unit,
    value: t.value != null ? String(t.value) : "",
    perWeek: t.per_week != null ? String(t.per_week) : "",
    label: typeof t.label === "string" ? t.label : "",
    messagesCount:
      Array.isArray(t.work_categories) && (t.work_categories as string[]).includes("communication"),
    active: g.active,
  };
}
