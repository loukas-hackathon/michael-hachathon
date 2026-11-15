import type { Moment, MomentKind, MomentMove } from "@michael/shared";
import Link from "next/link";
import { formatTime, hm } from "@/lib/format";
import { lastTime, lastTimeSentence } from "@/lib/moment-risk";
import { getMoment } from "@/lib/moments";
import { weekdayName } from "@/lib/week";
import { Fold } from "./fold";

/** `said`: a line the card has just said above; a move whose reason is that same line shows only its title. */
function Move({ move, label, said }: { move: MomentMove; label?: string; said?: string | null }) {
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-subhead font-semibold">
        {label ? <span className="text-label-2">{label} </span> : null}
        {move.title}.
      </p>
      {move.rationale === said ? null : <p className="text-footnote text-label-2">{move.rationale}</p>}
    </li>
  );
}

/** The maths: each goal against its weekly budget (morning) or today's plan (evening). */
function GoalLines({ moment }: { moment: Moment }) {
  // Sleep stays outside the maths: the API marks the sleep goal (isSleepGoal, #201).
  const lines = moment.goals.filter((g) => !g.sleep && g.category !== "rest" && g.budget_minutes !== null);
  if (lines.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-3 gap-y-1 text-footnote">
      {lines.map((g) => (
        <div key={g.goal_id} className="contents">
          <dt className="truncate text-label-2">{g.title}</dt>
          <dd className="text-right tnum">
            {moment.kind === "morning"
              ? `${hm(g.planned_today_minutes)} today, ${hm(g.spent_week_minutes)} of ${hm(g.budget_minutes ?? 0)} this week`
              : g.planned_today_minutes === 0 && g.spent_today_minutes === 0
                ? "Not booked today"
                : `${hm(g.spent_today_minutes)} of ${hm(g.planned_today_minutes)} held${g.lost_today_minutes > 0 ? `, ${hm(g.lost_today_minutes)} lost` : ""}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Morning plan or Evening review as a quiet row on Today: the headline shows, the maths opens. */
export function MomentView({ moment }: { moment: Moment }) {
  const risk = moment.at_risk;
  // What this block lost the last time it ran, when the API has it; else the usual loss (#330).
  const last = risk ? lastTime(risk, moment.day) : null;
  const lastLine = risk ? lastTimeSentence(risk, moment.day) : null;
  const title = moment.kind === "morning" ? "Morning plan" : "Evening review";
  return (
    <Fold
      wideOpen
      title={title}
      label={title}
      meta={<time dateTime={moment.generated_at}>{formatTime(moment.generated_at)}</time>}
      preview={moment.headline}
    >
      <p className="text-body font-semibold">{moment.headline}</p>
      <GoalLines moment={moment} />
      {risk ? (
        <p className="text-subhead">
          <span className="font-semibold">Most at risk: </span>
          {risk.title}, <span className="tnum">{formatTime(risk.start_at)}</span> to{" "}
          <span className="tnum">{formatTime(risk.end_at)}</span>.{" "}
          {last ? (
            <>
              {last.when} this block lost <b className="font-semibold tnum">{last.lost}</b>
              {last.trigger ? ` to ${last.trigger}` : ""}.
            </>
          ) : (
            <>
              About <b className="font-semibold tnum">{risk.expected_lost_minutes} minutes</b> usually go
              {risk.usual_trigger ? ` to ${risk.usual_trigger}` : ""}.
            </>
          )}
        </p>
      ) : null}
      {moment.lesson ? <p className="text-subhead">{moment.lesson}</p> : null}
      {moment.kind === "evening" && moment.totals.won_back_minutes > 0 ? (
        <p className="text-subhead">
          <b className="font-semibold tnum">{hm(moment.totals.won_back_minutes)}</b> won back against your
          usual {hm(moment.totals.baseline_lost_minutes ?? 0)} lost.
        </p>
      ) : null}
      {moment.suggestions.length > 0 || moment.first_move ? (
        <ul className="flex flex-col gap-2.5">
          {moment.suggestions.map((s) => (
            <Move key={s.title} move={s} said={lastLine} />
          ))}
          {moment.first_move ? <Move move={moment.first_move} label="Tomorrow:" /> : null}
        </ul>
      ) : null}
      {/* Sunday's Evening review closes the week too (#376). */}
      {moment.kind === "evening" && weekdayName(moment.day) === "Sunday" ? (
        <Link
          href="/week"
          className="press -mx-2 flex h-11 items-center justify-between px-2 text-subhead font-semibold"
        >
          The whole week, and next week's first move
          <span aria-hidden="true" className="text-label-2">
            ›
          </span>
        </Link>
      ) : null}
    </Fold>
  );
}

/** Morning plan or Evening review for Today's "More from Michael". Renders nothing if the moment cannot load. */
export async function MomentCard({ kind, sample }: { kind: MomentKind; sample: boolean }) {
  const moment = await getMoment(kind, sample).catch((err) => {
    console.error("moment card:", err);
    return null;
  });
  return moment ? <MomentView moment={moment} /> : null;
}
