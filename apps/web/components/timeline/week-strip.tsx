import Link from "next/link";
import { weekOf } from "@/lib/athens";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Monday first, like Apple's calendar strip. The shown day is the black circle; today carries a pink
 * dot underneath and bold pink numerals when another day is shown. Past days with data are solid,
 * future days with planned blocks are dashed outlines (the Planned key), days with nothing are faint
 * and cannot be opened. `demo` keeps ?demo=sample on the links so the sample week stays the sample.
 */
export function WeekStrip({
  date,
  today,
  available,
  demo,
}: {
  date: string;
  today: string;
  available: string[];
  demo?: string;
}) {
  const days = weekOf(date);

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
        const inner = (
          <>
            <span className={`text-caption font-semibold ${isToday ? "text-tint-text" : "text-label-2"}`}>
              {LETTERS[i]}
            </span>
            <span className={`grid size-[34px] place-items-center rounded-full text-body tnum ${circle}`}>
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
    </nav>
  );
}
