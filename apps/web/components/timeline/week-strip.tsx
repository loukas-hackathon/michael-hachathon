import Link from "next/link";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Monday first, like Apple's calendar strip. Days without data are shown but cannot be opened. */
export function WeekStrip({ date, available }: { date: string; available: string[] }) {
  const d = new Date(`${date}T12:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );

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
            href={`/timeline?date=${day}`}
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
