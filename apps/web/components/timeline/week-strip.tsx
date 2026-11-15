import Link from "next/link";
import { addDays, weekOf } from "@/lib/athens";
import { formatDay } from "@/lib/format";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Monday first, like Apple's calendar strip. The shown day is the black circle; today carries a pink
 * dot underneath and bold pink numerals when another day is shown. Past days with data are solid,
 * future days with planned blocks are dashed outlines (the Planned key), days with nothing are faint
 * and cannot be opened. `demo` keeps ?demo=sample on the links so the sample week stays the sample.
 * Under the days, one quiet line steps a week back (`earlier`: a day with data in the week before,
 * so the step never lands on an empty week) and forward again up to this week (#330): on a Monday
 * last week is otherwise out of reach.
 */
export function WeekStrip({
  date,
  today,
  available,
  earlier = null,
  demo,
}: {
  date: string;
  today: string;
  available: string[];
  earlier?: string | null;
  demo?: string;
}) {
  const days = weekOf(date);
  // Forward is the same weekday a week on, and never passes today.
  const after = addDays(date, 7) > today ? today : addDays(date, 7);
  const hasLater = date < today && !weekOf(today).includes(date);

  return (
    <nav aria-label="Days" className="mt-2.5 grid grid-cols-7 text-center">
      {days.map((day, i) => {
        const selected = day === date;
        const isToday = day === today;
        const has = available.includes(day);
        const planned = has && day > today;
        const n = Number(day.slice(8));
        const circle = selected
          ? "bg-label font-semibold text-bg"
          : isToday
            ? "font-bold text-tint-text"
            : planned
              ? "border-[1.5px] border-dashed border-label-2 font-medium text-label-2"
              : has
                ? "font-semibold text-label"
                : "text-label-2 opacity-50";
        // VoiceOver reads "Friday 13 November", not "F 13".
        const name = formatDay(`${day}T12:00:00+02:00`);
        const inner = (
          <>
            <span className="sr-only">{has || isToday ? name : `${name}, nothing recorded`}</span>
            <span
              aria-hidden="true"
              className={`text-caption font-semibold ${isToday ? "text-tint-text" : "text-label-2"}`}
            >
              {LETTERS[i]}
            </span>
            <span
              aria-hidden="true"
              className={`grid size-[34px] place-items-center rounded-full text-body tnum ${circle}`}
            >
              {n}
            </span>
            <span
              aria-hidden="true"
              className={`size-1 rounded-full ${isToday ? "bg-tint" : "bg-transparent"}`}
            />
            {isToday || planned ? <span className="sr-only">{isToday ? "Today" : "Planned"}</span> : null}
          </>
        );
        return (has || isToday) && !selected ? (
          <Link
            key={day}
            href={`/timeline?day=${day}${demo ? `&demo=${demo}` : ""}`}
            aria-current={isToday ? "date" : undefined}
            className="press flex flex-col items-center gap-0.5 py-1"
          >
            {inner}
          </Link>
        ) : (
          <span
            key={day}
            aria-current={selected ? "date" : undefined}
            aria-disabled={has || selected ? undefined : true}
            className="flex flex-col items-center gap-0.5 py-1"
          >
            {inner}
          </span>
        );
      })}
      {demo || !(earlier || hasLater) ? null : (
        <p className="col-span-7 mt-1 flex items-center justify-between">
          {earlier ? (
            <Link
              href={`/timeline?day=${earlier}`}
              aria-label={`The week before, ${weekSpan(earlier, true)}`}
              className={STEP}
            >
              <span aria-hidden="true">‹</span>
              {weekSpan(earlier)}
            </Link>
          ) : (
            <span />
          )}
          {hasLater ? (
            <Link
              href={`/timeline?day=${after}`}
              aria-label={`The week after, ${weekSpan(after, true)}`}
              className={STEP}
            >
              {weekSpan(after)}
              <span aria-hidden="true">›</span>
            </Link>
          ) : null}
        </p>
      )}
    </nav>
  );
}

const STEP =
  "press hit flex min-h-7 items-center gap-1 text-footnote font-semibold text-label-2 tnum focus-visible:outline-2 focus-visible:outline-label";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The week holding `date`, Monday to Sunday: "9 to 15 Nov", "26 Oct to 1 Nov" (`long`: full months). */
export function weekSpan(date: string, long = false): string {
  const week = weekOf(date);
  const [from, to] = [week[0] as string, week[6] as string];
  const month = (d: string) => {
    const name = MONTHS[Number(d.slice(5, 7)) - 1] as string;
    return long ? name : name.slice(0, 3);
  };
  const day = (d: string) => Number(d.slice(8));
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${day(from)} to ${day(to)} ${month(to)}`
    : `${day(from)} ${month(from)} to ${day(to)} ${month(to)}`;
}
