import { goalKind } from "@michael/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CountUp } from "@/components/count-up";
import { LiveRefresh } from "@/components/live-refresh";
import { LogTimeForm } from "@/components/log-time";
import { Tween } from "@/components/motion-ui";
import { ScreenHeader } from "@/components/screen";
import { MoreFromMichaelSkeleton } from "@/components/skeletons";
import { Tape, TapeKey } from "@/components/tape";
import { BriefCard } from "@/components/today/brief-card";
import { CalendarCard } from "@/components/today/calendar-card";
import { TodayChecklist } from "@/components/today/checklist";
import { Fold, MoreFromMichael } from "@/components/today/fold";
import { GetStarted } from "@/components/today/get-started";
import { KeepWeekStrip, keepLine, streakLine } from "@/components/today/keep-week";
import { MichaelCard } from "@/components/today/michael-card";
import { MomentCard } from "@/components/today/moment-card";
import { RecommendationsPanel, todaySuggestions } from "@/components/today/recommendations";
import { RitualCard } from "@/components/today/ritual-card";
import { TodayEmpty } from "@/components/today/today-empty";
import { TravelCard } from "@/components/today/travel-card";
import { WatchLine } from "@/components/today/watch-line";
import {
  getChecklist,
  getGoals,
  getKeepWeek,
  getLostWeek,
  getRitual,
  getToday,
  needsOnboarding,
} from "@/lib/api";
import type { ChecklistDay } from "@/lib/checklist";
import { type DayView, nowIndex, tape, totals } from "@/lib/day";
import { formatDay, formatTime, hm } from "@/lib/format";
import { verdict } from "@/lib/gamification";
import type { LostWeek } from "@/lib/lost-week";
import { momentKindFor } from "@/lib/moments";
import { ritualPreview, ritualShows } from "@/lib/ritual";
import { preloadTodaySections } from "@/lib/today-preload";

const TITLE: Record<DayView["moment"], string> = { morning: "Morning", today: "Today", evening: "Evening" };

