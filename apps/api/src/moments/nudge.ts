import { voiceDuration } from "@michael/shared";
import { isValidCopy } from "../nudges/engine";
import { Zone } from "../patterns/time";
import { lastTimeLine, type MomentCore, riskBlockName, templateHeadline } from "./compute";

// The Morning or Evening moment as one nudge: the headline when it fits the nudge rules (under 15
// words, no dashes), else its first sentence, else a shorter line from the same numbers. Pure.

const MORNING_READY = "Morning. Your plan is ready when you are.";
const EVENING_READY = "Day's done. Two minutes for your evening review.";

const firstSentence = (text: string) => (text.match(/^.*?[.:](?=\s|$)/)?.[0] ?? text).replace(/:$/, ".");

export function momentNudge(m: MomentCore): { text: string; reason: string } {
  const tz = new Zone(m.timezone);
  const clock = (iso: string) => tz.clock(Date.parse(iso));
  const t = m.totals;
  const headline = templateHeadline(m);

  const options: string[] = [headline, firstSentence(headline)];
  const reasons: string[] = [];
  if (m.kind === "morning") {
    const risk = m.at_risk;
    if (risk) {
      // The stake as a line of its own when the whole headline is too long for a nudge.
      const last = lastTimeLine(risk, m.day, riskBlockName(m, risk));
      if (last) options.splice(1, 0, last);
      options.push(`Guard ${clock(risk.start_at)} to ${clock(risk.end_at)} today.`);
      reasons.push(
        last ??
          `About ${risk.expected_lost_minutes} minutes usually go in ${clock(risk.start_at)} to ${clock(risk.end_at)}${risk.usual_trigger ? `, mostly to ${risk.usual_trigger}` : ""}.`,
      );
    }
    const book = m.suggestions.find((s) => s.action_kind === "create_focus_block");
    if (book) {
      options.push(`${book.title}.`);
      reasons.push(book.rationale);
    }
    reasons.unshift(`Today holds ${t.planned_minutes} minutes of goal time.`);
    options.push(MORNING_READY);
  } else {
    if (m.first_move) {
      options.push(`Tomorrow: ${m.first_move.title}.`);
      reasons.push(`Tomorrow: ${m.first_move.title}. ${m.first_move.rationale}`);
    }
    reasons.unshift(
      `Today ${t.spent_minutes} of ${t.planned_minutes} planned minutes held, ${t.lost_minutes} lost, ${t.won_back_minutes} won back.`,
    );
    if (m.lesson) reasons.push(m.lesson);
    options.push(
      t.planned_minutes > 0
        ? `${voiceDuration(t.spent_minutes)} of ${voiceDuration(t.planned_minutes)} held today.`
        : EVENING_READY,
    );
  }
  const text = options.find(isValidCopy) ?? (m.kind === "morning" ? MORNING_READY : EVENING_READY);
  // The reason sits under the line on the stage and the watch: it never says the line again.
  const reason = reasons
    .map((r) => (r !== text && r.startsWith(text) ? r.slice(text.length).trim() : r))
    .filter((r) => r && r !== text)
    .join(" ");
  return { text, reason };
}
