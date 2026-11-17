import { type Traction, voiceDuration } from "@michael/shared";

// The words and figures of /traction (GET /v1/admin/traction): pure, so the page and the
// "Copy for investors" text say exactly the same thing.

/** "42%", or null when there is nothing to divide by. */
export const pct = (share: number | null): string | null =>
  share === null ? null : `${Math.round(share * 100)}%`;

/** "16 Nov" for the Monday of a week. */
export const weekLabel = (monday: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${monday}T12:00:00Z`),
  );

/** A wait in a sentence: voiceDuration up to two days, whole days after that. */
export function waitPhrase(minutes: number): string {
  if (minutes < 48 * 60) return voiceDuration(minutes);
  const days = Math.round(minutes / 1440);
  return `${days} days`;
}

/** Whole hours and minutes for big totals: voiceDuration ("2h 15", "47 minutes"). */
export const total = (minutes: number): string => voiceDuration(minutes);

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** The headline rows, in order: what investors ask first. */
export function headlineRows(t: Traction): { label: string; value: string; note: string }[] {
  const week4 = pct(t.retention.week_4);
  const g = t.goal_time.this_week;
  const median = t.activation.median_minutes_to_first_source;
  return [
    {
      label: "Weekly active",
      value: t.active.weekly.toLocaleString("en-GB"),
      note: `${t.active.daily} today, last 7 days`,
    },
    {
      label: "Activation",
      value: pct(t.activation.share) ?? "None yet",
      note:
        median === null
          ? `${t.activation.activated} of ${t.sign_ups.total} connected a source`
          : `${t.activation.activated} of ${t.sign_ups.total}, median ${waitPhrase(median)} to connect`,
    },
    {
      label: "Week 4 retention",
      value: week4 ?? "Not yet",
      note: week4 ? "Cohorts with a full fourth week" : "No cohort has a full fourth week yet",
    },
    {
      label: "Won back this week",
      value: g.users > 0 ? total(g.won_back_minutes) : "Nothing yet",
      note:
        g.users > 0 ? `${plural(g.users, "person", "people")} with goal time` : "No goal time planned yet",
    },
  ];
}

/** The short plain text summary the "Copy for investors" button puts on the clipboard. */
export function investorSummary(t: Traction, today = new Date(t.generated_at)): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: t.timezone,
  }).format(today);
  const thisWeek = t.sign_ups.weeks.at(-1)?.sign_ups ?? 0;
  const lastWeek = t.sign_ups.weeks.at(-2)?.sign_ups ?? 0;
  const g = t.goal_time.this_week;
  const gl = t.goal_time.last_week;
  const e = t.engagement;
  const lines = [
    `Michael traction, ${date}`,
    "",
    `Sign ups: ${t.sign_ups.total.toLocaleString("en-GB")} in all, ${thisWeek} this week, ${lastWeek} last week.`,
    `Activation: ${pct(t.activation.share) ?? "none yet"} connected a real source (${t.activation.activated} of ${t.sign_ups.total})${
      t.activation.median_minutes_to_first_source === null
        ? "."
        : `, median ${waitPhrase(t.activation.median_minutes_to_first_source)} from sign up.`
    }`,
    `Active: ${plural(t.active.weekly, "person", "people")} in the last 7 days, ${t.active.daily} today.`,
    `Retention: week 1 ${pct(t.retention.week_1) ?? "not measurable yet"}, week 2 ${pct(t.retention.week_2) ?? "not measurable yet"}, week 4 ${pct(t.retention.week_4) ?? "not measurable yet"}.`,
    g.users > 0
      ? `Goal time this week: ${pct(g.share)} of planned time kept so far (${total(g.spent_minutes)} of ${total(g.elapsed_minutes)}, ${plural(g.users, "person", "people")}); ${total(g.won_back_minutes)} won back.`
      : "Goal time this week: none planned yet.",
    gl.users > 0
      ? `Goal time last week: ${pct(gl.share)} kept (${total(gl.spent_minutes)} of ${total(gl.elapsed_minutes)}); ${total(gl.won_back_minutes)} won back.`
      : null,
    `Michael at work: ${plural(e.actions_done, "action")} carried out (${e.actions_undone} undone), ${plural(e.chat_messages, "chat message")}, ${plural(e.nudges_sent, "nudge")} sent, ${plural(e.connector_queries, "Claude connector query", "Claude connector queries")}.`,
    "",
    "Real users only: the demo account and our own addresses are left out.",
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}
