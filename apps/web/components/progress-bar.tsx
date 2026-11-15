import type { ReactNode } from "react";

/**
 * The one bar (.claude/skills/michael-ui): a single continuous track that fills, never a row of
 * blocks. Rounded ends, a fill that slides on `transform` when the value changes (so a refresh or the
 * user's own Done moves it smoothly), an optional black target tick, an optional outline for what is
 * booked but not done yet. The number belongs in the label beside it, in `tnum`.
 *
 * Pink (`tone="spark"`) only when the fill is goal time; everything else is `label`.
 */
export function ProgressBar({
  value,
  soft,
  planned,
  target,
  tone = "label",
  size = "md",
  label,
  valueText,
  closed,
  className = "",
}: {
  /** Done, 0 to 1. */
  value: number;
  /** A lighter fill behind the main one (unconfirmed time), 0 to 1, at least `value`. */
  soft?: number;
  /** Booked but not done yet, drawn as an outline from the start, 0 to 1. */
  planned?: number;
  /** Where it should be by now (pace) or the line to clear, 0 to 1: a black tick. */
  target?: number | null;
  tone?: "spark" | "label";
  /** `sm` 4px for step counts, `md` 10px for goal and meter rows. */
  size?: "sm" | "md";
  /** Read out instead of the bar: "1h 20 of 6h, behind pace". */
  label: string;
  /** Overrides the percentage screen readers hear. */
  valueText?: string;
  /** The week is closed: fills once from the left. */
  closed?: boolean;
  className?: string;
}) {
  const v = clamp(value);
  const fill = tone === "spark" ? "bg-spark" : "bg-label";
  const softFill =
    tone === "spark"
      ? "bg-[color-mix(in_srgb,var(--m-spark)_38%,var(--m-bg))]"
      : "bg-[color-mix(in_srgb,var(--m-label)_35%,var(--m-bg))]";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={valueText}
      className={`relative ${size === "sm" ? "h-1" : "h-2.5"} ${className}`}
    >
      <div className="absolute inset-0 overflow-hidden rounded-full bg-context">
        {planned ? (
          <Fill at={clamp(planned)} className="bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]" />
        ) : null}
        {soft != null && soft > v ? <Fill at={clamp(soft)} className={softFill} /> : null}
        <Fill at={v} className={`${fill}${closed ? " m-track-closed" : ""}`} />
      </div>
      {target != null ? <Tick at={clamp(target)} size={size} /> : null}
    </div>
  );
}

/** A full width rounded fill slid left, so its right end stays round and only `transform` moves. */
function Fill({ at, className }: { at: number; className: string }) {
  return (
    <span
      className={`m-bar-fill absolute inset-0 rounded-full ${className}`}
      style={{ transform: `translateX(${(at - 1) * 100}%)` }}
    />
  );
}

function Tick({ at, size }: { at: number; size: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute left-0 w-[2px] -translate-x-1/2 rounded-full bg-label ${
        size === "sm" ? "-top-1 h-3" : "-top-1 h-[18px]"
      }`}
      // Kept inside the ends so it never sits on the rounded cap.
      style={{ left: `clamp(1px, ${at * 100}%, calc(100% - 1px))` }}
    />
  );
}

/** A label row above a bar: title left, tabular number right. */
export function BarLabel({ title, value }: { title: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-subhead">
      <span className="min-w-0 truncate font-semibold">{title}</span>
      <span className="shrink-0 text-label-2 tnum">{value}</span>
    </div>
  );
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
