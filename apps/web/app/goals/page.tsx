import { type Goal, GoalCategory, type GoalSuggestion, type Recommendation } from "@michael/shared";
import { BalanceBars } from "@/components/gamification/balance";
import { TargetCard } from "@/components/gamification/target-card";
import { BookTime } from "@/components/goals/book-time";
import { ExpandRow } from "@/components/goals/expand-row";
import { GoalBar, SleepBars, SplitBar, WeekBars } from "@/components/goals/goal-charts";
import { AddGoal, EditGoal, type GoalDraft, NewGoalButton } from "@/components/goals/goal-sheets";
import { Tween } from "@/components/motion-ui";
import { ProgressBar } from "@/components/progress-bar";
import { ScreenHeader } from "@/components/screen";
import { RecommendationList } from "@/components/today/recommendation-list";
import { getGoalSuggestions, getGoals, getGoalsWeek, getRecommendations } from "@/lib/api";
import { CATEGORIES, CATEGORY_TITLE, categoryOf } from "@/lib/categories";
import { countLine } from "@/lib/checklist";
import { formatWeekday, hm } from "@/lib/format";
import {
  bookMinutes,
  closeState,
  type GoalStatus,
  type GoalWeek,
  needsMost,
  pace,
  paceMinutes,
  rank,
  todayIndex,
} from "@/lib/goals-view";
import { openRecommendations, type RecCard, toCard } from "@/lib/recommendations";

// Goals answers one question at a glance (#309): which goal needs me most this week, and by how
// much. The hero names it with the maths and one continuous bar with the pace tick, then the one
// thing to do for it: Michael's open suggestion for that goal (Do it, Undo), else Book time. That
// is the screen's only filled pink button. Everything else is calm: every goal as a row that opens
// in place, the week's target, balance and records, the maths when goals compete, sleep, paused.
// Goals found in the calendar live in the New goal sheet, with a quiet hint row here.

const btnFilled =
  "press inline-flex min-h-9 items-center rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint";
