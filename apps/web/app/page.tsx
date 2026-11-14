import { redirect } from "next/navigation";
import { CountUp } from "@/components/count-up";
import { EmptyState } from "@/components/empty-state";
import { LiveRefresh } from "@/components/live-refresh";
import { HowICount, ScoreLearning } from "@/components/score/how-i-count";
import { ScreenHeader } from "@/components/screen";
import { Tape, TapeKey } from "@/components/tape";
import { BriefCard } from "@/components/today/brief-card";
import { MichaelCard } from "@/components/today/michael-card";
import { MomentCard } from "@/components/today/moment-card";
import { RecommendationsPanel } from "@/components/today/recommendations";
import { TravelCard } from "@/components/today/travel-card";
import { WatchLine } from "@/components/today/watch-line";
import { getToday, needsOnboarding } from "@/lib/api";
import { type DayView, nowIndex, tape, totals } from "@/lib/day";
import { formatDay, formatTime, hm, minutesPhrase } from "@/lib/format";
import { verdict } from "@/lib/gamification";
import { momentKindFor } from "@/lib/moments";

const TITLE: Record<DayView["moment"], string> = { morning: "Morning", today: "Today", evening: "Evening" };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  if (await needsOnboarding()) redirect("/onboarding");
  const day = await getToday(demo);
  const ticks = tape(day);
  const t = totals(day);
  const firstBlock = day.blocks[0];
  const momentKind = momentKindFor(day);
  // Too little to count yet (#206): no week figure, the day's number in grey, what Michael needs.
  const learning = day.explain?.learning ?? false;
  const weekLine =
    learning && day.explain ? (
      <HowICount explain={day.explain} hint={false}>
        <ScoreLearning explain={day.explain} className="mt-3" />
      </HowICount>
    ) : day.week.scorePct != null ? (
      <div className="mt-1.5">
        <HowICount explain={day.explain} hint={day.blocks.length === 0}>
          <p className="text-subhead text-label-2">
            We're at <b className="font-semibold text-label tnum">{day.week.scorePct}%</b> of goal time this
            week.{day.week.line ? ` ${day.week.line}` : ""}
          </p>
        </HowICount>
      </div>
    ) : null;

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
      <WatchLine demo={demo} />

      {day.blocks.length === 0 ? (
        <>
          {weekLine}
          <EmptyState title="Nothing yet.">
            Wear the watch tonight and your first brief arrives in the morning.
          </EmptyState>
          {momentKind && !day.sample ? <MomentCard kind={momentKind} sample={false} /> : null}
          <RecommendationsPanel />
        </>
      ) : (
        <>
          {weekLine}
          {day.balance && verdict(day.balance).line ? (
            <p className="mt-1 text-subhead font-semibold">{verdict(day.balance).line}</p>
          ) : null}

          <section aria-label="Goal time today" className="mt-5">
            {t.scorePct === null && firstBlock ? (
              <p className="text-title3 font-semibold">
                Your first block starts at <span className="tnum">{formatTime(firstBlock.start)}</span>.
              </p>
            ) : (
              <HowICount explain={day.explain}>
                <h2 className="flex flex-col">
                  <span
                    className={`font-num text-score font-extrabold tracking-[-0.02em] tnum ${learning ? "text-label-2" : ""}`}
                  >
                    <CountUp value={t.scorePct ?? 0} suffix="%" />
                  </span>
                  <span className="text-title3 font-semibold">
                    of your goal time {day.moment === "evening" ? "today" : "so far"}.
                  </span>
                </h2>
              </HowICount>
            )}
            <div className="mt-3">
              <Tape
                ticks={ticks}
                nowAt={day.moment === "evening" || t.scorePct === null ? null : nowIndex(ticks)}
                nowLabel={formatTime(day.now)}
                recordAt={day.record?.tick ?? null}
                label={`${hm(t.spent)} spent (${hm(t.unverified)} unconfirmed), ${hm(t.lost)} lost, ${hm(t.ahead)} still ahead`}
              />
            </div>
            <TapeKey
              items={
                t.scorePct === null
                  ? [{ kind: "ahead" as const, text: `${hm(t.planned)} planned` }]
                  : [
                      ...(t.spent - t.unverified > 0 || t.unverified === 0
                        ? [{ kind: "spent" as const, text: `${hm(t.spent - t.unverified)} spent` }]
                        : []),
                      ...(t.unverified > 0
                        ? [{ kind: "unverified" as const, text: `${hm(t.unverified)} unconfirmed` }]
                        : []),
                      ...(t.lost > 0 ? [{ kind: "lost" as const, text: `${hm(t.lost)} lost` }] : []),
                      ...(t.ahead > 0 ? [{ kind: "ahead" as const, text: `${hm(t.ahead)} ahead` }] : []),
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

          {day.wonBackMinutes > 0 ? (
            <p className="mt-4 text-body">
              <b className="font-num font-bold text-tint-text">{minutesPhrase(day.wonBackMinutes)}</b> won
              back today.
            </p>
          ) : null}

          {momentKind ? <MomentCard kind={momentKind} sample={day.sample} /> : null}

          {day.lead ? <MichaelCard lead={day.lead} /> : null}

          {day.travelPlan ? <TravelCard plan={day.travelPlan} /> : null}

          <RecommendationsPanel />

          {day.nudge ? (
            <section className="mt-6">
              <h2 className="mb-2 text-title3 font-bold">Latest nudge</h2>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 rounded-group bg-fill px-4 py-3">
                <time
                  className="text-footnote leading-5 font-semibold text-label-2 tnum"
                  dateTime={day.nudge.at}
                >
                  {formatTime(day.nudge.at)}
                </time>
                <p className="text-subhead">{day.nudge.text}</p>
              </div>
            </section>
          ) : null}
        </>
      )}

      <BriefCard sample={day.sample} />

      {day.sample ? (
        <p className="mt-8 text-footnote text-label-2">
          Sample day. Your own day appears here once your sources are connected.
        </p>
      ) : null}
    </main>
  );
}
