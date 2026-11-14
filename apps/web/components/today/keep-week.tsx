import { hm, minutesPhrase } from "@/lib/format";
import type { KeepDay, KeepWeek } from "@/lib/keep-day";
import { weekdayName } from "@/lib/keep-day";

const LETTER = ["M", "T", "W", "T", "F", "S", "S"];
const BAR_PX = 96;

function Dot({ state }: { state: KeepDay["state"] }) {
  if (state === "kept") return <span className="size-1.5 rounded-full bg-label" />;
  if (state === "future") return <span className="size-1.5" />;
  if (state === "missed")
    return <span className="size-1.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--m-separator)]" />;
  if (state === "free")
    return <span className="size-1.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--m-label-2)]" />;
  return <span className="size-1.5 rounded-full shadow-[inset_0_0_0_1px_var(--m-separator)]" />;
}

function label(d: KeepDay, i: number, line: number, isToday: boolean) {
  const name = `${weekdayName(i)}${isToday ? ", today" : ""}`;
  switch (d.state) {
    case "kept":
      return `${name}: kept, ${d.pct}% of ${hm(d.planned)}`;
    case "missed":
      return `${name}: ${d.pct}%, under the ${line}% line`;
    case "open":
      return `${name}: ${d.pct}% so far, the line is ${line}%`;
    case "free":
      return d.rest ? `${name}: your rest day` : `${name}: no goal blocks, it does not count`;
    default:
      return d.rest ? `${name}: your rest day` : `${name}: still to come`;
  }
}

/**
 * The week as seven columns (Keep the Day). Pink fills a column with the day's goal time against
 * what was planned; the black line is where the day is kept. A dot under each day: filled when kept,
 * a grey ring for a day without goal blocks (it never breaks the run), faint for the rest.
 */
export function KeepWeekStrip({ week }: { week: KeepWeek }) {
  const lineAt = Math.min(100, week.line);
  return (
    <ol className="mt-4 grid grid-cols-7 gap-2" aria-label={`This week against the ${week.line}% line`}>
      {week.days.map((d, i) => {
        const isToday = d.date === week.today;
        const fill = d.pct == null ? 0 : Math.min(100, d.pct);
        const hasBlocks = d.planned > 0;
        return (
          <li key={d.date} className="flex min-w-0 flex-col items-center gap-1.5">
            <span className="sr-only">{label(d, i, week.line, isToday)}</span>
            <span
              aria-hidden="true"
              className={`relative w-full overflow-hidden rounded-[8px] ${
                isToday
                  ? "shadow-[inset_0_0_0_1.5px_var(--m-label)]"
                  : d.rest
                    ? "border border-dashed border-separator"
                    : d.state === "free"
                      ? ""
                      : "shadow-[inset_0_0_0_1px_var(--m-separator)]"
              }`}
              style={{ height: BAR_PX }}
            >
              {fill > 0 ? (
                <span className="absolute inset-x-0 bottom-0 bg-spark" style={{ height: `${fill}%` }} />
              ) : null}
              {d.rest || (!hasBlocks && d.state !== "future") ? null : d.state === "future" ? (
                <span className="absolute inset-x-0 h-px bg-separator" style={{ bottom: `${lineAt}%` }} />
              ) : (
                <span
                  className="absolute inset-x-0 h-[2px] bg-label"
                  style={{ bottom: `calc(${lineAt}% - 1px)` }}
                />
              )}
            </span>
            <Dot state={d.state} />
            <span className={`text-caption font-semibold ${isToday ? "text-label" : "text-label-2"}`}>
              {LETTER[i]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** "6 days kept in a row. Sunday is your rest day." Numbers first, no guilt when the run is 0. */
export function streakLine(week: KeepWeek) {
  const rest = week.restDays.length
    ? ` ${week.restDays.join(" and ")} ${week.restDays.length === 1 ? "is your rest day" : "are your rest days"}.`
    : "";
  if (week.streak === 0) return `Keep today to start a run.${rest}`;
  return `${week.streak} ${week.streak === 1 ? "day" : "days"} kept in a row.${rest}`;
}

/** Under the score: what keeps today, or that it is kept. Null when today has no goal blocks. */
export function keepLine(week: KeepWeek) {
  if (week.need == null) return null;
  if (week.need === 0) return "Today is kept.";
  return `${minutesPhrase(week.need)} keeps the day.`;
}
