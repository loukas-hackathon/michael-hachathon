import { addDays } from "@/lib/athens";
import type { Series } from "@/lib/insights";

const W = 160;
const H = 44;
const ORDER: Series["key"][] = ["sleep_score", "hrv", "resting_hr", "recovery"];
/** Short names for three across on a phone, where the full ones would cut. */
const SHORT: Partial<Record<Series["key"], string>> = {
  sleep_score: "Sleep",
  hrv: "HRV",
  resting_hr: "Resting HR",
  recovery: "Recovery",
};
/** Columns by how many lines have values, so three or two sit evenly instead of leaving a hole. */
const GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 xl:grid-cols-4",
};
const UNIT: Record<string, string> = { score: "", pct: "%", ms: " ms", bpm: " bpm", min: " min", count: "" };

/** The line split at every null, so a night without the watch is a gap, never a slope. */
function segments(s: Series, lo: number, hi: number) {
  const n = Math.max(1, s.points.length - 1);
  const y = (v: number) => H - 3 - ((v - lo) / Math.max(1, hi - lo)) * (H - 6);
  const runs: string[] = [];
  let run: string[] = [];
  s.points.forEach((p, i) => {
    if (p.value == null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${((i / n) * W).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(" "));
  return { runs, x: (i: number) => (i / n) * W, y };
}

/** The real span of the study: first to last day with any reading, as "8 days" or "5 weeks". */
export function spanLabel(series: Series[]): string | null {
  const days = series.flatMap((s) => s.points.filter((p) => p.value != null).map((p) => p.day)).sort();
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return null;
  const n = Math.round((Date.parse(`${last}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000) + 1;
  if (n < 14) return `${n} ${n === 1 ? "day" : "days"}`;
  return `${Math.round(n / 7)} weeks`;
}

const hasLine = (s: Series) => s.points.filter((p) => p.value != null).length >= 2;

function Multiple({
  s,
  marks,
  span,
  short,
}: {
  s: Series;
  marks: Set<string>;
  span: string;
  short: boolean;
}) {
  const values = s.points.map((p) => p.value).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const last = [...s.points].reverse().find((p) => p.value != null)?.value;
  const usual = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const { runs, x, y } = segments(s, lo, hi);
  const marked = s.points.map((p, i) => ({ p, i })).filter(({ p }) => p.value != null && marks.has(p.day));
  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-col">
        {short && SHORT[s.key] ? (
          <>
            <span className="truncate text-footnote text-label-2 sm:hidden">{SHORT[s.key]}</span>
            <span className="truncate text-footnote text-label-2 max-sm:hidden">{s.label}</span>
          </>
        ) : (
          <span className="truncate text-footnote text-label-2">{s.label}</span>
        )}
        <span className="text-title3 font-bold tnum">
          {last}
          <span className="text-footnote font-semibold text-label-2">{UNIT[s.unit] ?? ""}</span>
          <span className={`ml-1.5 text-footnote font-normal text-label-2 ${short ? "max-sm:hidden" : ""}`}>
            usually {usual}
          </span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-1.5 block h-11 w-full overflow-visible"
        role="img"
        aria-label={`${s.label} over ${span}: usually ${usual}${UNIT[s.unit] ?? ""}, lowest ${lo}, highest ${hi}, last ${last}.`}
      >
        {marked.map(({ p, i }) => (
          <line
            key={p.day}
            x1={x(i)}
            x2={x(i)}
            y1={H}
            y2={y(p.value as number)}
            className="stroke-label-2"
            strokeWidth="1"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {runs.map((pts) => (
          <polyline
            key={pts.slice(0, 24)}
            points={pts}
            fill="none"
            className="stroke-label"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </figure>
  );
}

/**
 * The body over the span Michael studied (#432, up to 12 weeks): up to four small multiples, black
 * lines, gaps where there was no reading; a line without values is left out and the rest share the
 * row evenly. With a chain open, the sleep line marks the night after each trigger.
 */
export function StudySeries({
  series,
  triggerDays,
  triggerLabel,
}: {
  series: Series[];
  triggerDays?: string[];
  triggerLabel?: string;
}) {
  const shown = ORDER.map((k) => series.find((s) => s.key === k)).filter(
    (s): s is Series => Boolean(s) && hasLine(s as Series),
  );
  const span = spanLabel(shown);
  if (!shown.length || !span) return null;
  // Every line covers the same days: the first to the last with any reading, so none starts indented.
  const read = shown.flatMap((x) => x.points.filter((p) => p.value != null).map((p) => p.day)).sort();
  const [from, to] = [read[0] ?? "", read[read.length - 1] ?? ""];
  const lines = shown.map((x) => ({ ...x, points: x.points.filter((p) => p.day >= from && p.day <= to) }));
  const three = shown.length === 3;
  // A trigger is an evening; its sleep is scored the morning after.
  const marks = new Set((triggerDays ?? []).map((d) => addDays(d, 1)));
  return (
    <section aria-label={`Your body over ${span}`} className="mt-6">
      <div className={`grid gap-x-5 gap-y-5 rounded-group bg-fill px-4 py-4 ${GRID[shown.length]}`}>
        {lines.map((s) => (
          <Multiple
            key={s.key}
            s={s}
            span={span}
            short={three}
            marks={s.key === "sleep_score" ? marks : new Set()}
          />
        ))}
      </div>
      <p className="mt-2 px-4 text-footnote text-label-2">
        {span.charAt(0).toUpperCase() + span.slice(1)}.
        {marks.size && triggerLabel
          ? ` Dashed on sleep: the morning after each of the ${marks.size} nights with ${triggerLabel}.`
          : null}
      </p>
    </section>
  );
}
