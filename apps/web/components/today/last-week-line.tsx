import Link from "next/link";
import { hm } from "@/lib/format";
import type { LostWeek } from "@/lib/lost-week";

/**
 * Monday only: "3h 54 lost from your goal blocks last week. Instagram took 2h 28 of it." This
 * week's line is near empty on a Monday, so last week's total gets its own line. Opens Timeline on
 * last week.
 */
export function LastWeekLine({ week, demo }: { week: LostWeek; demo?: string }) {
  if (week.total <= 0) return null;
  const top = week.causes[0];
  const query = new URLSearchParams({ day: week.date });
  if (demo === "monday") query.set("demo", "sample");
  return (
    <Link
      href={`/timeline?${query}`}
      className="press mt-1 flex items-start justify-between gap-3 text-subhead text-label-2"
    >
      <span>
        <b className="font-semibold text-label tnum">{hm(week.total)}</b> lost from your goal blocks last
        week.
        {top ? (
          <>
            {" "}
            {top.what} took <span className="tnum">{hm(top.minutes)}</span> of it.
          </>
        ) : null}
      </span>
      <span aria-hidden="true" className="shrink-0">
        ›
      </span>
    </Link>
  );
}
