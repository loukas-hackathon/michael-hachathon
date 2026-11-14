import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { LiveRefresh } from "@/components/live-refresh";
import { ScreenHeader } from "@/components/screen";
import { DayTimeline, TimelineKey } from "@/components/timeline/day-timeline";
import { WeekStrip } from "@/components/timeline/week-strip";
import { formatDay, formatMonth, hm, minutesPhrase } from "@/lib/format";
import { loadTimeline } from "@/lib/timeline-data";

type Search = { day?: string; date?: string; demo?: string };

export default async function TimelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const { day: askedDay, date: askedDate, demo } = await searchParams;
  // ?day= is the link format; ?date= still works for links made before.
  const screen = await loadTimeline(askedDay ?? askedDate, demo);
  const { date, day } = screen;
  const noon = `${date}T12:00:00+02:00`;
  const sampleParam = demo === "sample" ? "sample" : undefined;
  const plans = day?.plans ?? [];

  return (
    <main className="screen">
      <ScreenHeader
        context={
          <>
            {formatMonth(noon)}
            <LiveRefresh />
          </>
        }
        title="Timeline"
      />
      <WeekStrip date={date} available={screen.available} demo={sampleParam} />

      {day ? (
        <>
          <h2 className="mt-4 text-title3 font-bold">{formatDay(noon)}</h2>
          <p className="mt-1 text-subhead text-label-2">
            {day.sample ? (
              <>
                <b className="font-semibold text-label">{hm(day.totals.workMinutes)}</b> of goal time so far,{" "}
                <b className="font-semibold text-label">{minutesPhrase(day.totals.lostMinutes)}</b> lost.
              </>
            ) : day.blocks.length === 0 && day.phone.length === 0 ? (
              <>
                No screens recorded{plans.length > 0 ? ", " : "."}
                {plans.length > 0 ? (
                  <>
                    <b className="font-semibold text-label">
                      {plans.length} {plans.length === 1 ? "block" : "blocks"}
                    </b>{" "}
                    planned.
                  </>
                ) : null}
              </>
            ) : (
              <>
                <b className="font-semibold text-label">{day.totals.phoneSessions} phone sessions</b>,{" "}
                {hm(day.totals.phoneMinutes)} on the phone.
                {screen.longestUninterrupted != null ? (
                  <>
                    {" "}
                    The longest stretch without a break was{" "}
                    <b className="font-semibold text-label">{minutesPhrase(screen.longestUninterrupted)}</b>.
                  </>
                ) : null}
                {day.totals.workMinutes >= 1 ? (
                  <>
                    {" "}
                    {hm(day.totals.workMinutes)} in work apps, {hm(day.totals.lostMinutes)} lost to messages
                    and social.
                  </>
                ) : null}
              </>
            )}
          </p>
          <TimelineKey
            hasAi={day.ai.length > 0}
            hasPlan={Boolean(day.sample) || plans.length > 0}
            goalTime={Boolean(day.sample)}
            hasMichael={plans.some((p) => p.michael)}
          />
          <DayTimeline day={day} />
          <p className="mt-6 text-footnote text-label-2">
            {screen.source === "sample"
              ? day.sample
                ? "Sample day. Your own days appear here once your sources are connected."
                : "A real day from the demo account, anonymised, bundled with the app."
              : plans.length > 0
                ? "Outlines are your calendar. Blocks I booked carry my name, and you can undo them in Today until they start."
                : "No calendar on this day, so goal time is time in work apps. Connect the calendar and planned blocks appear as outlines."}
          </p>
        </>
      ) : (
        <EmptyState
          title="Nothing recorded on this day."
          action={
            screen.latest ? (
              <Link
                href={`/timeline?day=${screen.latest}${sampleParam ? "&demo=sample" : ""}`}
                className="press inline-flex min-h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text"
              >
                Show the latest day
              </Link>
            ) : (
              <Link
                href="/you"
                className="press inline-flex min-h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text"
              >
                Connect a source
              </Link>
            )
          }
        >
          I only show days your sources were connected. Pick a day in bold above.
        </EmptyState>
      )}
    </main>
  );
}
