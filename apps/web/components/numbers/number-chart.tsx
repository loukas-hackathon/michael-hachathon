"use client";

import { useId, useState } from "react";
import type { Series } from "@/lib/insights";

const W = 320;
const H = 150;
const PAD = 6;

type Range = "2w" | "12w";
const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "2w", label: "2 weeks", days: 14 },
  { id: "12w", label: "12 weeks", days: 84 },
];

const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));

/**
 * One number over 2 or 12 weeks. Two weeks draws every reading as a dot on the line; twelve weeks
 * draws the daily readings faint and the 7 day mean in black, so the trend reads over the noise.
 * The dashed line is the user's usual. Press or hover anywhere to read a day.
 */
export function NumberChart({
  daily,
  weekly,
  usual,
  unit,
}: {
  daily: Series;
  weekly: Series;
  usual: number;
  unit: string;
}) {
  const [range, setRange] = useState<Range>("2w");
  const [at, setAt] = useState<number | null>(null);
  const id = useId();
  const days = RANGES.find((r) => r.id === range)?.days ?? 14;
  const pts = daily.points.slice(-days);
  const avg = weekly.points.slice(-days);
  const values = pts.map((p) => p.value).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const lo = Math.min(usual, ...values);
  const hi = Math.max(usual, ...values);
  const n = Math.max(1, pts.length - 1);
  const x = (i: number) => (i / n) * W;
  const y = (v: number) => H - PAD - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * PAD);
  const line = (ps: { value: number | null }[]) => {
    const runs: string[] = [];
    let run: string[] = [];
    ps.forEach((p, i) => {
      if (p.value == null) {
        if (run.length) runs.push(run.join(" "));
        run = [];
        return;
      }
      run.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    });
    if (run.length) runs.push(run.join(" "));
    return runs;
  };
  const wide = range === "12w";
  const picked = at == null ? null : pts[at];
  const pickedAvg = at == null ? null : avg[at]?.value;

  function pick(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * n);
    setAt(Math.min(n, Math.max(0, i)));
  }

  return (
    <div>
      <div role="tablist" aria-label="Range" className="inline-flex rounded-[9px] bg-fill p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={range === r.id}
            aria-controls={id}
            onClick={() => {
              setRange(r.id);
              setAt(null);
            }}
            className={`min-h-8 rounded-[7px] px-3.5 text-footnote font-semibold ${range === r.id ? "bg-bg shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "text-label-2"}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <p className="mt-3 h-5 text-footnote text-label-2 tnum" aria-live="polite">
        {picked ? (
          <>
            {shortDay(picked.day)}:{" "}
            <b className="font-semibold text-label">
              {picked.value == null ? "no reading" : `${picked.value}${unit}`}
            </b>
            {wide && pickedAvg != null ? `, 7 day average ${Math.round(pickedAvg)}${unit}` : ""}
          </>
        ) : (
          <>
            Dashed: your usual, {usual}
            {unit}.
          </>
        )}
      </p>

      <div
        id={id}
        className="relative mt-1 touch-pan-y select-none"
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setAt(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-[150px] w-full overflow-visible"
          role="img"
          aria-label={`${daily.label} over ${wide ? "12 weeks" : "2 weeks"}: lowest ${Math.min(...values)}${unit}, highest ${Math.max(...values)}${unit}, usual ${usual}${unit}.`}
        >
          {[lo, hi].map((v) => (
            <line
              key={v}
              x1={0}
              x2={W}
              y1={y(v)}
              y2={y(v)}
              className="stroke-separator"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={0}
            x2={W}
            y1={y(usual)}
            y2={y(usual)}
            className="stroke-label-2"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
          {line(pts).map((p) => (
            <polyline
              key={`d${p.slice(0, 20)}`}
              points={p}
              fill="none"
              className={wide ? "stroke-label-2" : "stroke-label"}
              strokeWidth={wide ? 1 : 2}
              opacity={wide ? 0.45 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {wide
            ? line(avg).map((p) => (
                <polyline
                  key={`w${p.slice(0, 20)}`}
                  points={p}
                  fill="none"
                  className="stroke-label"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))
            : null}
          {at != null ? (
            <line
              x1={x(at)}
              x2={x(at)}
              y1={0}
              y2={H}
              className="stroke-label"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        {/* Dots as HTML so they stay round on a stretched chart. */}
        {!wide
          ? pts.map((p, i) =>
              p.value == null ? null : (
                <span
                  key={p.day}
                  aria-hidden="true"
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-label ${i === at ? "size-3" : "size-2"}`}
                  style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.value) / H) * 100}%` }}
                />
              ),
            )
          : null}
        <span className="pointer-events-none absolute -top-1 right-0 -translate-y-full text-caption text-label-2 tnum">
          {hi}
          {unit}
        </span>
        <span className="pointer-events-none absolute right-0 bottom-0 translate-y-full text-caption text-label-2 tnum">
          {lo}
          {unit}
        </span>
      </div>
      <div className="mt-5 flex justify-between text-caption text-label-2 tnum">
        <span>{pts[0] ? shortDay(pts[0].day) : ""}</span>
        <span>{pts[pts.length - 1] ? shortDay(pts[pts.length - 1]?.day ?? "") : ""}</span>
      </div>
    </div>
  );
}
