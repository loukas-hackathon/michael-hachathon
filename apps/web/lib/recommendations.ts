import type { Goal, Recommendation } from "@michael/shared";
import { formatTime, hm } from "./format";
import { undoneLine } from "./say";

// How the Today panel reads a recommendation: what Michael suggests, the goal it protects, the maths,
// and when the change can still be taken back. Pure, so the server and the browser agree.

export type RecCard = {
  id: string;
  title: string;
  rationale: string;
  /** "Deep work" or the goal's title; null when the recommendation is not tied to a goal. */
  goal: string | null;
  /** "Wins 1h 30 for Deep work." or null when there is no number to show. */
  maths: string | null;
  /** "Tomorrow, 09:30 to 11:00" for a timed action. */
  when: string | null;
  /** Michael can carry it out (own time only); otherwise it stays advice. */
  executable: boolean;
  involvesOthers: boolean;
  status: Recommendation["status"];
  /** Undo is allowed until then (ISO), for a done recommendation. */
  undoUntil: string | null;
  /** What the card says once undone. */
  undoneNote: string;
  /** Drives this suggestion changes, before and after, for the bars (travel suggestions only). */
  drives?: TravelDriveRow[];
};

export type TravelDriveRow = {
  to: string;
  before: { at: string; minutes: number };
  after: { at: string; minutes: number };
};

const TZ = "Europe/Athens";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: TZ });
const str = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** "Today", "Tomorrow" or "Monday", by Athens date. */
export function dayWord(iso: string, now: Date) {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return "Today";
  if (dayKey(d) === dayKey(new Date(now.getTime() + 86_400_000))) return "Tomorrow";
  return weekday.format(d);
}

/** The short name of a goal for the maths line. */
export function goalName(goal: Goal | undefined): string | null {
  if (!goal) return null;
  // Short titles read well in a sentence ("Wins 45 min for 70.3."); long ones give way to the
  // first calendar title that counts towards the goal ("Deep work").
  if (goal.title.length <= 16) return goal.title;
  const titles = goal.target?.calendar_titles;
  if (Array.isArray(titles) && typeof titles[0] === "string") return titles[0];
  return goal.title;
}

/** When the action happens: the new start (and end) of the block. */
function actionTimes(rec: Recommendation) {
  const p = rec.action?.payload ?? {};
  return { start: str(p.start_at), end: str(p.end_at) };
}

// A Mac app guard keeps working until its window ends, so it can be undone (and is still worth
// doing) until then; a calendar change only until the block starts.
const isGuard = (rec: Recommendation) => rec.action?.kind === "block_mac_app";

