import { isValidCopy } from "../nudges/engine";
import { duration } from "../patterns/format";
import { Zone } from "../patterns/time";
import { type MomentCore, templateHeadline } from "./compute";

// The Morning or Evening moment as one nudge: the headline when it fits the nudge rules (under 15
// words, no dashes), else its first sentence, else a shorter line from the same numbers. Pure.

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
      options.push(`Guard ${clock(risk.start_at)} to ${clock(risk.end_at)} today.`);
      reasons.push(
        `About ${risk.expected_lost_minutes} minutes usually go in ${clock(risk.start_at)} to ${clock(risk.end_at)}${risk.usual_trigger ? `, mostly to ${risk.usual_trigger}` : ""}.`,
      );
    }
    const book = m.suggestions.find((s) => s.action_kind === "create_focus_block");
    if (book) {
      options.push(`${book.title}.`);
      reasons.push(book.rationale);
    }
    reasons.unshift(`Today holds ${t.planned_minutes} minutes of goal time.`);
    options.push("Your morning plan is ready.");
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
        ? `${duration(t.spent_minutes)} of ${duration(t.planned_minutes)} held today.`
        : "Your evening review is ready.",
    );
  }
  const text =
    options.find(isValidCopy) ??
    (m.kind === "morning" ? "Your morning plan is ready." : "Your evening review is ready.");
  return { text, reason: reasons.join(" ") };
}
