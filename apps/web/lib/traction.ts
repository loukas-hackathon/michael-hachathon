import { type Traction, type TractionWaitingList, voiceDuration } from "@michael/shared";

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
    ...waitingListLines(t.waiting_list),
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

// ---------- the waiting list (Traction.waiting_list): numbers only, never a name or an email ----------

/** The founding member price, a month, in euros: what "stated intent" is worth if they all pay. */
export const FOUNDING_PRICE_EUR = 15;

/** Whole percent of a part, or 0 when there is no whole. */
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * The week on week change in words, or null when it would mislead: "First week." while the list
 * is younger than a week; nothing when the week before was empty.
 */
export function weekChange(w: TractionWaitingList, today: string): string | null {
  if (!w.first_day) return null;
  const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${w.first_day}T12:00:00Z`)) / 86_400_000;
  if (days < 7) return "First week.";
  if (w.previous_7_days === 0) return null;
  const change = Math.round(((w.last_7_days - w.previous_7_days) / w.previous_7_days) * 100);
  if (change === 0) return "the same as the week before";
  return change > 0 ? `${change}% more than the week before` : `${-change}% fewer than the week before`;
}

/** "16 Nov" for a local day. */
export const dayLabel = (day: string): string => weekLabel(day);

/** "Sunday" for a local day. */
export const weekdayOf = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

const ROLE_WORDS: Record<string, [string, string]> = {
  founder: ["founder", "founders"],
  executive: ["executive", "executives"],
  employee: ["employee", "employees"],
  student: ["student", "students"],
  other: ["other", "others"],
};

/** The biggest two roles as shares: "54% founders, 22% executives". Null with nobody. */
export function rolesPhrase(w: TractionWaitingList): string | null {
  if (w.total === 0) return null;
  return Object.entries(w.by_role)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([role, n]) => `${share(n, w.total)}% ${ROLE_WORDS[role]?.[1] ?? role}`)
    .join(", ");
}

/** "71% on Mac, 64% on iPhone, 80% on Google Calendar." */
export function setupPhrase(w: TractionWaitingList): string | null {
  if (w.total === 0) return null;
  return `${share(w.by_computer.mac ?? 0, w.total)}% on Mac, ${share(w.by_phone.iphone ?? 0, w.total)}% on iPhone, ${share(w.by_calendar.google ?? 0, w.total)}% on Google Calendar.`;
}

/** "X 41%, LinkedIn 22%, direct 19%": the top three. */
export function sourcesPhrase(w: TractionWaitingList): string | null {
  if (w.total === 0 || w.by_source.length === 0) return null;
  return w.by_source
    .slice(0, 3)
    .map((s) => `${s.source} ${share(s.sign_ups, w.total)}%`)
    .join(", ");
}

/** The hours as people say them: "6 hours", "4.5 hours". */
export const hoursPhrase = (h: number): string =>
  `${Number.isInteger(h) ? h : h.toFixed(1)} ${h === 1 ? "hour" : "hours"}`;

/** The waiting list's lines in the investor text: the same numbers as the page, in its order. */
export function waitingListLines(w: TractionWaitingList): string[] {
  if (w.total === 0) return ["Waiting list: nobody yet."];
  const vsBefore =
    w.previous_7_days > 0 && w.last_7_days !== w.previous_7_days
      ? `, ${w.last_7_days > w.previous_7_days ? "up" : "down"} ${Math.abs(Math.round(((w.last_7_days - w.previous_7_days) / w.previous_7_days) * 100))}% on the week before`
      : "";
  const lines = [
    `Waiting list: ${plural(w.total, "person", "people")} waiting. ${w.last_7_days} joined in the last 7 days${vsBefore}.`,
  ];
  if (w.founding_members > 0) {
    lines.push(
      `${w.founding_members} would prepay €${FOUNDING_PRICE_EUR} a month as founding ${w.founding_members === 1 ? "member" : "members"} (€${(w.founding_members * FOUNDING_PRICE_EUR).toLocaleString("en-GB")} a month of stated intent).`,
    );
  }
  lines.push(`${share(w.referred, w.total)}% joined through a friend.`);
  const roles = rolesPhrase(w);
  lines.push(
    `${w.median_hours === null ? "" : `Median self reported time lost: ${hoursPhrase(w.median_hours)} a week. `}${roles ? `${roles}.` : ""}`.trim(),
  );
  return lines;
}
