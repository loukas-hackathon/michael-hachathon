import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen";
import { Tape, TapeKey } from "@/components/tape";
import { MichaelCard } from "@/components/today/michael-card";
import { MomentCard } from "@/components/today/moment-card";
import { getToday } from "@/lib/api";
import { type DayView, nowIndex, tape, totals } from "@/lib/day";
import { formatDay, formatTime, hm, minutesPhrase } from "@/lib/format";

const TITLE: Record<DayView["moment"], string> = { morning: "Morning", today: "Today", evening: "Evening" };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const day = await getToday(demo);
  const ticks = tape(day);
  const t = totals(day);
  const firstBlock = day.blocks[0];

  return (
    <main className="screen">
      <ScreenHeader context={formatDay(day.now)} title={TITLE[day.moment]} />

      {day.blocks.length === 0 ? (
        <EmptyState title="Nothing yet.">
          Wear the watch tonight and your first brief arrives in the morning.
        </EmptyState>
      ) : (
        <>
          <p className="mt-1.5 text-subhead text-label-2">
            We're at <b className="font-semibold text-label tnum">{day.week.scorePct}%</b> of goal time this
            week. {day.week.line}
          </p>

          <section aria-label="Goal time today" className="mt-5">
            {t.scorePct === null && firstBlock ? (
              <p className="text-title3 font-semibold">
                Your first block starts at <span className="tnum">{formatTime(firstBlock.start)}</span>.
              </p>
            ) : (
              <h2 className="flex flex-col">
                <span className="font-num text-score font-extrabold tracking-[-0.02em] tnum">
                  {t.scorePct}%
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
                label={`${hm(t.spent)} spent, ${hm(t.lost)} lost, ${hm(t.ahead)} still ahead`}
              />
            </div>
            <TapeKey
              items={[
                t.scorePct === null
                  ? { kind: "ahead" as const, text: `${hm(t.planned)} planned` }
                  : { kind: "spent" as const, text: `${hm(t.spent)} spent` },
                ...(t.lost > 0 ? [{ kind: "lost" as const, text: `${hm(t.lost)} lost` }] : []),
                ...(t.ahead > 0 && t.scorePct !== null
                  ? [{ kind: "ahead" as const, text: `${hm(t.ahead)} ahead` }]
                  : []),
              ]}
            />
          </section>

          {day.wonBackMinutes > 0 ? (
            <p className="mt-4 text-body">
              <b className="font-num font-bold text-tint-text">{minutesPhrase(day.wonBackMinutes)}</b> won
              back today.
            </p>
          ) : null}

          {day.moment !== "today" ? <MomentCard kind={day.moment} /> : null}

          {day.lead ? <MichaelCard lead={day.lead} /> : null}

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

      {day.sample ? (
        <p className="mt-8 text-footnote text-label-2">
          Sample day. Your own day appears here once your sources are connected.
        </p>
      ) : null}
    </main>
  );
}
