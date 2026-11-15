import type { WeekReview, WeekReviewGoal } from "@michael/shared";
import Link from "next/link";
import { BarLabel, ProgressBar } from "@/components/progress-bar";
import { NextMove } from "@/components/week/next-move";
import { getWeekReview } from "@/lib/api";
import { isLocalDay } from "@/lib/athens";
import { hm, spokenDuration } from "@/lib/format";
import { weekdayName, weekRange } from "@/lib/week";

// Your week (#376): the Sunday evening review, on demand any time. One calm screen read top to
// bottom: how the week went (the score and its maths, time won back), Michael's one lesson, each
// goal kept or behind, what stood out (records, the thief), what the user did themselves, and next
// week with its one action. Every number comes from GET /v1/week/review.

export const metadata = { title: "Your week" };

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const review = await getWeekReview(isLocalDay(week) ? week : undefined).catch((err) => {
    console.error("week review:", err);
    return null;
  });
  return (
    <main className="screen pb-12">
      <header className="flex min-h-11 items-center justify-between pt-2">
        <Link href="/" className="press -ml-2 flex h-11 items-center gap-1 px-2 text-body text-tint-text">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Today
        </Link>
        {review ? (
          <p className="text-footnote font-semibold text-label-2 tnum">
            {weekRange(review.week_start, review.week_end)}
          </p>
        ) : null}
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">Your week</h1>
      {review ? (
        <Review review={review} />
      ) : (
        <p className="mt-4 text-body">I couldn't read your week just now. Pull to refresh in a minute.</p>
      )}
    </main>
  );
}

