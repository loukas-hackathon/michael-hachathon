import type { Tick } from "@/lib/day";

/**
 * The tape: Michael's signature (docs/design-guide.md). One tick per 5 minutes of planned goal time.
 * Spent is pink, lost is grey and dropped, still ahead is an outline. Blocks are separated by a wider gap.
 * Drawn in HTML so ticks stay crisp at any width.
 */
export function Tape({
  ticks,
  nowAt,
  nowLabel,
  height = 30,
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
  let index = 0;
  const showNow = nowAt != null && nowLabel;
  const total = ticks.reduce((n, b) => n + b.length, 0);
  // Early in the day the time label sits right of the line, so it never leaves the screen.
  const labelRight = showNow && total > 0 && (nowAt ?? 0) / total < 0.25;
  return (
    <div
      role="img"
      aria-label={label}
      className="relative w-full"
      style={{ paddingTop: showNow || recordAt != null ? 16 : 0 }}
    >
      <div className="flex w-full gap-[5px]" style={{ height }}>
        {ticks.map((block, bi) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional within a day
            key={bi}
            className="flex min-w-0 gap-[1.5px]"
            style={{ flexGrow: block.length, flexBasis: 0 }}
          >
            {block.map((t) => {
              const i = index++;
              const isNow = showNow && i === nowAt;
              return (
                // data-live-key: a tick that changes state (ahead to spent) eases in after a live refresh.
                <span key={i} data-live-key={`t${i}${t}`} className="m-tick relative min-w-0 flex-1">
                  {i === recordAt ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-[13px] left-1/2 size-[7px] -translate-x-1/2 rotate-45 rounded-[1px] bg-label"
                    />
                  ) : null}
                  {isNow ? (
                    <span className="absolute -top-4 -left-[2px] h-[calc(100%+16px)] w-[1.5px] bg-label">
                      <span
                        className={`absolute -top-[2px] whitespace-nowrap text-caption font-semibold text-label tnum ${
                          labelRight ? "left-[5px]" : "right-[5px]"
                        }`}
                      >
                        {nowLabel}
                      </span>
                    </span>
                  ) : null}
                  {t === "spent" ? (
                    <span className="absolute inset-0 rounded-[1.5px] bg-spark" />
                  ) : t === "unverified" ? (
                    <span className="absolute inset-0 rounded-[1.5px] bg-[color-mix(in_srgb,var(--m-spark)_38%,var(--m-bg))]" />
                  ) : t === "lost" ? (
                    <span className="absolute inset-x-0 bottom-0 h-[45%] rounded-[1.5px] bg-label-2 opacity-75" />
                  ) : (
                    <span className="absolute inset-0 rounded-[1.5px] shadow-[inset_0_0_0_1px_var(--m-label-2)]" />
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The small key under the tape. */
export function TapeKey({ items }: { items: { kind: Tick; text: string }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-footnote text-label-2 tnum">
      {items.map(({ kind, text }) => (
        <li key={kind} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={
              kind === "spent"
                ? "h-3 w-1 rounded-[1px] bg-spark"
                : kind === "unverified"
                  ? "h-3 w-1 rounded-[1px] bg-[color-mix(in_srgb,var(--m-spark)_38%,var(--m-bg))]"
                  : kind === "lost"
                    ? "mt-1.5 h-1.5 w-1 rounded-[1px] bg-label-2 opacity-75"
                    : "h-3 w-1 rounded-[1px] shadow-[inset_0_0_0_1px_var(--m-label-2)]"
            }
          />
          {text}
        </li>
      ))}
    </ul>
  );
}
