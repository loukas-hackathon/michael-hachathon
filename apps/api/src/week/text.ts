import { voiceDuration, type WeekReview } from "@michael/shared";
import { Zone } from "../patterns/time";
import { weekdayOf } from "./review";

// Your week (#376) as short text for models: the chat tool and the MCP tool `get_week_review` read
// the same lines, so "how was my week" answers with the review's own numbers everywhere.

export function weekReviewText(r: WeekReview): string {
  const s = r.score;
  const d = voiceDuration;
  const zone = new Zone(r.timezone);
  const lines = [
    `Your week, ${r.week_start} to ${r.week_end}${r.complete ? "" : " (still running)"}:`,
    s.pct === null
      ? "- Score: no goal time elapsed yet."
      : `- Score ${s.pct}%: ${d(s.spent_minutes)} held of ${d(s.elapsed_minutes)} planned so far, ${d(s.lost_minutes)} lost${s.unverified_minutes > 0 ? `, ${d(s.unverified_minutes)} of the held time unconfirmed` : ""}.${s.usual_pct === null ? "" : ` Usual week ${s.usual_pct}%.`}${s.target_pct === null ? "" : ` Target ${s.target_pct}%, ${s.on_target ? "met" : "not met"}.`}`,
    ...(r.won_back_minutes > 0 ? [`- Won back ${d(r.won_back_minutes)} against the usual loss rate.`] : []),
    ...r.goals.map((g) =>
      g.kind === "time"
        ? `- ${g.title}: ${d(g.done)} of ${d(g.budget)}, ${g.kept ? "kept" : `${d(g.short)} short`}.`
        : `- ${g.title}: ${g.done} of ${g.budget} sessions, ${g.kept ? "kept" : `${g.short} short`}.`,
    ),
    ...(r.thief
      ? [`- Biggest thief: ${r.thief.what}, ${d(r.thief.minutes)} (${r.thief.share_pct}% of the lost time).`]
      : []),
    ...r.records.flatMap((x) => (x.line ? [`- Record: ${x.line}`] : [])),
    ...(r.best_block
      ? [
          `- Longest unbroken block: ${d(r.best_block.minutes)} on ${r.best_block.goal_title}, ${weekdayOf(r.best_block.day)}.`,
        ]
      : []),
    ...(r.logged.entries > 0
      ? [`- Logged by you: ${r.logged.entries} entries, ${d(r.logged.minutes)}.`]
      : []),
    ...(r.outcomes.set > 0 ? [`- Daily outcomes: ${r.outcomes.done} of ${r.outcomes.set} done.`] : []),
    `- Lesson: ${r.lesson}`,
    r.next_week.target_pct === null
      ? `- Next week's target: none yet. ${r.next_week.reason ?? ""}`.trim()
      : `- Next week's target: ${r.next_week.target_pct}% (${r.next_week.status}). ${r.next_week.reason ?? ""}`.trim(),
    ...(r.next_move
      ? [
          r.next_move.status === "booked"
            ? `- First move: ${r.next_move.title}, already booked.`
            : `- First move: ${r.next_move.title} (${zone.clock(Date.parse(r.next_move.start_at))} to ${zone.clock(Date.parse(r.next_move.end_at))}). Book it with create_focus_block (goal_id ${r.next_move.goal_id}) only if the user agrees.`,
        ]
      : []),
  ];
  return lines.join("\n");
}
