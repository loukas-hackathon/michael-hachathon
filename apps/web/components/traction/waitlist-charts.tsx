"use client";

import type { TractionWaitingList } from "@michael/shared";
import { useState } from "react";
import { Segmented } from "@/components/form-controls";
import { ProgressBar } from "@/components/progress-bar";

/** "16 Nov" for a local day (lib/traction.ts says the same; kept here so no zod reaches the client). */
const dayLabel = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );

/** "Sunday" for a local day. */
const weekdayOf = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

// The waiting list's charts on /traction, hand written SVG and boxes (docs/design-guide.md, "Data
// views"): a sentence first, then the chart that proves it. No pink (pink is goal time and there
// is none here), no legends (direct labels), at most three faint gridlines, bars from zero with
// their data end rounded 2px. Charts in one row share a height: 160px on a phone, 200px on a laptop.

const CHART_H = "h-40 lg:h-[200px]";
const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "all", label: "All" },
] as const;
type Range = (typeof RANGES)[number]["value"];

const fmt = (n: number) => n.toLocaleString("en-GB");

/** Growth and momentum, with the range control above them (default 30 days). */
export function WaitlistTrend({ w }: { w: TractionWaitingList }) {
  const [range, setRange] = useState<Range>("30");
  const days = w.by_day;
  // The running total over every day, so a short range starts from the people already waiting.
  let run = 0;
  const cumulative = days.map((d) => {
    run += d.sign_ups;
    return { day: d.day, value: run };
  });
  const take = range === "all" ? days.length : Number(range);
  const shown = days.slice(-take);
  const line = cumulative.slice(-take);
  const inRange = shown.reduce((s, d) => s + d.sign_ups, 0);
  const best = shown.reduce<{ day: string; sign_ups: number } | null>(
    (b, d) => (d.sign_ups > 0 && (!b || d.sign_ups >= b.sign_ups) ? d : b),
    null,
  );
  const span = range === "all" ? "since the start" : `in the last ${range} days`;

  return (
    <section aria-labelledby="trend" className="mt-8 lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="trend" className="text-title3 font-bold">
          Growth
        </h2>
        <div className="w-[240px]">
          <Segmented name="range" options={RANGES.map((r) => ({ ...r }))} value={range} onChange={setRange} />
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-6">
        <figure>
          <figcaption className="mb-3 text-subhead text-label-2">
            <span className="tnum font-semibold text-label">{fmt(w.total)}</span>
            {w.first_day ? ` since ${dayLabel(w.first_day)}.` : "."}
          </figcaption>
          <LineChart points={line} />
        </figure>
        <figure>
          <figcaption className="mb-3 text-subhead text-label-2" data-testid="traction-momentum">
            {inRange === 0 ? (
              `Nobody joined ${span}.`
            ) : (
              <>
                <span className="tnum font-semibold text-label">{fmt(inRange)}</span> {span}.
                {best ? (
                  <>
                    {" "}
                    Best day {weekdayOf(best.day)} {dayLabel(best.day)},{" "}
                    <span className="tnum font-semibold text-label">{best.sign_ups}</span>.
                  </>
                ) : null}
              </>
            )}
          </figcaption>
          {inRange > 0 ? <DailyBars days={shown} /> : null}
        </figure>
      </div>
    </section>
  );
}

/** Three faint gridlines at most, labelled on the right. */
function Grid({ max }: { max: number }) {
  const ticks = max >= 2 ? [max, Math.round(max / 2), 0] : [max, 0];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute inset-x-0 flex items-end justify-end border-t-[0.5px] border-separator"
          style={{ top: `${100 - (t / Math.max(1, max)) * 100}%` }}
        >
          <span className="-mt-[15px] bg-bg pl-1 text-caption font-medium text-label-2 tnum">{fmt(t)}</span>
        </span>
      ))}
    </div>
  );
}

/** The running total as one 2px line, its end dot labelled with the value. */
function LineChart({ points }: { points: { day: string; value: number }[] }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = points.length;
  const x = (i: number) => (n === 1 ? 100 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / max) * 100;
  const last = points[n - 1] as { day: string; value: number };
  const first = points[0] as { day: string; value: number };
  return (
    <div>
      <div className={`relative ${CHART_H}`}>
        <Grid max={max} />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-[calc(100%-28px)] overflow-visible"
          role="img"
          aria-label={`${fmt(first.value)} on ${dayLabel(first.day)}, ${fmt(last.value)} on ${dayLabel(last.day)}`}
        >
          <polyline
            points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
            fill="none"
            stroke="var(--m-label)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          aria-hidden="true"
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-label"
          style={{ left: "calc(100% - 28px)", top: `${y(last.value)}%` }}
        />
      </div>
      <AxisDays first={first.day} last={last.day} />
    </div>
  );
}

