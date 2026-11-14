import type { Goal, Recommendation } from "@michael/shared";
import { formatTime, hm } from "./format";

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

/** The short name of a goal: the first calendar title that counts towards it ("Deep work"), or its title. */
export function goalName(goal: Goal | undefined): string | null {
  if (!goal) return null;
  const titles = goal.target?.calendar_titles;
  if (Array.isArray(titles) && typeof titles[0] === "string") return titles[0];
  return goal.title;
}

/** When the action happens: the new start (and end) of the block. */
function actionTimes(rec: Recommendation) {
  const p = rec.action?.payload ?? {};
  return { start: str(p.start_at), end: str(p.end_at) };
}

export function undoDeadline(rec: Recommendation): string | null {
  const { start } = actionTimes(rec);
  const until = [rec.action?.undo_until ?? null, start].filter((x): x is string => Boolean(x));
  if (until.length === 0) return null;
  return new Date(Math.min(...until.map((x) => Date.parse(x)))).toISOString();
}

const EXECUTABLE = new Set(["create_focus_block", "move_calendar_block"]);

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
    rationale: rec.rationale,
    goal,
    maths,
    when: start
      ? creates
        ? `${day}, ${span}`
        : `Moves to ${/^To/.test(day) ? day.toLowerCase() : day}, ${span}`
      : null,
    executable: Boolean(rec.action && EXECUTABLE.has(rec.action.kind) && !involvesOthers),
    involvesOthers,
    status: rec.status,
    undoUntil: undoDeadline(rec),
  };
}

/**
 * What the panel shows: open suggestions whose time is still ahead, and done ones that can still
 * be undone. Executable first, then newest. At most `limit`.
 */
export function openRecommendations(recs: Recommendation[], now: Date, limit = 3): Recommendation[] {
  const ahead = (iso: string | null) => iso === null || Date.parse(iso) > now.getTime();
  return recs
    .filter((r) => {
      if (r.status === "done") return ahead(undoDeadline(r));
      if (r.status === "dismissed") return false;
      return ahead(actionTimes(r).start ?? r.action?.undo_until ?? null);
    })
    .sort((a, b) => {
      const ex = (r: Recommendation) => (r.action && !r.action.involves_others ? 0 : 1);
      return ex(a) - ex(b) || Date.parse(b.created_at) - Date.parse(a.created_at);
    })
    .slice(0, limit);
}

/** Michael's words for a failed Do it, Undo or Not now. One line, owns the problem. */
export function recError(status: number, message: string): string {
  if (/other people|someone else/i.test(message))
    return "That has other people in it. I only move your own time.";
  if (/already started|too late/i.test(message)) return "Too late. That block has already started.";
  if (status === 404) return "That suggestion is gone. I have taken it off the list.";
  if (status === 501) return "I cannot do that one myself yet. Take it as advice.";
  if (status === 409) return message.endsWith(".") ? message : `${message}.`;
  if (status === 0) return "I could not reach the server. Nothing changed.";
  return "That did not work on my side. Nothing changed. Try again in a minute.";
}