function Review({ review: r }: { review: WeekReview }) {
  const s = r.score;
  if (s.pct === null && r.goals.length === 0) {
    return (
      <div className="mt-4 flex flex-col items-start gap-3">
        <p className="text-body">
          Nothing to review yet. Give a goal a weekly budget and book its first block.
        </p>
        <Link
          href="/goals"
          className="press inline-flex min-h-11 items-center rounded-full bg-tint px-5 text-body font-semibold text-on-tint"
        >
          Open Goals
        </Link>
      </div>
    );
  }
  const thiefInLesson = r.thief ? r.lesson.includes(r.thief.what) : false;
  const blockRecord = r.records.find((x) => x.type === "longest_block");
  return (
    <>
      <section aria-label="The week's score" className="mt-3">
        {s.pct === null ? (
          <p className="text-title3 font-semibold">No goal time has passed this week yet.</p>
        ) : (
          <h2 className="flex flex-col">
            <span className="font-num text-score font-extrabold tracking-[-0.02em] tnum [font-size:min(var(--text-score),24vw)]">
              {s.pct}%
            </span>
            <span className="text-title3 font-semibold">
              of your goal time{r.complete ? "" : " this week"}.
            </span>
          </h2>
        )}
        {s.pct !== null ? (
          <p className="mt-2 text-subhead text-label-2 tnum">
            <b className="font-semibold text-label">{hm(s.spent_minutes)}</b> held of{" "}
            <b className="font-semibold text-label">{hm(s.elapsed_minutes)}</b> planned
            {r.complete ? "" : " so far"}, <b className="font-semibold text-label">{hm(s.lost_minutes)}</b>{" "}
            lost.
            {s.usual_pct !== null ? ` Your usual week is ${s.usual_pct}%.` : ""}
            {s.target_pct !== null ? ` Target ${s.target_pct}%, ${s.on_target ? "met" : "missed"}.` : ""}
          </p>
        ) : null}
        {r.won_back_minutes > 0 ? (
          <p className="mt-2 text-body">
            <b className="font-num font-bold text-tint-text tnum">{hm(r.won_back_minutes)}</b> won back
            against your usual loss rate.
          </p>
        ) : null}
      </section>

      <p className="mt-6 rounded-card bg-fill px-4 py-3.5 text-body font-semibold">{r.lesson}</p>

      {r.goals.length > 0 ? (
        <section aria-labelledby="week-goals" className="mt-8">
          <h2 id="week-goals" className="mb-3 text-title3 font-bold">
            Goals
          </h2>
          <ul className="flex flex-col gap-4">
            {r.goals.map((g) => (
              <GoalRow key={g.goal_id} goal={g} complete={r.complete} />
            ))}
          </ul>
        </section>
      ) : null}

      {r.records.length > 0 || r.best_block || (r.thief && !thiefInLesson) ? (
        <section aria-labelledby="week-stood-out" className="mt-8">
          <h2 id="week-stood-out" className="mb-2 text-title3 font-bold">
            What stood out
          </h2>
          <ul className="flex flex-col gap-2 text-subhead">
            {r.records.map((x) =>
              x.line ? (
                <li key={x.id} className="flex items-baseline gap-2">
                  <span aria-hidden="true" className="size-[7px] shrink-0 rotate-45 rounded-[1px] bg-label" />
                  {x.line}
                </li>
              ) : null,
            )}
            {r.best_block && !blockRecord ? (
              <li>
                Longest unbroken block: <b className="font-semibold tnum">{hm(r.best_block.minutes)}</b> on{" "}
                {r.best_block.goal_title}, {weekdayName(r.best_block.day)}.
              </li>
            ) : null}
            {r.thief && !thiefInLesson ? (
              <li>
                {r.thief.what} took <b className="font-semibold tnum">{hm(r.thief.minutes)}</b>,{" "}
                {r.thief.share_pct}% of the time lost.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {r.logged.entries > 0 || r.outcomes.set > 0 ? (
        <section aria-labelledby="week-you" className="mt-8">
          <h2 id="week-you" className="mb-2 text-title3 font-bold">
            What you did
          </h2>
          <p className="text-subhead tnum">
            {r.outcomes.set > 0 ? (
              <>
                <b className="font-semibold">
                  {r.outcomes.done} of {r.outcomes.set}
                </b>{" "}
                daily outcomes done.{" "}
              </>
            ) : null}
            {r.logged.entries > 0 ? (
              <>
                <b className="font-semibold">{hm(r.logged.minutes)}</b> logged in {r.logged.entries}{" "}
                {r.logged.entries === 1 ? "entry" : "entries"}.
              </>
            ) : null}
          </p>
        </section>
      ) : null}

      <NextWeek review={r} />
    </>
  );
}

function GoalRow({ goal: g, complete }: { goal: WeekReviewGoal; complete: boolean }) {
  const time = g.kind === "time";
  const value = time ? `${hm(g.done)} of ${hm(g.budget)}` : `${g.done} of ${g.budget}`;
  const status = g.kept
    ? "Kept."
    : time
      ? `${hm(g.short)} short${g.planned_ahead > 0 && !complete ? `, ${hm(g.planned_ahead)} still booked` : ""}.`
      : `${g.short} short.`;
  return (
    <li className="flex flex-col gap-1.5">
      <BarLabel title={g.title} value={value} />
      <ProgressBar
        value={g.done / g.budget}
        tone={time ? "spark" : "label"}
        size={time ? "md" : "sm"}
        label={`${g.title}: ${time ? `${spokenDuration(g.done)} of ${spokenDuration(g.budget)}` : value}`}
      />
      <p className={`text-footnote tnum ${g.kept ? "font-semibold" : "text-label-2"}`}>{status}</p>
    </li>
  );
}

function NextWeek({ review: r }: { review: WeekReview }) {
  const t = r.next_week;
  return (
    <section aria-labelledby="week-next" className="mt-8">
      <h2 id="week-next" className="mb-2 text-title3 font-bold">
        Next week
      </h2>
      {t.target_pct !== null ? (
        <p className="text-subhead">
          <b className="font-semibold tnum">Target {t.target_pct}%.</b>{" "}
          <span className="text-label-2">{t.reason}</span>
        </p>
      ) : t.reason ? (
        <p className="text-subhead text-label-2">{t.reason}</p>
      ) : null}
      <NextMove move={r.next_move} />
    </section>
  );
}
