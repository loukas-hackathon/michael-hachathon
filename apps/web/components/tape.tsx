import type { Tick } from "@/lib/day";
import { Tween } from "./motion-ui";

const RUN: Record<Tick, string> = {
  spent: "bg-spark",
  unverified: "bg-[color-mix(in_srgb,var(--m-spark)_38%,var(--m-bg))]",
  // Lost is hatched grey, outlined top and bottom so the bar's edge runs through it.
  lost: "hatch bg-bg shadow-[inset_0_1px_0_var(--m-label-2),inset_0_-1px_0_var(--m-label-2)]",
  ahead: "bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]",
};

/**
 * The tape: Michael's signature (docs/design-guide.md), drawn as ONE bar (.claude/skills/michael-ui).
 * Each 5 minute tick of planned goal time is a slice of it: spent pink, unconfirmed light pink, lost
 * hatched grey, still ahead the outlined bar itself. Runs of one state merge, so the bar reads as a
 * single strip, and each run's end slides on `transform` when a live refresh moves it.
 */
export function Tape({
  ticks,
  nowAt,
  nowLabel,
  height = 12,
  label,
  recordAt,
}: {
  ticks: Tick[][];
  nowAt?: number | null;
  nowLabel?: string;
  height?: number;
  label: string;
  /** Tick index of a personal best (#166): a black diamond above it. */
  recordAt?: number | null;
}) {
  const flat = ticks.flat();
  const total = flat.length;
  const showNow = nowAt != null && !!nowLabel && total > 0;
  // Early in the day the time label sits right of the line, so it never leaves the screen.
  const labelRight = showNow && (nowAt ?? 0) / total < 0.25;
  const runs: { kind: Tick; end: number }[] = [];
  flat.forEach((t, i) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === t) last.end = i + 1;
    else runs.push({ kind: t, end: i + 1 });
  });
  const pct = (i: number) => (total > 0 ? (i / total) * 100 : 0);
  return (
    <div
      role="img"
      aria-label={label}
      className="relative w-full"
      style={{ paddingTop: showNow || recordAt != null ? 18 : 0 }}
    >
      <div className={`relative isolate overflow-hidden rounded-full ${RUN.ahead}`} style={{ height }}>
        {/* Each run is a full width layer slid to its end; earlier runs sit on top of later ones. */}
        {runs.map((r, i) =>
          r.kind === "ahead" ? null : (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional within a day
              key={i}
              className={`m-bar-fill absolute inset-0 ${RUN[r.kind]}`}
              style={{ transform: `translateX(${pct(r.end) - 100}%)`, zIndex: runs.length - i }}
            />
          ),
        )}
      </div>
      {recordAt != null && total > 0 ? (
        <span
          aria-hidden="true"
          className="absolute top-1 size-[7px] -translate-x-1/2 rotate-45 rounded-[1px] bg-label"
          style={{ left: `${pct(recordAt + 0.5)}%` }}
        />
      ) : null}
      {showNow ? (
        <span
          aria-hidden="true"
          className="absolute top-0.5 -bottom-[3px] w-[1.5px] -translate-x-1/2 bg-label"
          style={{ left: `clamp(1px, ${pct(nowAt ?? 0)}%, calc(100% - 1px))` }}
        >
          <span
            className={`absolute -top-[3px] whitespace-nowrap text-caption font-semibold text-label tnum ${
              labelRight ? "left-[5px]" : "right-[5px]"
            }`}
          >
            {nowLabel}
          </span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * The small key under the tape: a swatch of the bar for each state. Given `minutes`, the figure
 * ("1h 20") moves to its new value on a live refresh instead of snapping, followed by `text`.
 */
export function TapeKey({ items }: { items: { kind: Tick; text: string; minutes?: number }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-footnote text-label-2 tnum">
      {items.map(({ kind, text, minutes }) => (
        <li key={kind} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-2 w-3.5 rounded-full ${RUN[kind]}`} />
          {minutes == null ? (
            text
          ) : (
            <span>
              <Tween value={minutes} format="hm" /> {text}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
