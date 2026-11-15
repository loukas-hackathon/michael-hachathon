import { goalKind } from "@michael/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CountUp } from "@/components/count-up";
import { LiveRefresh } from "@/components/live-refresh";
import { LogTimeForm } from "@/components/log-time";
import { Tween } from "@/components/motion-ui";
import { HowICount, ScoreLearning } from "@/components/score/how-i-count";
import { ScreenHeader } from "@/components/screen";
import { MoreFromMichaelSkeleton } from "@/components/skeletons";
import { Tape, TapeKey } from "@/components/tape";
import { BriefCard } from "@/components/today/brief-card";
import { CalendarCard } from "@/components/today/calendar-card";
import { TodayChecklist } from "@/components/today/checklist";
import { DemoWeekLine } from "@/components/today/demo-week-line";
import { Fold, MoreFromMichael } from "@/components/today/fold";
import { GetStarted } from "@/components/today/get-started";
import { KeepWeekStrip, keepLine, streakLine } from "@/components/today/keep-week";
import { LastWeekLine } from "@/components/today/last-week-line";
import { MichaelCard } from "@/components/today/michael-card";
import { MomentCard } from "@/components/today/moment-card";
import { NextBlocks } from "@/components/today/next-blocks";
import { RecommendationsPanel, todaySuggestions } from "@/components/today/recommendations";
import { RitualCard } from "@/components/today/ritual-card";
import { TodayEmpty } from "@/components/today/today-empty";
import { TravelCard } from "@/components/today/travel-card";
import { WatchLine } from "@/components/today/watch-line";
import { WeekGlance } from "@/components/today/week-glance";
import {
  getChecklist,
  getGoals,
  getKeepWeek,
  getLastLostWeek,
  getLostWeek,
  getRitual,
  getToday,
  needsOnboarding,
} from "@/lib/api";
import type { ChecklistDay } from "@/lib/checklist";
import { type DayView, nowIndex, tape, totals } from "@/lib/day";
import { formatDay, formatTime, hm, spokenDuration } from "@/lib/format";
import { verdict } from "@/lib/gamification";
import type { LostWeek } from "@/lib/lost-week";
import { momentKindFor } from "@/lib/moments";
import { ritualPreview, ritualShows } from "@/lib/ritual";
import { preloadTodaySections } from "@/lib/today-preload";

/** What VoiceOver reads for the tape: "3 hours 33 minutes spent, 47 minutes lost, 50 minutes still ahead". */
function tapeLabel(t: ReturnType<typeof totals>) {
  if (t.scorePct === null) return `${spokenDuration(t.planned)} of goal time planned`;
  const parts = [`${spokenDuration(t.spent)} spent`];
  if (t.unverified > 0) parts.push(`${spokenDuration(t.unverified)} of it unconfirmed`);
  if (t.lost > 0) parts.push(`${spokenDuration(t.lost)} lost`);
  if (t.ahead > 0) parts.push(`${spokenDuration(t.ahead)} still ahead`);
  return `Today's tape: ${parts.join(", ")}`;
}

const TITLE: Record<DayView["moment"], string> = { morning: "Morning", today: "Today", evening: "Evening" };

