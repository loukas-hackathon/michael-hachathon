import { addDays } from "@/lib/athens";
import type { Series } from "@/lib/insights";

const W = 160;
const H = 44;
const ORDER: Series["key"][] = ["sleep_score", "hrv", "resting_hr", "recovery"];
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

function Multiple({ s, marks }: { s: Series; marks: Set<string> }) {
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
        <span className="truncate text-footnote text-label-2">{s.label}</span>
        <span className="text-title3 font-bold tnum">
          {last}
          <span className="text-footnote font-semibold text-label-2">{UNIT[s.unit] ?? ""}</span>
          <span className="ml-1.5 text-footnote font-normal text-label-2">usually {usual}</span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-1.5 block h-11 w-full overflow-visible"
        role="img"
        aria-label={`${s.label} over 12 weeks: usually ${usual}${UNIT[s.unit] ?? ""}, lowest ${lo}, highest ${hi}, last ${last}.`}
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
 * The body over the 12 weeks Michael studied (#432): four small multiples, black lines, gaps where
 * there was no reading. With a chain open, the sleep line marks the night after each trigger.
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
  const shown = ORDER.map((k) => series.find((s) => s.key === k)).filter((s): s is Series => Boolean(s));
  if (!shown.length) return null;
  // A trigger is an evening; its sleep is scored the morning after.
  const marks = new Set((triggerDays ?? []).map((d) => addDays(d, 1)));
  return (
    <section aria-label="Your body over 12 weeks" className="mt-6">
      <div className="grid grid-cols-2 gap-x-5 gap-y-5 rounded-group bg-fill px-4 py-4 xl:grid-cols-4">
        {shown.map((s) => (
          <Multiple key={s.key} s={s} marks={s.key === "sleep_score" ? marks : new Set()} />
        ))}
      </div>
      <p className="mt-2 px-4 text-footnote text-label-2">
        12 weeks.
        {marks.size && triggerLabel
          ? ` Dashed on sleep: the morning after each of the ${marks.size} nights with ${triggerLabel}.`
          : null}
      </p>
    </section>
  );
}
