import type { Series } from "@/lib/insights";

const W = 84;
const H = 30;

/**
 * The last two weeks as a small black line, split at every night without a reading, with the
 * user's usual as a dashed hairline and the last reading as a dot. Decoration for the row: the
 * figure and the comparison beside it carry the meaning, so it is hidden from VoiceOver.
 */
export function Spark({ series, usual, days = 14 }: { series: Series; usual: number; days?: number }) {
  const points = series.points.slice(-days);
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const lo = Math.min(usual, ...values);
  const hi = Math.max(usual, ...values);
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => (i / n) * W;
  const y = (v: number) => H - 3 - ((v - lo) / Math.max(1, hi - lo)) * (H - 6);
  const runs: string[] = [];
  let run: string[] = [];
  points.forEach((p, i) => {
    if (p.value == null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(" "));
  const lastAt = points.map((p) => p.value).findLastIndex((v) => v != null);
  const last = points[lastAt]?.value;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="h-[30px] w-[84px] shrink-0 overflow-visible">
      <line
        x1={0}
        x2={W}
        y1={y(usual)}
        y2={y(usual)}
        className="stroke-label-2"
        strokeWidth="1"
        strokeDasharray="2 3"
        opacity="0.6"
      />
      {runs.map((pts) => (
        <polyline
          key={pts.slice(0, 20)}
          points={pts}
          fill="none"
          className="stroke-label"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {last != null ? <circle cx={x(lastAt)} cy={y(last)} r="2.5" className="fill-label" /> : null}
    </svg>
  );
}