// A column of the laptop dashboard. On a phone it is not a box at all: its sections join the one
// column and take their place from max-xl:order-*, so the phone reads exactly as before.
const COLUMN = "contents xl:block";

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
    getLastLostWeek(demo),
    demo === "sample" ? null : getRitual(ritualPreview(preview)),
  ]);
  loads.catch(() => {});
  preloadTodaySections(demo);
  if (await needsOnboarding()) redirect("/onboarding");
  const [day, checklist, goals, lostWeek, keepWeek, lastWeek, ritual] = await loads;
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
  // Too little to count yet (#206): no week figure, the day's number in grey, what Michael needs.
  const learning = day.explain?.learning ?? false;
  const { primary } = await suggestions;
  // A new user's empty day keeps the reading column on a laptop: one action, nothing to spread out.
  const empty = day.blocks.length === 0 && day.week.scorePct == null;

  return (
    <main className={empty ? "screen" : "screen m-dash"}>
      <ScreenHeader
        context={
          <>
            {formatDay(day.now)}
            {day.sample ? null : <LiveRefresh />}
          </>
        }
        title={TITLE[day.moment]}
      />
      <DemoWeekLine />
      <RecommendationsPanel slot="booked" />

      {empty ? (
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
        // On a phone one column, in the order set by max-xl:order-*. On a laptop (1280 px and up) a
        // dashboard in three columns (#285): how am I doing and the next move on the left; the tape,
        // the blocks still ahead, the outcomes and what I did in the centre; my detail and the week right.
        <div className="flex flex-col xl:grid xl:grid-cols-3 xl:items-start xl:gap-x-8">
          <div className={COLUMN}>
            <section
              aria-label="Goal time today"
              className="mt-3 max-xl:order-1"
              data-live-key="score"
              data-live-pop=""
            >
              {day.blocks.length > 0 && t.scorePct === null && firstBlock ? (
                <p className="text-title3 font-semibold">
                  Your first block starts at <span className="tnum">{formatTime(firstBlock.start)}</span>.
                  {keepWeek && keepLine(keepWeek) ? ` ${keepLine(keepWeek)}` : ""}
                </p>
              ) : day.blocks.length > 0 ? (
                <HowICount explain={day.explain}>
                  <h2 className="flex flex-col">
                    <span className="text-footnote font-semibold text-label-2">Optimisation score</span>
                    <span
                      className={`font-num text-score font-extrabold tracking-[-0.02em] tnum [font-size:min(var(--text-score),24vw)] ${learning ? "text-label-2" : ""}`}
                    >
                      <CountUp value={t.scorePct ?? 0} suffix="%" />
                    </span>
                    <span className="text-title3 font-semibold">
                      of your goal time {day.moment === "evening" ? "today" : "so far"}.
                      {keepWeek && keepLine(keepWeek) ? ` ${keepLine(keepWeek)}` : ""}
                    </span>
                  </h2>
                </HowICount>
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
              {learning && day.explain ? (
                <HowICount explain={day.explain} hint={false}>
                  <ScoreLearning explain={day.explain} className="mt-3" />
                </HowICount>
              ) : day.week.scorePct != null ? (
                <HowICount explain={day.explain} hint={!(day.blocks.length > 0 && t.scorePct !== null)}>
                  <span className="mt-1 block text-subhead text-label-2">
                    <b className="font-semibold text-label tnum">
                      <Tween value={day.week.scorePct} format="pct" />
                    </b>{" "}
                    of your goal time this week.{day.week.line ? ` ${day.week.line}` : ""}
                    {keepWeek ? ` A day is kept at ${keepWeek.line}%.` : ""}
                  </span>
                </HowICount>
              ) : null}
              {day.balance && verdict(day.balance).line ? (
                <p className="mt-1 text-subhead font-semibold">{verdict(day.balance).line}</p>
              ) : null}
            </section>

            {lostWeek && lostWeek.total > 0 ? (
              <LostWeekLine week={lostWeek} demo={demo} className="max-xl:order-3" />
            ) : null}
            {lastWeek ? (
              <div className="max-xl:order-4">
                <LastWeekLine week={lastWeek} demo={demo} />
              </div>
            ) : null}

            {day.wonBackMinutes > 0 && !learning ? (
              <p className="mt-2 text-body max-xl:order-5" data-live-key="won" data-live-pop="">
                <b className="font-num font-bold text-tint-text">
                  <Tween value={day.wonBackMinutes} format="minutes" />
                </b>{" "}
                won back today.
              </p>
            ) : null}

            <div className="max-xl:order-7">
              <RecommendationsPanel slot="primary" />
            </div>
          </div>

          <div className={COLUMN}>
            {/* Before the first block starts the tape is all outline: the sentence above already says
              when it starts, so a bar of nothing stays off the screen. */}
            {day.blocks.length > 0 && t.scorePct !== null ? (
              <div className="mt-5 max-xl:order-2 xl:mt-3" data-live-key="tape" data-live-pop="">
                {/* Says what the bar is (#330): a first time viewer reads it before the key. */}
                <p className="text-footnote text-label-2">
                  <b className="font-semibold text-label tnum">{hm(t.planned)}</b> of goal time planned today.
                </p>
                <div className="mt-3">
                  <Tape
                    ticks={ticks}
                    nowAt={day.moment === "evening" ? null : nowIndex(ticks)}
                    nowLabel={formatTime(day.now)}
                    recordAt={day.record?.tick ?? null}
                    label={tapeLabel(t)}
                    wideHeight={28}
                  />
                </div>
                <TapeKey
                  hidden
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

            {/* The rest of the day by block: a laptop only, the phone has the Timeline tab for it. */}
            <NextBlocks
              blocks={day.blocks}
              now={day.now}
              demo={demo}
              className="mt-6 hidden xl:block xl:first:mt-3"
            />

            {day.sample ? null : (
              <div className="max-xl:order-8">
                <Suspense fallback={null}>
                  <CalendarCard demo={demo} emptyDay={false} />
                </Suspense>
              </div>
            )}

            {lists.length > 0 ? (
              <div className="max-xl:order-9">
                {lists.map((l) => (
                  <TodayChecklist key={l.goalId} {...l} />
                ))}
              </div>
            ) : null}
            {day.lead || day.nudge ? (
              <section
                aria-label="What I did"
                // A flex item keeps its first child's margin inside; the card's own mt-5 would add to mt-6.
                className="mt-6 max-xl:order-10 [&>article:first-child]:mt-0"
                data-live-key="did"
                data-live-pop=""
              >
                {day.lead ? <MichaelCard lead={day.lead} primary={!primary} /> : null}
                {day.nudge ? (
                  // Polite: a new nudge arriving with a live refresh is read out once, without interrupting.
                  <div
                    aria-live="polite"
                    aria-atomic="true"
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
          </div>

          <div className={COLUMN}>
            {ritualCard ? <div className="max-xl:order-6 xl:[&>*]:mt-3">{ritualCard}</div> : null}

            <div className="max-xl:order-11 xl:[&:first-child>*]:mt-3">
              <Suspense fallback={<MoreFromMichaelSkeleton />}>
                <MoreFromMichael wideOpen>
                  {momentKind ? <MomentCard kind={momentKind} sample={day.sample} /> : null}
                  <WatchLine demo={demo} />
                  {day.sample && day.travelPlan ? <TravelCard plan={day.travelPlan} /> : null}
                  <BriefCard sample={day.sample} />
                  <RecommendationsPanel slot="rest" />
                  {loggable.length > 0 && !day.sample ? (
                    <Fold
                      title="Log time"
                      preview="Did something for a goal without a block? Tell me how long."
                    >
                      <LogTimeForm goals={loggable} />
                    </Fold>
                  ) : null}
                </MoreFromMichael>
              </Suspense>
            </div>

            <Suspense fallback={null}>
              <WeekGlance demo={demo} className="mt-8 hidden xl:block" />
            </Suspense>
          </div>
        </div>
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
function LostWeekLine({ week, demo, className = "" }: { week: LostWeek; demo?: string; className?: string }) {
  const top = week.causes[0];
  return (
    <Link
      href={`/timeline${demo === "sample" ? "?demo=sample" : ""}`}
      className={`press mt-1 flex items-start justify-between gap-3 text-subhead text-label-2 ${className}`}
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
