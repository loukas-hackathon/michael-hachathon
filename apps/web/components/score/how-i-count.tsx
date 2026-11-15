"use client";

import { type ReactNode, useState } from "react";
import { hm, minutesPhrase } from "@/lib/format";
import { LEARNING_DAYS, learningLine, type ScoreExplain, truerLine } from "@/lib/score-explain";
import { Sheet } from "../sheet";

// The headline score, explained in one tap (#206). The score card wraps its number in
// <HowICount>; while Michael is still learning it shows <ScoreLearning> in place of a week figure.

const SWATCH = {
  planned: "h-3 w-1 rounded-[1px] shadow-[inset_0_0_0_1px_var(--m-label-2)]",
  spent: "h-3 w-1 rounded-[1px] bg-spark",
  lost: "mt-1.5 h-1.5 w-1 rounded-[1px] bg-label-2 opacity-75",
  ahead: "h-3 w-1 rounded-[1px] shadow-[inset_0_0_0_1px_var(--m-label-2)] opacity-60",
} as const;

export const RULE = "Time counts when you're in a goal block and on work that belongs to that goal.";

/** Wraps the headline number: tap it for the sheet. Without an explanation it renders as it was. */
export function HowICount({
  explain,
  children,
  hint = true,
}: {
  explain: ScoreExplain | null | undefined;
  children: ReactNode;
  /** The quiet "How I count" line under the number, so the tap can be found. */
  hint?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!explain) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="press block w-full text-left"
      >
        {children}
        {hint ? (
          <span className="mt-1 inline-flex items-center gap-1 text-footnote font-semibold text-tint-text">
            How I count
            <svg aria-hidden="true" width="7" height="11" viewBox="0 0 7 11" className="mt-px">
              <path
                d="M1 1l4.5 4.5L1 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
        ) : null}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="How I count" closeLabel="Done">
        <HowICountBody explain={explain} />
      </Sheet>
    </>
  );
}

/** Three short segments, one per day of goal blocks Michael has seen. Black, never pink. */
function LearningProgress({ days }: { days: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Days learnt"
      aria-valuemin={0}
      aria-valuemax={LEARNING_DAYS}
      aria-valuenow={days}
      className="flex gap-1.5"
    >
      {Array.from({ length: LEARNING_DAYS }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed number of segments
          key={i}
          className={`h-1.5 flex-1 rounded-full ${i < days ? "bg-label" : "bg-context"}`}
        />
      ))}
    </div>
  );
}

/** The still learning card: what Michael needs, with progress. No percentage, no won back. */
export function ScoreLearning({ explain, className = "" }: { explain: ScoreExplain; className?: string }) {
  return (
    <section
      aria-label="Still learning"
      className={`flex flex-col gap-2.5 rounded-card bg-fill px-4 pt-3.5 pb-4 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-body font-semibold">I'm still learning your week.</p>
        <p className="shrink-0 text-footnote text-label-2 tnum">
          {explain.daysLearnt} of {LEARNING_DAYS} days
        </p>
      </div>
      <LearningProgress days={explain.daysLearnt} />
      <p className="text-subhead text-label-2">{learningLine(explain)}</p>
    </section>
  );
}

function Row({
  swatch,
  label,
  value,
  note,
  first,
}: {
  swatch: keyof typeof SWATCH;
  label: string;
  value: string;
  note?: ReactNode;
  first?: boolean;
}) {
  return (
    <li className="relative px-4 py-2.5">
      {first ? null : <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" />}
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2.5 text-body">
          <span aria-hidden="true" className={`shrink-0 ${SWATCH[swatch]}`} />
          {label}
        </span>
        <span className="shrink-0 text-body font-semibold tnum">{value}</span>
      </div>
      {note ? <p className="mt-0.5 pl-[14px] text-footnote text-label-2 tnum">{note}</p> : null}
    </li>
  );
}

function causesNote(causes: ScoreExplain["causes"]): string | null {
  const [a, b] = causes;
  if (!a) return null;
  if (!b) return `Mostly ${a.what} (${hm(a.minutes)}).`;
  return `Mostly ${a.what} (${hm(a.minutes)}) and ${b.what} (${hm(b.minutes)}).`;
}

export function HowICountBody({ explain: e }: { explain: ScoreExplain }) {
  const truer = truerLine(e);
  const confirmed = e.spent - e.unverified;
  return (
    <div className="flex flex-col gap-5 pb-2">
      {e.learning ? (
        <ScoreLearning explain={e} />
      ) : (
        <div>
          <p className="text-footnote font-semibold text-label-2">This week</p>
          <p className="mt-0.5 text-insight font-bold tnum">
            {e.scorePct === null ? "Nothing to count yet." : `${e.scorePct}% of your goal time.`}
          </p>
          {e.scorePct !== null ? (
            <p className="mt-1 text-subhead text-label-2 tnum">
              <b className="font-semibold text-label">{hm(e.spent)}</b> spent of{" "}
              <b className="font-semibold text-label">{hm(e.elapsed)}</b> gone by, so far.
            </p>
          ) : null}
        </div>
      )}

      {e.planned > 0 ? (
        <ul aria-label="This week in minutes" className="overflow-hidden rounded-group bg-fill">
          <Row first swatch="planned" label="Planned in goal blocks" value={hm(e.planned)} />
          <Row
            swatch="spent"
            label="Spent inside them"
            value={hm(e.spent)}
            note={
              e.unverified > 0
                ? `${hm(confirmed)} confirmed by data, ${hm(e.unverified)} not yet.`
                : e.spent > 0
                  ? "All of it confirmed by data."
                  : undefined
            }
          />
          <Row swatch="lost" label="Lost" value={hm(e.lost)} note={causesNote(e.causes) ?? undefined} />
          <Row swatch="ahead" label="Still ahead" value={hm(e.ahead)} />
        </ul>
      ) : null}

      <p className="text-subhead">{RULE}</p>

      <div>
        <h3 className="text-body font-semibold">Time won back</h3>
        <p className="mt-0.5 text-subhead text-label-2 tnum">
          {e.learning || e.usualLossRate === null ? (
            "I count it once I know your usual day: less time lost in your blocks than usual."
          ) : e.wonBack > 0 ? (
            <>
              <b className="font-semibold text-label">{minutesPhrase(e.wonBack)}</b> this week. On a usual day
              you lose {Math.round(e.usualLossRate * 100)}% of a goal block; this week you lost less.
            </>
          ) : (
            <>
              None yet this week. On a usual day you lose {Math.round(e.usualLossRate * 100)}% of a goal
              block; beat that and it counts here.
            </>
          )}
        </p>
      </div>

      {truer ? <p className="text-subhead font-semibold">{truer}</p> : null}
      {e.sample ? <p className="text-footnote text-label-2">Sample week.</p> : null}
    </div>
  );
}
