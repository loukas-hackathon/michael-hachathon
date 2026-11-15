import Link from "next/link";
import { getWeekReview } from "@/lib/api";

/**
 * Your week on Today's Sunday evening (#376): one row that leads with Michael's lesson and opens the
 * review. Renders nothing if the review cannot load: the fold row under More from Michael stays.
 */
export async function WeekCard() {
  const review = await getWeekReview().catch((err) => {
    console.error("week card:", err);
    return null;
  });
  if (!review || (review.score.pct === null && review.goals.length === 0)) return null;
  return (
    <Link
      href="/week"
      aria-label="Your week: the review"
      className="press mt-6 flex items-center gap-3 rounded-group bg-fill px-4 py-3.5"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-footnote font-semibold text-label-2">Your week</span>
        {/* The week's score is already on Today: the lesson leads here, the review holds the rest. */}
        <span className="text-body font-semibold">{review.lesson}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-label-2">
        ›
      </span>
    </Link>
  );
}
