import { cookies } from "next/headers";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { LiveRefresh } from "@/components/live-refresh";
import { ScreenHeader } from "@/components/screen";
import { DayTimeline, SleepBand, TimelineKey } from "@/components/timeline/day-timeline";
import { WeekStrip } from "@/components/timeline/week-strip";
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
  const screen = await loadTimeline(askedDay ?? askedDate, demo);
  const { date, day, today } = screen;
  const noon = `${date}T12:00:00+02:00`;
  const sampleParam = demo === "sample" ? "sample" : undefined;
  const plans = day?.plans ?? [];
  const heartHidden = (await cookies()).get(HEART_COOKIE)?.value === "off";
  const isToday = date === today;
  const dayHref = (d: string) => `/timeline?day=${d}${sampleParam ? "&demo=sample" : ""}`;

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
      <WeekStrip date={date} today={today} available={screen.available} demo={sampleParam} />

      <div className="mt-4">
        {isToday ? <p className="text-footnote font-semibold text-tint-text">Today</p> : null}
        <h2 className="text-title3 font-bold">{formatDay(noon)}</h2>
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
                <b className="font-semibold text-label">
                  {day.totals.phoneSessions} phone {day.totals.phoneSessions === 1 ? "session" : "sessions"}
                </b>
                , {hm(day.totals.phoneMinutes)} on the phone.
                {screen.longestUninterrupted != null && screen.longestUninterrupted >= 1 ? (
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
            goalTime={Boolean(day.sample)}
            hasDrives={(day.drives ?? []).length > 0}
            day={day}
            heartHidden={heartHidden}
          />
          {day.health?.lastNight ? <SleepBand night={day.health.lastNight} goal={screen.sleepGoal} /> : null}
          <DayTimeline day={day} heartHidden={heartHidden} />
          {day.health?.tonight ? (
            <SleepBand night={day.health.tonight} goal={screen.sleepGoal} tonight />
          ) : null}
          <p className="mt-6 text-footnote text-label-2">
            {screen.source === "sample"
              ? day.sample
                ? "Your own days appear here once your sources are connected."
                : "A real day from the demo account, bundled with the app. Tap any block for the detail."
              : plans.length > 0
                ? "Outlines are your calendar. Blocks I booked carry my name, and you can undo them in Today until they start."
                : "No calendar on this day, so goal time is time in work apps. Connect the calendar and planned blocks appear as outlines."}
          </p>
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
