"use client";

import type { WeekReviewMove } from "@michael/shared";
import Link from "next/link";
import { useState } from "react";
import { BookTime } from "@/components/goals/book-time";

/**
 * Next week's first move on Your week (#376), with the screen's one action. It keeps the move it
 * was first shown: once Plan next week has booked the block, a refreshed review reads the move as
 * "booked", and swapping the card then would take the booked line and its Undo away.
 */
export function NextMove({ move: fresh }: { move: WeekReviewMove | null }) {
  const [move] = useState(fresh);
  return (
    <>
      {move ? (
        <div className="mt-3 rounded-group bg-fill px-4 py-3">
          <p className="text-subhead font-semibold">
            {move.status === "booked" ? "First block: " : ""}
            {move.title}.
          </p>
          <p className="mt-0.5 text-footnote text-label-2 tnum">{move.rationale}</p>
          {move.status === "book" ? (
            <div className="mt-3">
              <BookTime
                goalId={move.goal_id}
                minutes={move.minutes}
                nextWeek
                primary
                label="Plan next week"
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {!move || move.status === "booked" ? (
        <Link
          href="/goals"
          className="press mt-4 inline-flex min-h-11 items-center rounded-full bg-tint px-5 text-body font-semibold text-on-tint"
        >
          Plan next week
        </Link>
      ) : null}
    </>
  );
}
