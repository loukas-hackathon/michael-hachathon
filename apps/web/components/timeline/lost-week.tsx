import Link from "next/link";
import { formatTime, hm } from "@/lib/format";
import { type LostCause, type LostWeek, worstDay } from "@/lib/lost-week";

const LETTER = ["M", "T", "W", "T", "F", "S", "S"];
const NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CHART_PX = 132;

/** A round top for the scale, so the tallest bar never touches the labels. */
function niceMax(n: number) {
  if (n <= 30) return 30;
  const step = n <= 120 ? 30 : 60;
  return Math.ceil(n / step) * step;
}

/**
 * Goal time lost per day of the week (Timeline, top). Bars are grey and hatched, the lost colour
 * everywhere in the app; days to come are empty slots, never zero bars. A bar opens that day.
 */
export function LostWeekChart({
  week,
  selected,
  hrefFor,
}: {
  week: LostWeek;
  selected: string;
  hrefFor: (date: string) => string;
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
          const label = future
            ? `${NAME[i]}: still to come`
            : `${NAME[i]}${isToday ? ", today" : ""}: ${hm(d.lost ?? 0)} lost from goal blocks`;
          const body = (
            <>
              <span
                className="relative flex w-full items-end justify-center"
                style={{ height: CHART_PX + 20 }}
              >
                {future ? (
                  <span className="absolute inset-x-1 bottom-0 h-0 border-b border-dashed border-separator" />
                ) : (
                  <span className="flex w-full flex-col items-center justify-end gap-1">
                    <span
                      className={`text-caption tnum ${i === worstIdx ? "font-semibold text-label" : "text-label-2"}`}
                    >
                      {d.lost ? hm(d.lost) : "0"}
                    </span>
                    {h > 0 ? (
                      <span
                        className="hatch w-full max-w-9 rounded-t-[5px] bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]"
                        style={{ height: Math.max(3, h) }}
                      />
                    ) : (
                      <span className="h-[2px] w-full max-w-9 rounded-full bg-label-2" />
                    )}
                  </span>
                )}
              </span>
              <span
                className={`mt-1.5 grid size-7 place-items-center rounded-full text-footnote font-semibold ${
                  isSelected ? "bg-label text-bg" : isToday ? "text-label" : "text-label-2"
                }`}
              >
                {LETTER[i]}
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
                  className="press flex flex-col items-center rounded-[10px] focus-visible:outline-2 focus-visible:outline-label"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>

      {week.causes.length ? <LostCauses causes={week.causes} total={week.total} /> : null}

      <p className="mt-2 text-footnote text-label-2 tnum">
        {worst
          ? `Most on ${NAME[worstIdx]}, ${hm(worst.lost ?? 0)}. `
          : "Nothing lost from goal blocks yet. "}
        {week.phoneUntil
          ? `Phone data up to ${week.phoneUntil.slice(0, 10) === week.today ? formatTime(week.phoneUntil) : `${NAME[(new Date(`${week.phoneUntil.slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7]} ${formatTime(week.phoneUntil)}`}, so today can still grow.`
          : null}
      </p>
    </section>
  );
}

/** What took the lost time: the top three, each with its share as a hatched bar, then the rest. */
export function LostCauses({ causes, total }: { causes: LostCause[]; total: number }) {
  const top = causes.slice(0, 3);
  const rest = causes.slice(3).reduce((n, c) => n + c.minutes, 0);
  const scale = Math.max(1, ...top.map((c) => c.minutes));
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-footnote font-semibold text-label-2">What took it</h3>
      <ul className="overflow-hidden rounded-group bg-fill">
        {top.map((c, i) => (
          <li
            key={c.what}
            className="relative grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
          >
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
          {hm(rest)} more from {causes.length - 3} other {causes.length - 3 === 1 ? "thing" : "things"}.
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
