import type { Moment, MomentKind, MomentMove } from "@michael/shared";
import { formatTime, hm } from "@/lib/format";
import { getMoment } from "@/lib/moments";

function Move({ move, label }: { move: MomentMove; label?: string }) {
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-subhead font-semibold">
        {label ? <span className="text-label-2">{label} </span> : null}
        {move.title}.
      </p>
      <p className="text-footnote text-label-2">{move.rationale}</p>
    </li>
  );
}

/** The maths: each goal against its weekly budget (morning) or today's plan (evening). */
function GoalLines({ moment }: { moment: Moment }) {
  // Sleep stays outside the maths: the API marks the sleep goal (isSleepGoal, #201).
  const lines = moment.goals.filter((g) => !g.sleep && g.category !== "rest" && g.budget_minutes !== null);
  the;
  // moment's rows carry no kind yet, so the title decides until they do.
  const lines = moment.goals.filter(
    (g) => g.category !== "rest" && !/\bsleep\b/i.test(g.title) && g.budget_minutes !== null,
  );
  if (lines.length === 0) return null;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-footnote">
      {lines.map((g) => (
        <div key={g.goal_id} className="contents">
          <dt className="truncate text-label-2">{g.title}</dt>
          <dd className="text-right tnum">
            {moment.kind === "morning"
              ? `${hm(g.planned_today_minutes)} today, ${hm(g.spent_week_minutes)} of ${hm(g.budget_minutes ?? 0)} this week`
              : `${hm(g.spent_today_minutes)} of ${hm(g.planned_today_minutes)} held${g.lost_today_minutes > 0 ? `, ${hm(g.lost_today_minutes)} lost` : ""}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function MomentView({ moment }: { moment: Moment }) {
  const risk = moment.at_risk;
  return (
    <article
      aria-label={moment.kind === "morning" ? "Morning plan" : "Evening review"}
      className="mt-5 flex flex-col gap-3 rounded-card bg-fill px-4 pt-3.5 pb-4"
    >
      <header className="flex items-center text-footnote font-semibold">
        <span>{moment.kind === "morning" ? "Morning plan" : "Evening review"}</span>
        <time className="ml-auto font-medium text-label-2 tnum" dateTime={moment.generated_at}>
          {formatTime(moment.generated_at)}
        </time>
      </header>
      <p className="text-title3 font-semibold">{moment.headline}</p>
      <GoalLines moment={moment} />
      {risk ? (
        <p className="text-subhead">
          <span className="font-semibold">Most at risk: </span>
          {risk.title}, <span className="tnum">{formatTime(risk.start_at)}</span> to{" "}
          <span className="tnum">{formatTime(risk.end_at)}</span>. About{" "}
          <b className="font-semibold tnum">{risk.expected_lost_minutes} minutes</b> usually go
          {risk.usual_trigger ? ` to ${risk.usual_trigger}` : ""}.
        </p>
      ) : null}
      {moment.lesson ? <p className="text-subhead">{moment.lesson}</p> : null}
      {moment.kind === "evening" && moment.totals.won_back_minutes > 0 ? (
        <p className="text-subhead">
          <b className="font-semibold text-tint-text tnum">{hm(moment.totals.won_back_minutes)}</b> won back
          against your usual {hm(moment.totals.baseline_lost_minutes ?? 0)} lost.
        </p>
      ) : null}
      {moment.suggestions.length > 0 || moment.first_move ? (
        <ul className="flex flex-col gap-2.5">
          {moment.suggestions.map((s) => (
            <Move key={s.title} move={s} />
          ))}
          {moment.first_move ? <Move move={moment.first_move} label="Tomorrow:" /> : null}
        </ul>
      ) : null}
    </article>
  );
}

/** Morning plan or Evening review for the Today screen. Renders nothing if the moment cannot load. */
export async function MomentCard({ kind, sample }: { kind: MomentKind; sample: boolean }) {
  const moment = await getMoment(kind, sample).catch((err) => {
    console.error("moment card:", err);
    return null;
  });
  return moment ? <MomentView moment={moment} /> : null;
}
