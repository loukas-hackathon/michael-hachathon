import Link from "next/link";
import { weekOf } from "@/lib/athens";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Monday first, like Apple's calendar strip. Days without data are shown but cannot be opened.
 * `demo` keeps ?demo=sample on the links so the sample week stays the sample week.
 */
export function WeekStrip({ date, available, demo }: { date: string; available: string[]; demo?: string }) {
  const days = weekOf(date);

  return (
    <nav aria-label="Days" className="mt-2.5 grid grid-cols-7 text-center">
      {days.map((day, i) => {
        const selected = day === date;
        const has = available.includes(day);
        const n = Number(day.slice(8));
        const inner = (
          <>
            <span className="text-caption font-semibold text-label-2">{LETTERS[i]}</span>
            <span
              className={`grid size-[34px] place-items-center rounded-full text-body tnum ${
                selected
                  ? "bg-label font-semibold text-bg"
                  : has
                    ? "font-medium text-label"
                    : "text-label-2 opacity-50"
              }`}
            >
              {n}
            </span>
          </>
        );
        return has && !selected ? (
          <Link
            key={day}
            href={`/timeline?day=${day}${demo ? `&demo=${demo}` : ""}`}
            className="press flex flex-col items-center gap-0.5 py-1"
          >
            {inner}
          </Link>
        ) : (
          <span
            key={day}
            aria-current={selected ? "date" : undefined}
            aria-disabled={has ? undefined : true}
            className="flex flex-col items-center gap-0.5 py-1"
          >
            {inner}
          </span>
        );
      })}
    </nav>
  );
}
