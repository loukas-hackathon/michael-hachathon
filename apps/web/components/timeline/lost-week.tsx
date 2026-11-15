import Link from "next/link";
import type { ReactNode } from "react";
import { hm } from "@/lib/format";
import { type LostCause, type LostWeek, phoneUntilLabel, topCauses, worstDay } from "@/lib/lost-week";

const NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CHART_PX = 64;

/** A round top for the scale, so the tallest bar never touches the labels. */
function niceMax(n: number) {
  if (n <= 30) return 30;
  const step = n <= 120 ? 30 : 60;
  return Math.ceil(n / step) * step;
}

/**
 * Goal time lost per day of the week (Timeline, top). Shown only when something was lost this week.
 * Bars are grey and hatched, the lost colour everywhere in the app; days to come are empty slots,
 * never zero bars. A bar opens that day. The day letters and dates are the week strip, passed in
 * as `strip` and set right under the bars on the same seven columns, so each bar has its date and
 * there is never a second row of dates.
 */
export function LostWeekChart({
  week,
  selected,
  hrefFor,
  strip,
}: {
  week: LostWeek;
  selected: string;
  hrefFor: (date: string) => string;
  /** The week strip (letters and day of the month), drawn directly under the bars. */
  strip?: ReactNode;
}) {
  const max = niceMax(Math.max(0, ...week.days.map((d) => d.lost ?? 0)));
  const worst = worstDay(week);
  const worstIdx = worst ? week.days.findIndex((d) => d.date === worst.date) : -1;
  const inWeek = week.days.some((d) => d.date === week.today);

  return (
    <section aria-labelledby="lost-week-h" className="mt-3">
      <p id="lost-week-h" className="text-footnote font-semibold text-label-2">
        Lost from your goal blocks
      </p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="font-num text-[44px] leading-none font-extrabold tracking-[-0.02em] tnum">
          {hm(week.total)}
        </span>
        <span className="text-title3 font-semibold">{inWeek ? "this week." : "that week."}</span>
      </p>

      <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Goal time lost each day">
        {week.days.map((d, i) => {
          const isToday = d.date === week.today;
          const isSelected = d.date === selected;
          const future = d.lost == null;
          const h = future ? 0 : Math.round(((d.lost ?? 0) / max) * CHART_PX);
          // A day with nothing lost (today before a block has run, a day without goal blocks) has
          // no bar and no "0": nothing to report is not a number to read.
          const label = future
            ? `${NAME[i]}: still to come`
            : `${NAME[i]}${isToday ? ", today" : ""}: ${d.lost ? `${hm(d.lost)} lost from goal blocks` : "nothing lost"}`;
          const body = (
            <>
              <span
                className="relative flex w-full items-end justify-center"
                style={{ height: CHART_PX + 18 }}
              >
                {future ? (
                  <span className="absolute inset-x-1 bottom-0 h-0 border-b border-dashed border-separator" />
                ) : d.lost ? (
                  <span className="flex w-full flex-col items-center justify-end gap-1">
                    <span
                      className={`text-caption tnum ${i === worstIdx ? "font-semibold text-label" : "text-label-2"}`}
                    >
                      {hm(d.lost)}
                    </span>
                    <span
                      className="hatch w-full max-w-9 rounded-t-[5px] bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]"
                      style={{ height: Math.max(3, h) }}
                    />
                  </span>
                ) : null}
              </span>
            </>
          );
          return (
            <li key={d.date} className="min-w-0">
              {future ? (
                <span className="flex flex-col items-center">
                  <span className="sr-only">{label}</span>
                  {body}
                </span>
              ) : (
                <Link
                  href={hrefFor(d.date)}
                  aria-label={label}
                  aria-current={isSelected ? "date" : undefined}
                  className="press flex flex-col items-center rounded-control focus-visible:outline-2 focus-visible:outline-label"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {strip}

      {week.causes.length ? <LostCauses causes={week.causes} total={week.total} /> : null}

      <p className="mt-2 text-footnote text-label-2 tnum">
        {worst ? `Most on ${NAME[worstIdx]}, ${hm(worst.lost ?? 0)}. ` : null}
        {week.phoneUntil
          ? `Phone data up to ${phoneUntilLabel(week.phoneUntil, week.today)}, so today can still grow.`
          : null}
      </p>
    </section>
  );
}

/** What took the lost time: the top three, each with its share as a hatched bar, then the rest. */
export function LostCauses({ causes, total }: { causes: LostCause[]; total: number }) {
  const { top, others, rest } = topCauses(causes, total);
  const scale = Math.max(1, ...top.map((c) => c.minutes));
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-footnote font-semibold text-label-2">What took it</h3>
      {/* One grid for all rows: the name column is as wide as the longest name needs (it only
          truncates when the row truly runs out), and the bars still start on one line. */}
      <ul className="grid grid-cols-[minmax(0,max-content)_minmax(3rem,1fr)_auto] gap-x-3 overflow-hidden rounded-group bg-fill">
        {top.map((c, i) => (
          <li key={c.what} className="relative col-span-3 grid grid-cols-subgrid items-center px-4 py-2.5">
            {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
            <span className="truncate text-body">{c.what}</span>
            <span className="flex h-2.5">
              <span
                aria-hidden="true"
                className="hatch h-full rounded-full bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]"
                style={{ width: `${Math.max(6, (c.minutes / scale) * 100)}%` }}
              />
            </span>
            <span className={`text-subhead tnum ${i === 0 ? "font-semibold" : "text-label-2"}`}>
              {hm(c.minutes)}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className="mt-1.5 px-4 text-footnote text-label-2 tnum">
          {hm(rest)} more from {others} other {others === 1 ? "thing" : "things"}.
        </p>
      ) : null}
      {total > 0 && top[0] ? (
        <p className="sr-only">
          {top[0].what} took {hm(top[0].minutes)} of the {hm(total)} lost.
        </p>
      ) : null}
    </div>
  );
}
