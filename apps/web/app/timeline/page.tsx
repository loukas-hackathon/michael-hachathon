import { cookies } from "next/headers";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { LiveRefresh } from "@/components/live-refresh";
import { ScreenHeader } from "@/components/screen";
import { DayTimeline, DayTimelineList, HeartRow } from "@/components/timeline/day-timeline";
import { LostWeekChart } from "@/components/timeline/lost-week";
import { WeekStrip } from "@/components/timeline/week-strip";
import { getLostWeek } from "@/lib/api";
import { addDays } from "@/lib/athens";
import { formatDay, formatMonth, formatWeekday, hm, minutesPhrase } from "@/lib/format";
import { HEART_COOKIE } from "@/lib/health";
import { loadTimeline } from "@/lib/timeline-data";

type Search = { day?: string; date?: string; demo?: string };

const tinted =
  "press inline-flex min-h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text";

export default async function TimelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const { day: askedDay, date: askedDate, demo } = await searchParams;
  // ?day= is the link format; ?date= still works for links made before.
  const [screen, lostWeek] = await Promise.all([
    loadTimeline(askedDay ?? askedDate, demo),
    getLostWeek(askedDay ?? askedDate, demo),
  ]);
  const { date, day, today } = screen;
  const noon = `${date}T12:00:00+02:00`;
  const sampleParam = demo === "sample" ? "sample" : undefined;
  const plans = day?.plans ?? [];
  const heartHidden = (await cookies()).get(HEART_COOKIE)?.value === "off";
  const isToday = date === today;
  const dayHref = (d: string) => `/timeline?day=${d}${sampleParam ? "&demo=sample" : ""}`;
  const strip = (
    <WeekStrip
      date={date}
      today={today}
      available={screen.available}
      earlier={screen.earlier}
      demo={sampleParam}
    />
  );

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
      {/* Only when something was actually lost: an empty chart of zeros is noise. */}
      {/* With the chart, the strip sits right under the bars: each bar gets its letter and date. */}
      {lostWeek && lostWeek.total > 0 ? (
        <LostWeekChart week={lostWeek} selected={date} hrefFor={dayHref} strip={strip} />
      ) : (
        strip
      )}

      <div className="mt-4">
        {/* One "Today": the strip marks it, the heading says it once with the date. */}
        <h2 className="text-title3 font-bold">
          {isToday ? "Today, " : ""}
          {formatDay(noon)}
        </h2>
        {screen.source === "sample" && day ? (
          <p className="mt-0.5 text-footnote font-semibold text-label-2">
            {day.sample ? "Sample day, not yours." : "Demo account, anonymised. Not your data."}
          </p>
        ) : null}
      </div>

      {day ? (
        <>
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
                {day.totals.workMinutes >= 1 ? (
                  <>
                    <b className="font-semibold text-label">{hm(day.totals.workMinutes)}</b> in work apps,{" "}
                    {hm(day.totals.lostMinutes)} lost,{" "}
                  </>
                ) : null}
                {hm(day.totals.phoneMinutes)} on the phone.
                {screen.longestUninterrupted != null && screen.longestUninterrupted >= 1 ? (
                  <> Longest unbroken stretch {minutesPhrase(screen.longestUninterrupted)}.</>
                ) : null}
              </>
            )}
          </p>
          <HeartRow day={day} heartHidden={heartHidden} />
          <DayTimelineList day={day} />
          <DayTimeline day={day} heartHidden={heartHidden} sleepGoal={screen.sleepGoal} />
        </>
      ) : (
        <EmptyState
          title={
            isToday
              ? "Nothing recorded today yet."
              : date > today
                ? "Nothing planned on this day yet."
                : "Nothing recorded on this day."
          }
          action={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {screen.calendarConnected !== true ? (
                <Link href="/integrations/google/connect" className={tinted}>
                  Connect your calendar
                </Link>
              ) : null}
              {screen.latest ? (
                <Link
                  href={dayHref(screen.latest)}
                  className={
                    screen.calendarConnected === true
                      ? tinted
                      : "press inline-flex min-h-9 items-center text-subhead font-semibold text-tint-text"
                  }
                >
                  {screen.latest === addDays(today, -1)
                    ? "Show yesterday"
                    : `Show ${formatWeekday(`${screen.latest}T12:00:00+02:00`)}`}
                </Link>
              ) : null}
            </div>
          }
        >
          {screen.calendarConnected === true
            ? "Your calendar is clear and no screens have reported in."
            : "Connect your calendar to see your day."}
        </EmptyState>
      )}
    </main>
  );
}
