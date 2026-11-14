import type { GoalBlock, Tick } from "@/lib/day";
import { formatTime } from "@/lib/format";

/**
 * The Today tape at projector scale: one tick per 5 minutes of planned goal time, grouped by block,
 * each block named underneath with its start time. Same marks as components/tape.tsx.
 */
export function StageTape({
  ticks,
  blocks,
  nowAt,
  nowLabel,
  label,
}: {
  ticks: Tick[][];
  blocks: GoalBlock[];
  nowAt: number | null;
  nowLabel: string;
  label: string;
}) {
  let index = 0;
  // A short day keeps ticks tape sized (at most 32px each) instead of stretching them into slabs.
  const total = ticks.reduce((n, b) => n + b.length, 0);
  const maxWidth = `calc(var(--u) * ${total * 32 + ticks.length * 14})`;
  return (
    <div role="img" aria-label={label} className="stage-tape" style={{ maxWidth }}>
      {ticks.map((block, bi) => {
        const b = blocks[bi];
        return (
          <div
            key={b?.id ?? bi}
            className="stage-tape-block"
            style={{ flexGrow: Math.max(block.length, 1), flexBasis: 0 }}
          >
            <div className="stage-tape-ticks">
              {block.map((t) => {
                const i = index++;
                return (
                  <span key={i} className="stage-tick" data-kind={t}>
                    {i === nowAt ? (
                      <span className="stage-now">
                        <span className="stage-now-pill tnum">{nowLabel}</span>
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
            {b ? (
              <p className="stage-tape-label">
                <span className="tnum">{formatTime(b.start)}</span> {b.title}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