/** The apps a block_mac_app suggestion names ("WhatsApp and Slack"). */
export function guardedApps(rec: Recommendation): string {
  const p = rec.action?.payload ?? {};
  const names = [p.app, ...(Array.isArray(p.apps) ? p.apps : [])].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? "those apps";
  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

export function undoDeadline(rec: Recommendation): string | null {
  const { start, end } = actionTimes(rec);
  if (isGuard(rec)) return end ?? rec.action?.undo_until ?? null;
  const until = [rec.action?.undo_until ?? null, start].filter((x): x is string => Boolean(x));
  if (until.length === 0) return null;
  return new Date(Math.min(...until.map((x) => Date.parse(x)))).toISOString();
}

// draft_follow_up: "Do it" saves the draft under Follow ups; nothing is sent.
const EXECUTABLE = new Set([
  "draft_follow_up",
  "create_focus_block",
  "move_calendar_block",
  "move_calendar_blocks",
  "block_mac_app",
]);

const leg = (v: unknown): { at: string; minutes: number } | null => {
  const l = v as { depart_at?: unknown; minutes?: unknown } | null;
  const at = str(l?.depart_at);
  return at && typeof l?.minutes === "number" ? { at, minutes: l.minutes } : null;
};

/**
 * The travel side of a suggestion: the whole day plan (move_calendar_blocks, #155) or a leave
 * later reminder (#115). Null for anything else.
 */
export function travelCard(rec: Recommendation, now: Date): Partial<RecCard> | null {
  const a = rec.action;
  if (!a) return null;
  const won = /win (\d+) minutes?/i.exec(rec.title);
  const wonMinutes =
    typeof a.payload.won_minutes === "number" ? a.payload.won_minutes : won ? Number(won[1]) : 0;
  if (a.kind === "move_calendar_blocks") {
    const moves = Array.isArray(a.payload.moves) ? (a.payload.moves as Record<string, unknown>[]) : [];
    const first = moves.map((m) => str(m.start_at)).find(Boolean);
    const drives = (Array.isArray(a.payload.drives) ? (a.payload.drives as Record<string, unknown>[]) : [])
      .map((d) => ({ to: String(d.to ?? ""), before: leg(d.before), after: leg(d.after) }))
      .filter(
        (d): d is TravelDriveRow =>
          Boolean(d.before && d.after) &&
          (d.before?.minutes !== d.after?.minutes || d.before?.at !== d.after?.at),
      );
    const before = typeof a.payload.before_minutes === "number" ? a.payload.before_minutes : null;
    const after = typeof a.payload.after_minutes === "number" ? a.payload.after_minutes : null;
    return {
      when: first
        ? `${dayWord(first, now)}, ${moves.length === 1 ? "1 block moves" : `${moves.length} blocks move`}`
        : null,
      maths:
        before !== null && after !== null
          ? `${before} min on the road becomes ${after}. Wins ${wonMinutes} min.`
          : wonMinutes > 0
            ? `Wins ${wonMinutes} min on the road.`
            : null,
      drives,
      undoneNote: undoneLine("Every block is back where it was.", now),
    };
  }
  if (a.kind === "reminder" && /^leave at/i.test(rec.title)) {
    const at = str(a.payload.at);
    return {
      when: at ? `${dayWord(at, now)}, leave at ${formatTime(at)}` : null,
      maths: wonMinutes > 0 ? `Wins ${wonMinutes} min on the road.` : null,
    };
  }
  return null;
}

/**
 * The line under a booked block's title. The API says it plainly ("University, 90 minutes,
 * booked by Claude. Undo until 07:00."), but on the card the title, the time line, the maths and
 * "Done. Undo until 07:00." already say all of it but who booked it: only that stays ("Booked by
 * Claude."), or nothing when the user booked it in Michael. Older rows keep their line without the
 * undo sentence. Any other rationale is left as it is.
 */
export function bookedRationale(rec: Recommendation): string {
  const title = rec.action?.kind === "create_focus_block" ? rec.action.payload.title : null;
  const old = rec.rationale.replace(/\s*Undo in Michael until it starts\.$/, "");
  if (old !== rec.rationale) return old;
  if (typeof title !== "string" || !rec.rationale.startsWith(`${title}, `)) return rec.rationale;
  // ", 45 minutes[, booked by Claude]. [A note.] Undo until 07:00."
  const m = /^, [^,.]+(?:, booked by (.+?))?\.(.*?)\s*Undo until \d\d:\d\d\.$/.exec(
    rec.rationale.slice(title.length),
  );
  if (!m) return rec.rationale;
  return [m[1] ? `Booked by ${m[1]}.` : "", (m[2] ?? "").trim()].filter(Boolean).join(" ");
}

export function toCard(rec: Recommendation, goals: Goal[], now: Date): RecCard {
  const goal = goalName(goals.find((g) => g.id === rec.goal_id));
  const { start, end } = actionTimes(rec);
  // Only a new block adds goal time we can count; a move protects the goal without a number.
  const creates = rec.action?.kind === "create_focus_block";
  const minutes = creates && start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 60_000) : 0;
  const maths = goal ? (minutes > 0 ? `Wins ${hm(minutes)} for ${goal}.` : `Protects ${goal}.`) : null;
  const involvesOthers = rec.action?.involves_others ?? false;
  const day = start ? dayWord(start, now) : "";
  const span = start ? `${formatTime(start)}${end ? ` to ${formatTime(end)}` : ""}` : "";
  return {
    id: rec.id,
    title: rec.title,
    rationale: rec.status === "done" ? bookedRationale(rec) : rec.rationale,
    goal,
    maths,
    // The title often says the times already ("Block 09:30 to 11:00 for ..."): then only the day.
    when: start
      ? creates || isGuard(rec)
        ? rec.title.includes(span)
          ? day
          : `${day}, ${span}`
        : `Moves to ${/^To/.test(day) ? day.toLowerCase() : day}${rec.title.includes(span) ? "" : `, ${span}`}`
      : null,
    executable: Boolean(rec.action && EXECUTABLE.has(rec.action.kind) && !involvesOthers),
    involvesOthers,
    status: rec.status,
    undoUntil: undoDeadline(rec),
    undoneNote: isGuard(rec)
      ? undoneLine(`${guardedApps(rec)} can open again.`, now)
      : undoneLine("Your calendar is back as it was.", now),
    ...travelCard(rec, now),
  };
}