/** One thin bar a day; the last 7 days in the text colour, earlier days in the context grey. */
function DailyBars({ days }: { days: { day: string; sign_ups: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.sign_ups));
  const dense = days.length > 31;
  const peak = days.reduce((b, d, i) => (d.sign_ups > (days[b]?.sign_ups ?? -1) ? i : b), 0);
  return (
    <div>
      <div className={`relative ${CHART_H}`}>
        <Grid max={max} />
        <ol
          className={`absolute inset-y-0 left-0 right-[28px] flex items-end ${dense ? "gap-px" : "justify-between"}`}
          aria-label="Sign ups each day"
        >
          {days.map((d, i) => {
            const recent = i >= days.length - 7;
            return (
              <li
                key={d.day}
                className={`relative flex h-full items-end ${dense ? "min-w-0 flex-1" : "w-1.5"}`}
              >
                {i === peak && d.sign_ups > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 -translate-x-1/2 text-caption font-medium text-label tnum"
                    style={{ bottom: `calc(${(d.sign_ups / max) * 100}% + 4px)` }}
                  >
                    {d.sign_ups}
                  </span>
                ) : null}
                <span
                  aria-hidden="true"
                  className={`block w-full rounded-t-[2px] ${recent ? "bg-label" : "bg-context"}`}
                  style={{ height: d.sign_ups ? `max(2px, ${(d.sign_ups / max) * 100}%)` : 0 }}
                />
                <span className="sr-only">{`${dayLabel(d.day)}: ${d.sign_ups}`}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <AxisDays first={days[0]?.day} last={days.at(-1)?.day} />
    </div>
  );
}

function AxisDays({ first, last }: { first?: string; last?: string }) {
  if (!first || !last) return null;
  return (
    <div
      aria-hidden="true"
      className="mt-1.5 flex justify-between pr-[28px] text-caption font-medium text-label-2 tnum"
    >
      <span>{dayLabel(first)}</span>
      {last !== first ? <span>{dayLabel(last)}</span> : null}
    </div>
  );
}

const HOUR_LABEL = (up: number | null) => (up === null ? "10h+" : `${up}h`);

/** Their own hours, five buckets, drawn as lost time is everywhere in Michael: hatched grey. */
export function HoursChart({ w }: { w: TractionWaitingList }) {
  const max = Math.max(1, ...w.hours.map((h) => h.people));
  return (
    <ol className={`flex items-end gap-3 ${CHART_H}`} aria-label="Hours lost a week, as they said">
      {w.hours.map((h) => (
        <li key={h.up_to ?? "more"} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
          <span className="mb-1 text-caption font-medium text-label-2 tnum">
            {h.people > 0 ? h.people : ""}
          </span>
          <span
            aria-hidden="true"
            className="hatch block w-full max-w-12 rounded-t-[2px] bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]"
            style={{ height: h.people ? `max(2px, calc(${(h.people / max) * 100}% - 32px))` : 0 }}
          />
          <span className="mt-1.5 text-caption font-medium text-label-2 tnum">{HOUR_LABEL(h.up_to)}</span>
          <span className="sr-only">{`${HOUR_LABEL(h.up_to)}: ${h.people} people`}</span>
        </li>
      ))}
    </ol>
  );
}

const ROLE_NAMES: Record<string, string> = {
  founder: "Founders",
  executive: "Executives",
  employee: "Employees",
  student: "Students",
  other: "Other",
};

/** Who: one stacked bar (the one dynamic bar), the top two roles and the rest, labelled under it. */
export function RolesBar({ w }: { w: TractionWaitingList }) {
  if (w.total === 0) return null;
  const sorted = Object.entries(w.by_role)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 2);
  const rest = sorted.slice(2).reduce((s, [, n]) => s + n, 0);
  const parts = [
    ...top.map(([role, n], i) => ({
      name: ROLE_NAMES[role] ?? role,
      n,
      fill: i === 0 ? "bg-label" : "bg-label-2",
    })),
    ...(rest > 0 ? [{ name: "Everyone else", n: rest, fill: "bg-context" }] : []),
  ];
  const pct = (n: number) => Math.round((n / w.total) * 100);
  return (
    <div>
      <div
        className="flex h-2.5 gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label={parts.map((p) => `${p.name} ${pct(p.n)}%`).join(", ")}
      >
        {parts.map((p) => (
          <span key={p.name} className={`block h-full ${p.fill}`} style={{ flexGrow: p.n, flexBasis: 0 }} />
        ))}
      </div>
      <ul aria-hidden="true" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-footnote text-label-2">
        {parts.map((p) => (
          <li key={p.name} className="flex items-center gap-1.5">
            <span className={`block size-2 rounded-full ${p.fill}`} />
            {p.name} <span className="tnum font-semibold text-label">{pct(p.n)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Up to five sources, each a row with its share and a thin bar. */
export function SourcesList({ w }: { w: TractionWaitingList }) {
  const rows = w.by_source.slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((s) => {
        const share = w.total ? s.sign_ups / w.total : 0;
        return (
          <li key={s.source}>
            <div className="flex items-baseline justify-between gap-3 text-subhead">
              <span className="min-w-0 truncate">{s.source.charAt(0).toUpperCase() + s.source.slice(1)}</span>
              <span className="shrink-0 text-label-2 tnum">
                {Math.round(share * 100)}% · {fmt(s.sign_ups)}
              </span>
            </div>
            <ProgressBar
              value={share}
              size="sm"
              className="mt-1.5"
              label={`${s.source}: ${Math.round(share * 100)}% of sign ups`}
            />
          </li>
        );
      })}
    </ul>
  );
}
