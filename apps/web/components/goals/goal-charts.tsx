import { hm } from "@/lib/format";
import type { CloseState } from "@/lib/goals-view";

const NOTCH_MINUTES = 30;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The weekly budget as tape (docs/design-guide.md): one notch per 30 minutes, filled pink as time is
 * spent, outlined while still ahead. The black tick is where the goal should be by now.
 */
export function NotchTrack({
  budget,
  spent,
  unverified = 0,
  planned,
  pace,
  label,
  close = "open",
}: {
  /** Near the end the next notch breathes; closed, the tape goes solid and a check lands. */
  close?: CloseState;
  budget: number;
  spent: number;
  unverified?: number;
  /** Minutes planned in blocks: those notches are dashed until filled. */
  planned?: number;
  pace: number;
  label: string;
}) {
  const n = Math.max(1, Math.round(budget / NOTCH_MINUTES));
  const filled = spent / NOTCH_MINUTES;
  const firm = (spent - unverified) / NOTCH_MINUTES;
  const plannedN = (planned ?? 0) / NOTCH_MINUTES;
  const notches = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    fill: Math.max(0, Math.min(1, filled - i)),
    firm: Math.max(0, Math.min(1, firm - i)),
    dashed: i < Math.round(plannedN),
  }));
  // The first notch not yet full: the one that pulls you on.
  const next = close === "near" || close === "last" ? notches.findIndex((x) => x.fill < 1) : -1;
  if (close === "closed") {
    return (
      <div role="img" aria-label={label} className="relative flex items-center gap-2 pt-1.5">
        <div className="m-track-closed h-3 flex-1 rounded-[3px] bg-spark" />
        <svg viewBox="0 0 20 20" aria-hidden="true" className="m-check-pop -my-1 size-5 shrink-0">
          <circle cx="10" cy="10" r="10" fill="var(--m-spark)" />
          <path
            d="M6 10.4l2.6 2.6L14 7.6"
            fill="none"
            stroke="var(--m-bg)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }
  return (
    <div role="img" aria-label={label} className="relative pt-1.5">
      <div className="flex h-3 gap-[2px]">
        {notches.map(({ id, fill, firm, dashed }, i) => (
          <span
            key={id}
            className={`relative min-w-0 flex-1 overflow-hidden rounded-[3px] ${i === next ? "m-notch-next " : ""}${
              dashed
                ? n <= 18
                  ? "border border-dashed border-label-2"
                  : "shadow-[inset_0_0_0_1px_var(--m-label-2)]"
                : "shadow-[inset_0_0_0_1px_var(--m-context)]"
            }`}
          >
            {fill > 0 ? (
              <span
                className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--m-spark)_38%,var(--m-bg))]"
                style={{ width: `${fill * 100}%` }}
              />
            ) : null}
            {firm > 0 ? (
              <span className="absolute inset-y-0 left-0 bg-spark" style={{ width: `${firm * 100}%` }} />
            ) : null}
          </span>
        ))}
      </div>
      <span
        className="absolute top-0 h-[18px] w-[2px] -translate-x-1/2 rounded-full bg-label"
        style={{ left: `${pace * 100}%` }}
      />
    </div>
  );
}

/** Seven thin day columns: today pink, past days grey, days to come as small outlines. */
export function DayColumns({ daily, today, cap }: { daily: (number | null)[]; today: number; cap: number }) {
  return (
    <div
      role="img"
      aria-label={daily
        .map((m, i) => (m == null ? null : `${DAYS[i]} ${hm(m)}`))
        .filter(Boolean)
        .join(", ")}
      className="flex h-[22px] w-[70px] shrink-0 items-end gap-1"
    >
      {daily.map((m, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: days are positional
          key={i}
          className={`w-1.5 rounded-[2px] ${
            m == null
              ? "h-[3px] shadow-[inset_0_0_0_1px_var(--m-context)]"
              : i === today
                ? "bg-spark"
                : "bg-context"
          }`}
          style={m == null ? undefined : { height: `${Math.max(2, (Math.min(m, cap) / cap) * 22)}px` }}
        />
      ))}
    </div>
  );
}

/** Goal conflict, the maths shown: what each goal still needs, against the free time left. */
export function SplitBar({
  parts,
  freeMinutes,
}: {
  parts: { title: string; minutes: number }[];
  freeMinutes: number;
}) {
  const total = parts.reduce((n, p) => n + p.minutes, 0);
  const shades = [
    "bg-label",
    "bg-label-2",
    "bg-[color-mix(in_srgb,var(--m-label-2)_55%,var(--m-bg))]",
    "bg-context",
  ];
  const freeAt = Math.min(1, freeMinutes / total);
  return (
    <div>
      <div className="relative pt-4 pb-5">
        <div className="flex h-2.5 gap-[3px]">
          {parts.map((p, i) => (
            <span
              key={p.title}
              className={`rounded-full ${shades[i % shades.length]}`}
              style={{ flexGrow: p.minutes, flexBasis: 0 }}
            />
          ))}
        </div>
        <span
          className="absolute top-2.5 h-[22px] w-[2px] -translate-x-1/2 rounded-full bg-spark"
          style={{ left: `${freeAt * 100}%` }}
        />
        <span
          className="absolute bottom-0 -translate-x-full pr-1 text-caption font-semibold whitespace-nowrap text-tint-text tnum"
          style={{ left: `${freeAt * 100}%` }}
        >
          {hm(freeMinutes)} free
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-footnote text-label-2 tnum">
        {parts.map((p, i) => (
          <li key={p.title} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${shades[i % shades.length]}`} />
            {p.title} {hm(p.minutes)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Nights of sleep against the goal line (dashed). */
export function SleepBars({ nightly, goal }: { nightly: (number | null)[]; goal: number }) {
  const max = Math.max(goal * 1.15, ...nightly.map((n) => n ?? 0));
  return (
    <div
      role="img"
      aria-label="Sleep per night this week"
      className="relative flex h-[34px] w-[150px] shrink-0 items-end gap-2"
    >
      {nightly.map((m, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: nights are positional
          key={i}
          className={`flex-1 rounded-[3px] ${m == null ? "h-[3px] shadow-[inset_0_0_0_1px_var(--m-context)]" : "bg-context"}`}
          style={m == null ? undefined : { height: `${(m / max) * 34}px` }}
        />
      ))}
      <span
        className="absolute inset-x-0 border-t border-dashed border-label"
        style={{ bottom: `${(goal / max) * 34}px` }}
      />
    </div>
  );
}