/**
 * What the panel shows: open suggestions whose time is still ahead, and done ones that can still
 * be undone. Executable first, then newest. At most `limit`. Something the user asked for (in chat
 * or through Claude) and then undid is gone: offering it back as "Do it" would read as Michael's idea.
 */
export function openRecommendations(recs: Recommendation[], now: Date, limit = 3): Recommendation[] {
  const ahead = (iso: string | null) => iso === null || Date.parse(iso) > now.getTime();
  return recs
    .filter((r) => {
      if (r.status === "done") return ahead(undoDeadline(r));
      if (r.status === "dismissed") return false;
      if (r.status === "undone" && r.source === "chat") return false;
      const t = actionTimes(r);
      return ahead((isGuard(r) ? t.end : t.start) ?? r.action?.undo_until ?? null);
    })
    .sort((a, b) => {
      const ex = (r: Recommendation) => (r.action && !r.action.involves_others ? 0 : 1);
      return ex(a) - ex(b) || Date.parse(b.created_at) - Date.parse(a.created_at);
    })
    .slice(0, limit);
}

/**
 * The block the user just had booked, in chat or through Claude, that has not started yet (#330):
 * the newest one. Today shows it at the top with its Undo, so a booking is never hidden in a fold.
 */
export function bookedAhead(recs: Recommendation[], now: Date): Recommendation | null {
  const at = (r: Recommendation) => Date.parse(r.executed_at ?? r.created_at);
  return (
    recs
      .filter((r) => r.status === "done" && r.source === "chat" && r.action?.kind === "create_focus_block")
      .filter((r) => {
        const until = undoDeadline(r);
        return until !== null && Date.parse(until) > now.getTime();
      })
      .sort((a, b) => at(b) - at(a))[0] ?? null
  );
}

/** Michael's words for a failed Do it, Undo or Not now. One line, owns the problem. */
export function recError(status: number, message: string): string {
  if (/other people|someone else/i.test(message))
    return "That has other people in it. I only move your own time.";
  if (/already started|too late/i.test(message)) return "Too late. That block has already started.";
  if (status === 404) return "That suggestion is gone. I have taken it off the list.";
  if (status === 501) return "I cannot do that one myself yet. Take it as advice.";
  if (status === 409) return message.endsWith(".") ? message : `${message}.`;
  if (status === 0) return "I lost the line. Nothing changed.";
  return "That did not work on my side. Nothing changed. Try again in a minute.";
}

const DAY_FIRST = /^(Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;

/**
 * One suggestion in a folded list's preview line: its title, led by the day when that is not today
 * (#385: "Tomorrow: Block 09:30 to 11:00 for cold outreach" in the evening, never a bare time).
 */
export function previewTitle(card: Pick<RecCard, "title" | "when">): string {
  const title = card.title.replace(/[.!?]$/, "");
  const day = card.when ? DAY_FIRST.exec(card.when)?.[1] : undefined;
  return day && !title.includes(day) ? `${day}: ${title}` : title;
}