const btnPlain =
  "press inline-flex min-h-9 items-center rounded-full px-1 text-subhead font-semibold text-tint-text";

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const [week, all, suggestions, recs] = await Promise.all([
    getGoalsWeek(demo),
    getGoals().catch(() => [] as Goal[]),
    demo ? Promise.resolve([] as GoalSuggestion[]) : getGoalSuggestions(),
    demo ? Promise.resolve([] as Recommendation[]) : getRecommendations().catch(() => [] as Recommendation[]),
  ]);
  const personalReady = (GoalCategory.options as readonly string[]).includes("personal");
  const drafts = new Map(all.map((g) => [g.id, draftOf(g)]));
  const paused = all.filter((g) => !g.active);
  const p = pace(week);
  const today = todayIndex(week);
  const daysLeft = 7 - today - 1;
  const ranked = rank(week);
  const top = needsMost(ranked);
  const need = ranked.reduce((n, r) => n + r.leftMinutes, 0);
  const cap = Math.max(60, ...week.goals.flatMap((g) => g.daily.map((m) => m ?? 0)));
  const context = `${formatWeekday(week.now)}. ${daysLeft === 0 ? "Last day" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go`}.`;
  const extras = week.extras ?? [];
  const groups = CATEGORIES.map((c) => ({
    c,
    items: ranked.filter((r) => r.goal.category === c),
    more: extras.filter((x) => x.category === c),
  })).filter((g) => g.items.length > 0 || g.more.length > 0);
  const empty = week.goals.length === 0 && extras.length === 0;
  const now = new Date();
  // Michael's own suggestion for the top goal, if he has one he can carry out (or one done that can
  // still be undone): that is the one thing to do. Otherwise Book time.
  const topCard: RecCard | null = top
    ? (openRecommendations(recs, now, 20)
        .filter((r) => r.goal_id === top.goal.id)
        .map((r) => toCard(r, all, now))
        .find((c) => c.executable) ?? null)
    : null;
  const toGo = daysLeft + 1;

  return (
    <main className="screen m-wide">
      <ScreenHeader
        context={context}
        title="Goals"
        actions={<AddGoal personalReady={personalReady} suggestions={suggestions} />}
      />

      {empty ? (
        <section className="mt-6 flex flex-col gap-2 rounded-card bg-fill px-4 pt-4 pb-5">
          <h2 className="text-title3 font-bold">No goals yet.</h2>
          <p className="max-w-[46ch] text-subhead text-label-2">
            {suggestions.length > 0
              ? `Your calendar already shows ${countWord(suggestions.length)}. Keep ${suggestions.length === 1 ? "it" : "them"} in one tap and I start counting today.`
              : "Tell me what you're working towards and how many hours a week it needs. I count it from today."}
          </p>
          <div className="mt-2">
            <NewGoalButton className={btnFilled}>
              {suggestions.length > 0 ? "See what I found" : "Set your first goal"}
            </NewGoalButton>
          </div>
        </section>
      ) : (
        <div className="xl:grid xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:items-start xl:gap-x-10">
          <div>
            {top ? (
              <Hero
                status={top}
                pace={p}
                card={topCard}
                toGo={toGo}
                drafts={drafts}
                personalReady={personalReady}
              />
            ) : ranked.length > 0 ? (
              <section aria-label="This week" className="mt-3">
                <p className="text-insight text-label-2">
                  <b className="font-semibold text-label">Every goal is closed</b> for the week. That is the
                  week done.
                </p>
              </section>
            ) : null}

            {suggestions.length > 0 ? (
              <NewGoalButton className="press mt-6 flex min-h-11 w-full items-center justify-between gap-3 rounded-group bg-fill px-4 py-2.5 text-left">
                <span className="text-subhead">
                  Your calendar shows {countWord(suggestions.length)} more.{" "}
                  <span className="text-label-2">Keep {suggestions.length === 1 ? "it" : "them"}?</span>
                </span>
                <Chevron />
              </NewGoalButton>
            ) : null}

            <TheWeek week={week} />

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
          </div>

          <div className="xl:mt-3">
            {groups.map(({ c, items, more }) => {
              const spent = items.reduce((n, r) => n + r.goal.spentMinutes, 0);
              const budget = items.reduce((n, r) => n + r.goal.budgetMinutes, 0);
              // The lead goal is already answered above: no second row for it. Only when it is the
              // area's one goal does a quiet line keep the area from looking empty.
              const rows = items.filter((r) => r.goal.id !== top?.goal.id);
              const leadOnly = rows.length === 0 && more.length === 0 && top != null;
              return (
                <section key={c} className="mt-6 xl:mt-0 xl:mb-6">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h2 className="text-title3 font-bold">{CATEGORY_TITLE[c]}</h2>
                    {budget > 0 ? (
                      <p className="text-footnote text-label-2 tnum">
                        <Tween value={spent} format="hm" /> of <Tween value={budget} format="hm" />
                      </p>
                    ) : null}
                  </div>
                  <ul className="overflow-hidden rounded-group bg-fill">
                    {leadOnly && top ? (
                      <li className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
                        <span className="text-body text-label-2">{top.goal.title}</span>
                        <span className="text-footnote text-label-2">Above</span>
                      </li>
                    ) : null}
                    {rows.map((r, i) => (
                      <li key={r.goal.id}>
                        <GoalRow
                          status={r}
                          first={i === 0}
                          pace={p}
                          today={today}
                          cap={cap}
                          toGo={toGo}
                          draft={drafts.get(r.goal.id)}
                          personalReady={personalReady}
                        />
                      </li>
                    ))}
                    {more.map((x, i) => (
                      <li key={x.id}>
                        <ExtraRow
                          goal={x}
                          first={rows.length === 0 && !leadOnly && i === 0}
                          draft={drafts.get(x.id)}
                          personalReady={personalReady}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            {week.sleep ? <SleepSection sleep={week.sleep} /> : null}

            {paused.length ? (
              <section className="mt-6 xl:mt-0 xl:mb-6">
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
          </div>
        </div>
      )}

      {week.sample ? (
        <p className="mt-8 text-footnote text-label-2">
          Sample week. Your goals appear here once you set them with Michael.
        </p>
      ) : null}
    </main>
  );
}

/**
 * The answer: the goal that needs you most, by how much, the bar that proves it, and the one thing
 * to do for it.
 */
function Hero({
  status,
  pace: p,
  card,
  toGo,
  drafts,
  personalReady,
}: {
  status: GoalStatus;
  pace: number;
  card: RecCard | null;
  toGo: number;
  drafts: Map<string, GoalDraft>;
  personalReady: boolean;
}) {
  const { goal, behind, leftMinutes } = status;
  const due = paceMinutes(goal.budgetMinutes, p);
  const gap = Math.max(0, due - goal.spentMinutes);
  const draft = drafts.get(goal.id);
  const minutes = bookMinutes(leftMinutes, toGo);
  return (
    <section aria-label="Needs you most" className="mt-3">
      <h2 className="text-insight text-label-2">
        <b className="font-semibold text-label">{goal.title}</b>{" "}
        {behind ? (
          <>
            needs you most: <b className="font-semibold text-label tnum">{hm(gap)}</b> behind pace.
          </>
        ) : (
          <>
            has the most left: <b className="font-semibold text-label tnum">{hm(leftMinutes)}</b>. Every goal
            is on pace.
          </>
        )}
      </h2>

      <div className="mt-5">
        <GoalBar
          size="lg"
          budget={goal.budgetMinutes}
          spent={goal.spentMinutes}
          unverified={goal.unverifiedMinutes}
          planned={goal.plannedMinutes}
          pace={p}
          label={`${hm(goal.spentMinutes)} of ${hm(goal.budgetMinutes)}. On pace would be ${hm(due)} by now.`}
        />
        <div className="mt-2.5 flex items-baseline justify-between gap-3 text-footnote text-label-2 tnum">
          <p>
            <b className="font-semibold text-label">{hm(goal.spentMinutes)}</b> of {hm(goal.budgetMinutes)}.
            On pace: {hm(due)} by now.
          </p>
          {draft ? (
            <EditGoal draft={draft} personalReady={personalReady} className={`${btnPlain} -my-2 shrink-0`}>
              Edit
            </EditGoal>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        {card ? (
          <RecommendationList cards={[card]} variant="primary" />
        ) : (
          <div className="flex flex-col gap-1.5 rounded-card bg-fill px-4 pt-3.5 pb-4">
            <p className="text-body font-semibold">
              Book {hm(minutes)} for {goal.title}.
            </p>
            <p className="text-subhead text-label-2">
              I take the first free {hm(minutes)} from now and put it in your calendar. Undo until it starts.
            </p>
            <p className="text-subhead font-semibold tnum">
              {hm(leftMinutes)} left, {toGo === 1 ? "today is the last day" : `${toGo} days to go`}.
            </p>
            <div className="mt-1.5">
              <BookTime goalId={goal.id} minutes={minutes} primary />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The week's target, balance and records (#165, #166), quietly under the answer. */
function TheWeek({ week }: { week: Awaited<ReturnType<typeof getGoalsWeek>> }) {
  if (!week.target && !week.balance && !week.recordLine) return null;
  return (
    <section className="mt-6 flex flex-col gap-4">
      <h2 className="-mb-2 text-title3 font-bold">This week</h2>
      {/* No target yet means nothing to say: the learning line is noise on a new account. */}
      {week.target ? <TargetCard target={week.target} baseline={week.baseline ?? null} /> : null}
      {week.recordLine ? (
        <p className="flex items-center gap-2 text-subhead">
          <span aria-hidden="true" className="size-[7px] shrink-0 rotate-45 rounded-[1px] bg-label" />
          {week.recordLine}
        </p>
      ) : null}
      {week.balance ? (
        <div className="rounded-group bg-fill px-4 pt-3 pb-3.5">
          <BalanceBars balance={week.balance} />
        </div>
      ) : null}
    </section>
  );
}

function GoalRow({
  status,
  first,
  pace: p,
  today,
  cap,
  toGo,
  draft,
  personalReady,
}: {
  status: GoalStatus;
  first: boolean;
  pace: number;
  today: number;
  cap: number;
  toGo: number;
  draft: GoalDraft | undefined;
  personalReady: boolean;
}) {
  const { goal, behind, leftMinutes } = status;
  const close = closeState(goal.budgetMinutes, goal.spentMinutes, leftMinutes);
  const due = paceMinutes(goal.budgetMinutes, p);
  const summary = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold">{goal.title}</h3>
        <p className="shrink-0 text-subhead text-label-2 tnum">
          {close === "closed" ? (
            <b className="font-semibold text-tint-text">Closed</b>
          ) : (
            <>
              <b className="font-semibold text-label">
                <Tween value={leftMinutes} format="hm" />
              </b>{" "}
              left
            </>
          )}
        </p>
      </div>
      <div className="mt-2.5">
        <GoalBar
          budget={goal.budgetMinutes}
          spent={goal.spentMinutes}
          unverified={goal.unverifiedMinutes}
          planned={goal.plannedMinutes}
          pace={p}
          close={close}
          label={`${hm(goal.spentMinutes)} of ${hm(goal.budgetMinutes)}, ${behind ? "behind" : "ahead of"} pace`}
        />
      </div>
      <p className="mt-2 text-footnote text-label-2 tnum">
        {close === "closed" ? (
          <>
            <b className="font-semibold text-label">Closed for the week.</b> {hm(goal.spentMinutes)} of{" "}
            {hm(goal.budgetMinutes)}.
          </>
        ) : close === "last" ? (
          <b className="font-semibold text-tint-text">One more block closes it.</b>
        ) : close === "near" ? (
          <>
            <b className="font-semibold text-tint-text">{hm(leftMinutes)} to close it.</b>
            {goal.openBlocks ? ` ${blocksOpen(goal.openBlocks)}` : ""}
          </>
        ) : (
          <>
            {behind ? (
              <b className="font-semibold text-label">{hm(goal.spentMinutes)}</b>
            ) : (
              hm(goal.spentMinutes)
            )}{" "}
            of {hm(goal.budgetMinutes)}. {behind ? "Behind pace." : "On pace."}
          </>
        )}
      </p>
    </>
  );
  return (
    <ExpandRow first={first} summary={summary}>
      <WeekBars daily={goal.daily} today={today} cap={cap} />
      <p className="mt-3 text-footnote text-label-2 tnum">
        On pace: <b className="font-semibold text-label">{hm(due)}</b> by now.{" "}
        {goal.openBlocks ? blocksOpen(goal.openBlocks) : "No blocks planned for the rest of the week."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {close === "closed" ? null : <BookTime goalId={goal.id} minutes={bookMinutes(leftMinutes, toGo)} />}
        {draft ? (
          <EditGoal draft={draft} personalReady={personalReady} className={btnPlain}>
            Edit goal
          </EditGoal>
        ) : null}
      </div>
    </ExpandRow>
  );
}

/** A count or checklist goal (#238): no bar, it is outside the time score. */
function ExtraRow({
  goal,
  first,
  draft,
  personalReady,
}: {
  goal: GoalWeek;
  first: boolean;
  draft: GoalDraft | undefined;
  personalReady: boolean;
}) {
  const c = goal.count;
  const l = goal.checklist;
  const summary = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold">{goal.title}</h3>
        {c ? (
          <p className="shrink-0 text-subhead text-label-2 tnum">
            <b className="font-semibold text-label">{c.left}</b> to go
          </p>
        ) : l ? (
          <p className="shrink-0 text-subhead text-label-2 tnum">
            <b className="font-semibold text-label">
              {l.today.done} of {l.today.set}
            </b>{" "}
            today
          </p>
        ) : null}
      </div>
      {c ? (
        <>
          <ProgressBar
            value={c.target > 0 ? c.done / c.target : 0}
            size="sm"
            label={countLine(c)}
            valueText={`${c.done} of ${c.target}`}
            className="mt-2.5"
          />
          <p className="mt-1.5 text-footnote text-label-2 tnum">
            {c.left === 0 ? (
              <b className="font-semibold text-label">Done for the week.</b>
            ) : (
              `${countLine(c)}.`
            )}
          </p>
        </>
      ) : l ? (
        <p className="mt-1.5 text-footnote text-label-2 tnum">
          {l.week.set === 0
            ? "Nothing set this week yet."
            : `${l.week.done} of ${l.week.set} done this week.`}
        </p>
      ) : null}
    </>
  );
  return (
    <ExpandRow first={first} summary={summary}>
      <p className="text-footnote text-label-2">
        {c
          ? "Counted sessions, outside the time score."
          : "The day's outcomes, set on Today. Outside the time score."}
      </p>
      {draft ? (
        <div className="mt-2">
          <EditGoal draft={draft} personalReady={personalReady} className={btnPlain}>
            Edit goal
          </EditGoal>
        </div>
      ) : null}
    </ExpandRow>
  );
}

function SleepSection({ sleep }: { sleep: { goalMinutes: number; nightly: (number | null)[] } }) {
  const nights = sleep.nightly.filter((n): n is number => n != null);
  const avg = nights.length ? nights.reduce((a, b) => a + b, 0) / nights.length : null;
  return (
    <section className="mt-6 xl:mt-0 xl:mb-6">
      <h2 className="mb-2 text-title3 font-bold">Sleep</h2>
      <div className="flex items-end justify-between gap-4 rounded-group bg-fill px-4 py-3">
        <div className="min-w-0">
          <p className="text-body font-semibold tnum">
            {avg != null ? `${hm(avg)} a night` : "No nights yet"}
          </p>
          <p className="text-footnote text-label-2 tnum">
            {avg != null
              ? `Goal ${hm(sleep.goalMinutes)}.`
              : `Goal ${hm(sleep.goalMinutes)}. Wear the watch tonight.`}
          </p>
        </div>
        {nights.length ? <SleepBars nightly={sleep.nightly} goal={sleep.goalMinutes} /> : null}
      </div>
    </section>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0 text-label-2">
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const WORDS = ["no goals", "one goal", "two goals", "three goals", "four goals", "five goals", "six goals"];
const countWord = (n: number) => WORDS[n] ?? `${n} goals`;

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

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** "Two blocks still open." (copy: Brand, #168) */
function blocksOpen(n: number) {
  return `${COUNT[n] ?? n} ${n === 1 ? "block" : "blocks"} still open.`;
}
