"use client";

import { useState } from "react";
import { formatTime, minutesPhrase } from "@/lib/format";
import type { TravelPlan } from "@/lib/travel";
import { Fold } from "./fold";

/** One departure as a bar: the empty road solid, the traffic on top hatched (time lost). Shared with the suggestions list. */
export function DriveBar({
  at,
  minutes,
  traffic,
  scale,
}: {
  at: string;
  minutes: number;
  traffic: number;
  scale: number;
}) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_52px] items-center gap-3">
      <span className="text-subhead font-semibold tnum">{formatTime(at)}</span>
      <span
        role="img"
        aria-label={`Leave ${formatTime(at)}: ${minutes} minutes, ${traffic} of them in traffic`}
        className="flex h-3 overflow-hidden rounded-full"
        style={{ width: `${(minutes / scale) * 100}%` }}
      >
        <span className="h-full bg-label" style={{ flexGrow: minutes - traffic, flexBasis: 0 }} />
        {traffic > 0 ? (
          <span
            className="hatch h-full bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]"
            style={{ flexGrow: traffic, flexBasis: 0 }}
          />
        ) : null}
      </span>
      <span className="text-right text-subhead text-label-2 tnum">{minutes}&nbsp;min</span>
    </div>
  );
}

/**
 * Michael's traffic plan for the day (#157): the maths before and after, one tap to move the block,
 * undo until the old departure. Local state until the plan comes as a recommendation (#155).
 * A quiet row under "More from Michael" (#208), so its button is tinted, not the screen's filled one.
 */
export function TravelCard({ plan }: { plan: TravelPlan }) {
  const [moved, setMoved] = useState(false);
  const scale = Math.max(plan.before.minutes, plan.after.minutes);

  return (
    <Fold
      wideOpen
      title="Traffic plan"
      label="Traffic plan"
      preview={`Traffic adds ${minutesPhrase(plan.before.trafficMinutes)} to the drive to your ${plan.block}. Leave at ${formatTime(plan.after.departAt)}.`}
    >
      <p className="text-body text-label-2">
        Traffic adds <b className="font-semibold text-label">{minutesPhrase(plan.before.trafficMinutes)}</b>{" "}
        to the drive to your {plan.block}.
      </p>
      <div className="flex flex-col gap-2">
        <DriveBar
          at={plan.before.departAt}
          minutes={plan.before.minutes}
          traffic={plan.before.trafficMinutes}
          scale={scale}
        />
        <DriveBar
          at={plan.after.departAt}
          minutes={plan.after.minutes}
          traffic={plan.after.trafficMinutes}
          scale={scale}
        />
      </div>
      <p className="text-subhead tnum">
        Leave at {formatTime(plan.after.departAt)} and the {plan.block} starts at{" "}
        {formatTime(plan.after.blockStart)}.{" "}
        <b className="font-semibold">{minutesPhrase(plan.wonMinutes)} won.</b>
      </p>
      {plan.parking?.hard ? (
        <p className="text-subhead">
          Parking is hard there. Use the car park {plan.parking.walkMinutes} minutes away?{" "}
          <a
            href={plan.parking.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-tint-text underline-offset-2 hover:underline"
          >
            Directions
          </a>
        </p>
      ) : null}
      {moved ? (
        <div className="flex flex-wrap items-center gap-x-2" role="status">
          <p className="text-subhead text-label-2 tnum">
            Moved to {formatTime(plan.after.blockStart)}. Undo until {formatTime(plan.undoUntil)}.
          </p>
          <button
            type="button"
            onClick={() => setMoved(false)}
            className="press min-h-9 px-1 text-subhead font-semibold text-tint-text"
          >
            Undo
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setMoved(true)}
            className="press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text tnum"
          >
            Move the {plan.block} to {formatTime(plan.after.blockStart)}
          </button>
        </div>
      )}
    </Fold>
  );
}
