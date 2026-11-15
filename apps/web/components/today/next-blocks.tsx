import Link from "next/link";
import type { GoalBlock } from "@/lib/day";
import { formatTime, hm } from "@/lib/format";

// Today on a laptop (#285): under the tape, the goal blocks still to come, so the centre column
// says what the rest of the day holds. The block running now leads, marked Now. Each row opens the
// timeline, where the block can be moved or edited. Nothing when the day's blocks are all done.

const MAX = 5;

export function NextBlocks({
  blocks,
  now,
  demo,
  className = "",
}: {
  blocks: GoalBlock[];
  now: string;
  demo?: string;
  className?: string;
}) {
  const at = Date.parse(now);
  const ahead = blocks
    .filter((b) => Date.parse(b.movedEnd ?? b.end) > at)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (ahead.length === 0) return null;
  const shown = ahead.slice(0, MAX);
  const more = ahead.length - shown.length;
  const href = `/timeline${demo === "sample" ? "?demo=sample" : ""}`;
  return (
    <section aria-labelledby="next-blocks" className={className}>
      <h2 id="next-blocks" className="mb-2 text-title3 font-bold">
        Still ahead
      </h2>
      <ul className="overflow-hidden rounded-group bg-fill">
        {shown.map((b, i) => {
          const end = b.movedEnd ?? b.end;
          const running = Date.parse(b.start) <= at;
          const minutes = Math.round((Date.parse(end) - Math.max(at, Date.parse(b.start))) / 60_000);
          return (
            <li key={b.id} className="relative">
              {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
              <Link
                href={href}
                className="press flex min-h-14 items-center gap-3 px-4 py-2"
                aria-label={`${b.title}, ${formatTime(b.start)} to ${formatTime(end)}${running ? ", now" : ""}`}
              >
                <span className="w-12 shrink-0 text-subhead font-semibold tnum">
                  {formatTime(b.start)}
                  <span className="block text-footnote font-normal text-label-2">{formatTime(end)}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body">{b.title}</span>
                  <span className="text-footnote text-label-2 tnum">
                    {running ? (
                      <>
                        <b className="font-semibold text-label">Now</b>, {hm(minutes)} left
                      </>
                    ) : (
                      hm(minutes)
                    )}
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-label-2">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <p className="mt-2 px-4 text-footnote text-label-2">
          {more === 1 ? "One more block" : `${more} more blocks`} later today.
        </p>
      ) : null}
    </section>
  );
}