// Today reads in three steps (#208): how am I doing (score, maths, time won back), the one thing to
// do now (one suggestion with the screen's only filled button), and what Michael just did (his lead
// and the latest nudge). Everything else folds into "More from Michael" as quiet rows. A new user
// with nothing on the tape gets the empty state (Get started, #181) as the hero instead of the score.

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; ritual?: string }>;
}) {
  const { demo, ritual: preview } = await searchParams;
  // Today loads in one wave (#221): the day, the suggestions and the rows under "More from Michael"
  // all start while the onboarding check runs (a redirect simply drops them). Identical reads are
  // deduped per render, so the sections pick up these answers instead of asking again. "More from
  // Michael" streams in behind Suspense, so the score never waits on the brief, moment or watch.
  const suggestions = todaySuggestions();
  const loads = Promise.all([
    getToday(demo),
    getChecklist().catch(() => null),
    getGoals().catch(() => []),
    getLostWeek(undefined, demo),
    getKeepWeek(demo),
    demo === "sample" ? null : getRitual(ritualPreview(preview)),
  ]);
  loads.catch(() => {});
  preloadTodaySections(demo);
  if (await needsOnboarding()) redirect("/onboarding");
  const [day, checklist, goals, lostWeek, keepWeek, ritual] = await loads;
  // The daily ritual (#318): while its card shows, the outcomes live in it, not in the list.
  const ritualCard = ritualShows(ritual) ? <RitualCard ritual={ritual} /> : null;
  const lists = checklistsFor(checklist, goals).filter((l) => !ritualCard || l.goalId !== ritual?.goal_id);
  // Goals done time can be logged against (#317): active time and count goals.
  const loggable = goals
    .filter((g) => g.active && (goalKind(g) === "time" || goalKind(g) === "count"))
    .map((g) => ({ id: g.id, title: g.title }));
  const ticks = tape(day);
  const t = totals(day);
  const firstBlock = day.blocks[0];
  const momentKind = momentKindFor(day);
  const { primary } = await suggestions;

  return (
    <main className="screen">
      <ScreenHeader
        context={
          <>
            {formatDay(day.now)}
            {day.sample ? null : <LiveRefresh />}
          </>
        }
        title={TITLE[day.moment]}
      />

      {day.blocks.length === 0 && day.week.scorePct == null ? (
        <>
          <GetStarted demo={demo} />
          <Suspense fallback={null}>
            <CalendarCard demo={demo} emptyDay />
          </Suspense>
          <TodayEmpty demo={demo} />
          {ritualCard}
          {lists.map((l) => (
            <TodayChecklist key={l.goalId} {...l} />
          ))}
          <RecommendationsPanel slot="primary" />
          {/* No moment card or brief on an empty day: both would only say there is nothing yet, which
              Get started already says with one action. */}
          <Suspense fallback={null}>
            <MoreFromMichael>
              <WatchLine demo={demo} />
              <RecommendationsPanel slot="rest" />
              {loggable.length > 0 && !day.sample ? (
                <Fold title="Log time" preview="Did something for a goal without a block? Tell me how long.">
                  <LogTimeForm goals={loggable} />
                </Fold>
              ) : null}
            </MoreFromMichael>
          </Suspense>
        </>
      ) : (
        <>
          <section aria-label="Goal time today" className="mt-3" data-live-key="score" data-live-pop="">
            {day.blocks.length > 0 && t.scorePct === null && firstBlock ? (
              <p className="text-title3 font-semibold">
                Your first block starts at <span className="tnum">{formatTime(firstBlock.start)}</span>.
                {keepWeek && keepLine(keepWeek) ? ` ${keepLine(keepWeek)}` : ""}
              </p>
            ) : day.blocks.length > 0 ? (
              <h2 className="flex flex-col">
                <span className="text-footnote font-semibold text-label-2">Optimisation score</span>
                <span className="font-num text-score font-extrabold tracking-[-0.02em] tnum">
                  <CountUp value={t.scorePct ?? 0} suffix="%" />
                </span>
                <span className="text-title3 font-semibold">
                  of your goal time {day.moment === "evening" ? "today" : "so far"}.
                  {keepWeek && keepLine(keepWeek) ? ` ${keepLine(keepWeek)}` : ""}
                </span>
              </h2>
            ) : (
              <p className="text-title3 font-semibold">
                No goal blocks today. It neither keeps nor breaks the run.
              </p>
            )}

            {keepWeek ? (
              <>
                <KeepWeekStrip week={keepWeek} />
                <p className="mt-3 text-subhead font-semibold tnum">{streakLine(keepWeek)}</p>
              </>
            ) : null}
            {day.week.scorePct != null ? (
              <p className="mt-1 text-subhead text-label-2">
                <b className="font-semibold text-label tnum">
                  <Tween value={day.week.scorePct} format="pct" />
                </b>{" "}
                optimisation score this week.{day.week.line ? ` ${day.week.line}` : ""}
                {keepWeek ? ` A day is kept at ${keepWeek.line}%.` : ""}
              </p>
            ) : null}
            {day.balance && verdict(day.balance).line ? (
              <p className="mt-1 text-subhead font-semibold">{verdict(day.balance).line}</p>
            ) : null}

            {/* Before the first block starts the tape is all outline: the sentence above already says
                when it starts, so a bar of nothing stays off the screen. */}
            {day.blocks.length > 0 && t.scorePct !== null ? (
              <div className="mt-5">
                <div className="mt-3">
                  <Tape
                    ticks={ticks}
                    nowAt={day.moment === "evening" ? null : nowIndex(ticks)}
                    nowLabel={formatTime(day.now)}
                    recordAt={day.record?.tick ?? null}
                    label={`${hm(t.spent)} spent (${hm(t.unverified)} unconfirmed), ${hm(t.lost)} lost, ${hm(t.ahead)} still ahead`}
                  />
                </div>
                <TapeKey
                  items={[
                    ...(t.spent - t.unverified > 0 || t.unverified === 0
                      ? [{ kind: "spent" as const, minutes: t.spent - t.unverified, text: "spent" }]
                      : []),
                    ...(t.unverified > 0
                      ? [{ kind: "unverified" as const, minutes: t.unverified, text: "unconfirmed" }]
                      : []),
                    ...(t.lost > 0 ? [{ kind: "lost" as const, minutes: t.lost, text: "lost" }] : []),
                    ...(t.ahead > 0 ? [{ kind: "ahead" as const, minutes: t.ahead, text: "ahead" }] : []),
                  ]}
                />
                {day.record ? (
                  <p className="mt-2 flex items-center gap-2 text-subhead">
                    <span
                      aria-hidden="true"
                      className="size-[7px] shrink-0 rotate-45 rounded-[1px] bg-label"
                    />
                    {day.record.line}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          {lostWeek && lostWeek.total > 0 ? <LostWeekLine week={lostWeek} demo={demo} /> : null}

          {day.wonBackMinutes > 0 ? (
            <p className="mt-2 text-body" data-live-key="won" data-live-pop="">
              <b className="font-num font-bold text-tint-text">
                <Tween value={day.wonBackMinutes} format="minutes" />
              </b>{" "}
              won back today.
            </p>
          ) : null}

          {ritualCard}

          <RecommendationsPanel slot="primary" />

          {day.sample ? null : (
            <Suspense fallback={null}>
              <CalendarCard demo={demo} emptyDay={false} />
            </Suspense>
          )}

          {lists.map((l) => (
            <TodayChecklist key={l.goalId} {...l} />
          ))}

          {day.lead || day.nudge ? (
            <section aria-label="What I did" className="mt-6" data-live-key="did" data-live-pop="">
              {day.lead ? <MichaelCard lead={day.lead} primary={!primary} /> : null}
              {day.nudge ? (
                <div
                  className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 rounded-group bg-fill px-4 py-3"
                  data-live-key={`nudge${day.nudge.at}`}
                >
                  <p className="col-span-2 mb-0.5 text-footnote font-semibold">Latest nudge</p>
                  <time
                    className="text-footnote leading-5 font-semibold text-label-2 tnum"
                    dateTime={day.nudge.at}
                  >
                    {formatTime(day.nudge.at)}
                  </time>
                  <p className="text-subhead">{day.nudge.text}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          <Suspense fallback={<MoreFromMichaelSkeleton />}>
            <MoreFromMichael>
              {momentKind ? <MomentCard kind={momentKind} sample={day.sample} /> : null}
              <WatchLine demo={demo} />
              {day.sample && day.travelPlan ? <TravelCard plan={day.travelPlan} /> : null}
              <BriefCard sample={day.sample} />
              <RecommendationsPanel slot="rest" />
              {loggable.length > 0 && !day.sample ? (
                <Fold title="Log time" preview="Did something for a goal without a block? Tell me how long.">
                  <LogTimeForm goals={loggable} />
                </Fold>
              ) : null}
            </MoreFromMichael>
          </Suspense>
        </>
      )}

      {day.sample ? (
        <p className="mt-8 text-footnote text-label-2">
          Sample day. Your own day appears here once your sources are connected.
        </p>
      ) : null}
    </main>
  );
}

/** One list per active checklist goal, plus any goal the day's items name (#238). */
function checklistsFor(day: ChecklistDay | null, goals: Awaited<ReturnType<typeof getGoals>>) {
  if (!day) return [];
  const titles = new Map(
    goals.filter((g) => g.active && goalKind(g) === "checklist").map((g) => [g.id, g.title] as const),
  );
  for (const i of [...day.items, ...day.suggestions]) {
    if (!titles.has(i.goal_id)) titles.set(i.goal_id, "Today's list");
  }
  return [...titles].map(([goalId, title]) => ({
    goalId,
    title,
    items: day.items.filter((i) => i.goal_id === goalId),
    suggestions: day.suggestions.filter((i) => i.goal_id === goalId),
  }));
}

/** "3h 54 lost from your goal blocks this week. Instagram took 1h 05 of it." Opens the chart. */
function LostWeekLine({ week, demo }: { week: LostWeek; demo?: string }) {
  const top = week.causes[0];
  return (
    <Link
      href={`/timeline${demo === "sample" ? "?demo=sample" : ""}`}
      className="press mt-1 flex items-start justify-between gap-3 text-subhead text-label-2"
    >
      <span>
        <b className="font-semibold text-label tnum">{hm(week.total)}</b> lost from your goal blocks this
        week.
        {top ? (
          <>
            {" "}
            {top.what} took <span className="tnum">{hm(top.minutes)}</span> of it.
          </>
        ) : null}
      </span>
      <span aria-hidden="true" className="shrink-0">
        ›
      </span>
    </Link>
  );
}
