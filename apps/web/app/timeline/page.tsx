import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen";
import { DayTimeline, TimelineKey } from "@/components/timeline/day-timeline";
import { WeekStrip } from "@/components/timeline/week-strip";
import { DATES_WITH_DATA, DEFAULT_DATE, getTimelineDay } from "@/lib/days";
import { formatDay, formatMonth, hm, minutesPhrase } from "@/lib/format";

export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: asked } = await searchParams;
  const date = asked && /^\d{4}-\d\d-\d\d$/.test(asked) ? asked : DEFAULT_DATE;
  const result = getTimelineDay(date);
  const noon = `${date}T12:00:00+02:00`;

  return (
    <main className="screen">
      <ScreenHeader context={formatMonth(noon)} title="Timeline" />
      <WeekStrip date={date} available={DATES_WITH_DATA} />

      {result ? (
        <>
          <h2 className="mt-4 text-title3 font-bold">{formatDay(noon)}</h2>
          <p className="mt-1 text-subhead text-label-2">
            {result.day.sample ? (
              <>
                <b className="font-semibold text-label">{hm(result.day.totals.workMinutes)}</b> of goal time
                so far,{" "}
                <b className="font-semibold text-label">{minutesPhrase(result.day.totals.lostMinutes)}</b>{" "}
                lost.
              </>
            ) : (
              <>
                <b className="font-semibold text-label">{result.day.totals.phoneSessions} phone sessions</b>,{" "}
                {hm(result.day.totals.phoneMinutes)} on the phone.
                {result.longestUninterrupted != null ? (
                  <>
                    {" "}
                    The longest stretch without a break was{" "}
                    <b className="font-semibold text-label">{minutesPhrase(result.longestUninterrupted)}</b>.
                  </>
                ) : null}
                {result.day.totals.workMinutes >= 1 ? (
                  <>
                    {" "}
                    {hm(result.day.totals.workMinutes)} in work apps, {hm(result.day.totals.lostMinutes)} lost
                    to messages and social.
                  </>
                ) : null}
              </>
            )}
          </p>
          <TimelineKey hasAi={result.day.ai.length > 0} hasPlan={Boolean(result.day.sample)} />
          <DayTimeline day={result.day} />
          <p className="mt-6 text-footnote text-label-2">
            {result.day.sample
              ? "Sample day. Your own days appear here once your sources are connected."
              : "A real day from the demo account, anonymised. No calendar yet, so goal time is time in work apps; planned blocks appear as outlines once the calendar is connected."}
          </p>
        </>
      ) : (
        <EmptyState
          title="Nothing recorded on this day."
          action={
            <Link
              href="/timeline"
              className="press inline-flex min-h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text"
            >
              Show the latest day
            </Link>
          }
        >
          I only show days when a source was connected. Pick a day in bold above.
        </EmptyState>
      )}
    </main>
  );
}
