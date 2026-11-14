import { goalKind } from "@michael/shared";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CountUp } from "@/components/count-up";
import { LiveRefresh } from "@/components/live-refresh";
import { Tween } from "@/components/motion-ui";
import { ScreenHeader } from "@/components/screen";
import { Tape, TapeKey } from "@/components/tape";
import { BriefCard } from "@/components/today/brief-card";
import { TodayChecklist } from "@/components/today/checklist";
import { MoreFromMichael } from "@/components/today/fold";
import { GetStarted } from "@/components/today/get-started";
import { MichaelCard } from "@/components/today/michael-card";
import { MomentCard } from "@/components/today/moment-card";
import { RecommendationsPanel, todaySuggestions } from "@/components/today/recommendations";
import { TodayEmpty } from "@/components/today/today-empty";
import { TravelCard } from "@/components/today/travel-card";
import { WatchLine } from "@/components/today/watch-line";
import { getChecklist, getGoals, getToday, needsOnboarding } from "@/lib/api";
import type { ChecklistDay } from "@/lib/checklist";
import { type DayView, nowIndex, tape, totals } from "@/lib/day";
import { formatDay, formatTime, spokenDuration } from "@/lib/format";
import { verdict } from "@/lib/gamification";
import { momentKindFor } from "@/lib/moments";

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

// Today reads in three steps (#208): how am I doing (score, maths, time won back), the one thing to
// do now (one suggestion with the screen's only filled button), and what Michael just did (his lead
// and the latest nudge). Everything else folds into "More from Michael" as quiet rows. A new user
// with nothing on the tape gets the empty state (Get started, #181) as the hero instead of the score.

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  if (await needsOnboarding()) redirect("/onboarding");
  // The day and the suggestions load side by side; "More from Michael" streams in behind
  // Suspense, so the score never waits on the brief, the moment or the watch.
  const suggestions = todaySuggestions();
  const [day, checklist, goals] = await Promise.all([
    getToday(demo),
    getChecklist().catch(() => null),
    getGoals().catch(() => []),
  ]);
  const lists = checklistsFor(checklist, goals);
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
          <TodayEmpty demo={demo} />
          {lists.map((l) => (
            <TodayChecklist key={l.goalId} {...l} />
          ))}
          <RecommendationsPanel slot="primary" />
          <Suspense fallback={null}>
            <MoreFromMichael>
              {momentKind && !day.sample ? <MomentCard kind={momentKind} sample={false} /> : null}
              <WatchLine demo={demo} />
              <BriefCard sample={day.sample} />
              <RecommendationsPanel slot="rest" />
            </MoreFromMichael>
          </Suspense>
        </>
      ) : (
        <>
          {day.week.scorePct != null ? (
            <p className="mt-1.5 text-subhead text-label-2">
              We're at{" "}
              <b className="font-semibold text-label tnum">
                <Tween value={day.week.scorePct} format="pct" />
              </b>{" "}
              of goal time this week.{day.week.line ? ` ${day.week.line}` : ""}
            </p>
          ) : null}
          {day.balance && verdict(day.balance).line ? (
            <p className="mt-1 text-subhead font-semibold">{verdict(day.balance).line}</p>
          ) : null}

          {day.blocks.length > 0 ? (
            <section aria-label="Goal time today" className="mt-5" data-live-key="score" data-live-pop="">
              {t.scorePct === null && firstBlock ? (
                <p className="text-title3 font-semibold">
                  Your first block starts at <span className="tnum">{formatTime(firstBlock.start)}</span>.
                </p>
              ) : (
                <h2 className="flex flex-col">
                  <span className="font-num text-score font-extrabold tracking-[-0.02em] tnum [font-size:min(var(--text-score),24vw)]">
                    <CountUp value={t.scorePct ?? 0} suffix="%" />
                  </span>
                  <span className="text-title3 font-semibold">
                    of your goal time {day.moment === "evening" ? "today" : "so far"}.
                  </span>
                </h2>
              )}
              <div className="mt-3">
                <Tape
                  ticks={ticks}
                  nowAt={day.moment === "evening" || t.scorePct === null ? null : nowIndex(ticks)}
                  nowLabel={formatTime(day.now)}
                  recordAt={day.record?.tick ?? null}
                  label={tapeLabel(t)}
                />
              </div>
              <TapeKey
                hidden
                items={
                  t.scorePct === null
                    ? [{ kind: "ahead" as const, minutes: t.planned, text: "planned" }]
                    : [
                        ...(t.spent - t.unverified > 0 || t.unverified === 0
                          ? [{ kind: "spent" as const, minutes: t.spent - t.unverified, text: "spent" }]
                          : []),
                        ...(t.unverified > 0
                          ? [{ kind: "unverified" as const, minutes: t.unverified, text: "unconfirmed" }]
                          : []),
                        ...(t.lost > 0 ? [{ kind: "lost" as const, minutes: t.lost, text: "lost" }] : []),
                        ...(t.ahead > 0 ? [{ kind: "ahead" as const, minutes: t.ahead, text: "ahead" }] : []),
                      ]
                }
              />
              {day.record ? (
                <p className="mt-2 flex items-center gap-2 text-subhead">
                  <span aria-hidden="true" className="size-[7px] shrink-0 rotate-45 rounded-[1px] bg-label" />
                  {day.record.line}
                </p>
              ) : null}
            </section>
          ) : null}

          {day.wonBackMinutes > 0 ? (
            <p className="mt-4 text-body" data-live-key="won" data-live-pop="">
              <b className="font-num font-bold text-tint-text">
                <Tween value={day.wonBackMinutes} format="minutes" />
              </b>{" "}
              won back today.
            </p>
          ) : null}

          {lists.map((l) => (
            <TodayChecklist key={l.goalId} {...l} />
          ))}

          <RecommendationsPanel slot="primary" />

          {day.lead || day.nudge ? (
            <section aria-label="What I did" className="mt-6" data-live-key="did" data-live-pop="">
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

          <Suspense fallback={null}>
            <MoreFromMichael>
              {momentKind ? <MomentCard kind={momentKind} sample={day.sample} /> : null}
              <WatchLine demo={demo} />
              {day.sample && day.travelPlan ? <TravelCard plan={day.travelPlan} /> : null}
              <BriefCard sample={day.sample} />
              <RecommendationsPanel slot="rest" />
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
