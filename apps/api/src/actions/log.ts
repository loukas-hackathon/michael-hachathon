import {
  type Event,
  type Goal,
  goalKind,
  LogTimeInput,
  LogTimePayload,
  type LogTimeResponse,
  type Recommendation,
  type RecommendationAction,
  SettleBlockInput,
  SettleBlockPayload,
  voiceShortDuration,
} from "@michael/shared";
import { HttpError, parse } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { loadWeek } from "../routes/score";
import { DIDNT_TYPE, DONE_TYPE, isLogEntry, LOG_SOURCE } from "../score/logged";
import { goalForEvent, normaliseTitle } from "../score/match";
import { store } from "../store";

// Done time the user reports (#317), and past goal blocks they settle. "I took a bath for 40
// minutes at 13:00" becomes the user's own manual entry (shape in score/logged.ts) that the score
// counts as confirmed goal time. Every entry is held by a recommendation (log_time or
// settle_block) carried out at once, so it shows like any other action and can be undone: undo
// removes the entry, nothing else. The REST routes (routes/log.ts), the chat tools and the MCP
// tools all come through here, so the rules live in one place:
//   - past only: an entry never ends after now, and starts at most 14 days ago;
//   - the goal by id or by name (an active time or count goal), never guessed between two;
//   - a block is settled once (undo first to change it), only after it started, only the user's
//     own goal blocks (an event with other people is never goal time).

const MAX_BACK_MS = 14 * 24 * 3600_000;
/** How long a logged entry can be taken back. */
export const LOG_UNDO_MS = 24 * 3600_000;
// A clock a few seconds ahead of ours is still "just now".
const SLACK_MS = 60_000;

/** Who wrote the entry, kept on it for the record. */
export type LogVia = "app" | "chat" | "mcp";

const zone = () => new Zone(DEFAULT_TIMEZONE);
const iso = (ms: number) => new Date(ms).toISOString();
const isOthers = (e: Event) => e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;
const loggable = (g: Goal) => g.active && (goalKind(g) === "time" || goalKind(g) === "count");

/**
 * The goal the user meant. By id, or by name: the same name, then a goal whose title holds the
 * words (or is held by them), then one whose calendar titles do. Two equally good candidates are
 * a question, never a guess.
 */
export function matchGoal(goals: Goal[], ref: { goal_id?: string; goal?: string }): Goal {
  const open = goals.filter(loggable);
  if (ref.goal_id) {
    const goal = goals.find((g) => g.id === ref.goal_id);
    if (!goal) throw new HttpError("not_found", "Goal not found");
    if (!loggable(goal))
      throw new HttpError(
        "bad_request",
        goal.active ? `${goal.title} is not measured in time or sessions` : `${goal.title} is paused`,
      );
    return goal;
  }
  const said = normaliseTitle(ref.goal ?? "");
  const names = open.map((g) => g.title).join(", ") || "none yet";
  if (!said) throw new HttpError("bad_request", "Name the goal");
  const titlesOf = (g: Goal) => {
    const t = g.target?.calendar_titles;
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string").map(normaliseTitle) : [];
  };
  const tiers: ((g: Goal) => boolean)[] = [
    (g) => normaliseTitle(g.title) === said,
    (g) => normaliseTitle(g.title).includes(said) || said.includes(normaliseTitle(g.title)),
    (g) => titlesOf(g).some((t) => t === said || t.includes(said) || said.includes(t)),
  ];
  const ask = (hits: Goal[]) =>
    new HttpError(
      "bad_request",
      `"${ref.goal}" could be ${hits.map((g) => g.title).join(" or ")}. Which one?`,
    );
  for (const tier of tiers) {
    const hits = open.filter(tier);
    if (hits.length === 1) return hits[0] as Goal;
    if (hits.length > 1) throw ask(hits);
  }
  // Last step: the user's words against each goal's title, calendar titles and description.
  const best = bestByWords(open, said, titlesOf);
  if (best.length === 1) return best[0] as Goal;
  if (best.length > 1) throw ask(best);
  throw new HttpError("not_found", `No goal called "${ref.goal}". Your goals: ${names}`);
}

// Words that say nothing about which goal: "I took a bath for 40 minutes this morning".
const FILLER = new Set(
  "the and for with this that then from after before about some just had did took went got was were have done made into onto our their my your his her its a an of at in on to by minutes minute mins min hours hour hrs half quarter morning afternoon evening night today yesterday tonight earlier again bit little long quick session".split(
    " ",
  ),
);

// What an activity is usually part of, so "a bath" finds a goal about recovery and "a bike ride"
// one with "ride" in it. Small on purpose: titles and descriptions do most of the work.
const RELATED: Record<string, string[]> = {
  bath: ["recovery", "rest"],
  ice: ["recovery"],
  sauna: ["recovery", "rest"],
  massage: ["recovery", "rest"],
  stretch: ["recovery", "yoga", "mobility"],
  stretching: ["recovery", "yoga", "mobility"],
  plunge: ["recovery"],
  foam: ["recovery", "mobility"],
  nap: ["rest", "sleep"],
  meditation: ["rest", "mindfulness"],
  meditate: ["rest", "mindfulness"],
  bike: ["ride", "cycling"],
  cycling: ["ride", "bike"],
  cycle: ["ride", "bike"],
  jog: ["run", "running"],
  jogging: ["run", "running"],
  workout: ["gym", "training"],
  weights: ["gym", "training"],
  lifting: ["gym", "training"],
  pool: ["swim", "swimming"],
  revision: ["study", "exam"],
  revising: ["study", "exam"],
  homework: ["study"],
  lecture: ["study", "university"],
  exam: ["study", "university"],
  studying: ["study"],
  outreach: ["company", "sales"],
  sales: ["company", "outreach"],
};

const tokens = (text: string) =>
  normaliseTitle(text)
    .split(/[^\p{L}\p{N}.]+/u)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);

/** One word of the user's against one word of a goal: equal, or one a stem of the other ("swim", "swimming"). */
const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * The goals the words point to most: a word in the title counts 3, in a calendar title 2, in the
 * description 1; a related word (RELATED) half that. The single best wins; a tie at the top is
 * every goal in it (the caller asks), and no score at all is none.
 */
export function bestByWords(goals: Goal[], said: string, titlesOf: (g: Goal) => string[]): Goal[] {
  const words = tokens(said).filter((w) => !FILLER.has(w) && (w.length >= 3 || /\d/.test(w)));
  if (!words.length) return [];
  const related = [...new Set(words.flatMap((w) => RELATED[w] ?? []))].filter((r) => !words.includes(r));
  const scored = goals.map((g) => {
    const fields: [string[], number][] = [
      [tokens(g.title), 3],
      [titlesOf(g).flatMap(tokens), 2],
      [tokens(g.description ?? ""), 1],
    ];
    const score = (list: string[], weight: number) =>
      list.reduce((sum, w) => {
        const hit = fields.reduce(
          (top, [field, f]) => (field.some((t) => sameWord(w, t)) ? Math.max(top, f) : top),
          0,
        );
        return sum + hit * weight;
      }, 0);
    return { g, score: score(words, 1) + score(related, 0.5) };
  });
  const top = Math.max(0, ...scored.map((s) => s.score));
  return top > 0 ? scored.filter((s) => s.score === top).map((s) => s.g) : [];
}

/** The span the user meant: start and end, minutes from a start, or minutes ending just now. */
export function logSpan(
  input: { minutes?: number; start_at?: string; end_at?: string },
  now: number,
): { start: number; end: number } {
  const minutes = input.minutes ? input.minutes * 60_000 : null;
  let start = input.start_at ? Date.parse(input.start_at) : null;
  let end = input.end_at ? Date.parse(input.end_at) : null;
  if (start !== null && end === null && minutes) end = start + minutes;
  if (end !== null && start === null && minutes) start = end - minutes;
  if (start === null && end === null && minutes) {
    end = now;
    start = now - minutes;
  }
  if (start === null || end === null || !(end > start))
    throw new HttpError("bad_request", "Give minutes, or a start before the end");
  if (end > now + SLACK_MS)
    throw new HttpError("conflict", "That has not happened yet. I only log time you already spent");
  if (start < now - MAX_BACK_MS) throw new HttpError("conflict", "I log the last 14 days only");
  return { start, end: Math.min(end, now) };
}

/** "40 of 60 min" for small budgets, "2h 10 of 9h" for larger ones. */
export function weekMaths(spent: number, budget: number): string {
  if (budget <= 0) return `${voiceShortDuration(spent)} this week`;
  if (budget < 120 && spent < 120) return `${spent} of ${budget} min this week`;
  return `${voiceShortDuration(spent)} of ${voiceShortDuration(budget)} this week`;
}

/** The goal's week after the entry, read the way GET /v1/score reads it. */
async function goalWeek(goal: Goal, at: number): Promise<LogTimeResponse["goal"]> {
  const week = await loadWeek({ date: zone().dayOf(at) }).catch(() => null);
  const row = week?.score.goals.find((g) => g.goal_id === goal.id);
  const spent =
    goalKind(goal) === "count" ? (row?.count?.done ?? 0) : Math.max(0, Math.round(row?.spent_minutes ?? 0));
  const budget =
    goalKind(goal) === "count"
      ? Number(goal.target?.per_week ?? 0) || 0
      : (row?.budget_minutes ?? goal.weekly_budget_minutes ?? 0);
  return { goal_id: goal.id, title: goal.title, spent_minutes: spent, budget_minutes: budget };
}

function lineFor(goal: Goal, week: LogTimeResponse["goal"], lead: string): string {
  if (goalKind(goal) === "count") {
    const target = week.budget_minutes ? ` of ${week.budget_minutes}` : "";
    return `${lead} ${goal.title} ${week.spent_minutes}${target} this week.`;
  }
  return `${lead} ${goal.title} ${weekMaths(week.spent_minutes, week.budget_minutes)}.`;
}

// ---------- carrying out (called by actions/calendar.ts for log_time and settle_block) ----------

/** What execute keeps so undo removes exactly the entry it wrote. */
export interface LogExecution {
  kind: "log_time" | "settle_block";
  timeline_event_id: string;
  undo_until: string;
}

async function writeEntry(input: {
  type: typeof DONE_TYPE | typeof DIDNT_TYPE;
  start_at: string;
  end_at: string;
  title: string;
  data: Record<string, unknown>;
}): Promise<Event> {
  const { inserted } = await store.insertEvents([{ source: LOG_SOURCE, external_id: null, ...input }]);
  const entry = inserted[0];
  if (!entry) throw new HttpError("conflict", "That entry could not be kept");
  return entry;
}

/** Writes the entry a log_time or settle_block recommendation holds. */
export async function executeLog(rec: Recommendation, action: RecommendationAction): Promise<LogExecution> {
  const undo_until = action.undo_until ?? iso(Date.now() + LOG_UNDO_MS);
  if (action.kind === "log_time") {
    const p = parse(LogTimePayload, action.payload);
    const entry = await writeEntry({
      type: DONE_TYPE,
      start_at: p.start_at,
      end_at: p.end_at,
      title: p.note ?? rec.title,
      data: { log: "done", goal_id: p.goal_id, note: p.note ?? null, recommendation_id: rec.id },
    });
    return { kind: "log_time", timeline_event_id: entry.id, undo_until };
  }
  const p = parse(SettleBlockPayload, action.payload);
  const entry = await writeEntry({
    type: p.did ? DONE_TYPE : DIDNT_TYPE,
    start_at: p.start_at,
    end_at: p.end_at,
    title: rec.title,
    data: {
      log: p.did ? "done" : "didnt",
      goal_id: p.goal_id,
      event_id: p.event_id,
      reason: p.reason ?? null,
      recommendation_id: rec.id,
    },
  });
  return { kind: "settle_block", timeline_event_id: entry.id, undo_until };
}

/** Undo: the entry goes, and with it the time it added or the verdict it gave. */
export async function revertLog(ex: LogExecution): Promise<void> {
  const entry = await store.getEvent(ex.timeline_event_id);
  // Only ever an entry this module wrote.
  if (entry && isLogEntry(entry)) await store.deleteEvents([entry.id]);
}

// ---------- the one way in ----------

type Execute = (id: string) => Promise<Recommendation>;

async function carryOut(
  execute: Execute,
  draft: Parameters<typeof store.createRecommendation>[0],
): Promise<{ rec: Recommendation; entry: Event }> {
  const rec = await store.createRecommendation(draft);
  let done: Recommendation;
  try {
    done = await execute(rec.id);
  } catch (err) {
    await store.updateRecommendationStatus(rec.id, "dismissed").catch(() => null);
    throw err;
  }
  const ex = (await store.getRecommendationExecution(done.id)) as { timeline_event_id?: string } | null;
  const entry = ex?.timeline_event_id ? await store.getEvent(ex.timeline_event_id) : null;
  if (!entry) throw new HttpError("internal", "The entry was not kept");
  return { rec: done, entry };
}

/**
 * Logs done time: "I took a bath for 40 minutes at 13:00". `execute` is
 * executeRecommendation (passed in, so this module does not import the executor that imports it).
 */
export async function logTime(raw: unknown, via: LogVia, execute: Execute): Promise<LogTimeResponse> {
  const input = parse(LogTimeInput, raw);
  const now = Date.now();
  const goal = matchGoal(await store.listGoals(), input);
  const { start, end } = logSpan(input, now);
  const minutes = Math.round((end - start) / 60_000);
  const z = zone();
  const { rec, entry } = await carryOut(execute, {
    goal_id: goal.id,
    title: `Logged ${goal.title}, ${voiceShortDuration(minutes)} at ${z.clock(start)}`,
    rationale:
      via === "chat" ? "You told me in chat." : via === "mcp" ? "Logged by an agent." : "You logged it.",
    action: {
      kind: "log_time",
      payload: {
        goal_id: goal.id,
        start_at: iso(start),
        end_at: iso(end),
        ...(input.note ? { note: input.note } : {}),
      },
      involves_others: false,
      undo_until: iso(now + LOG_UNDO_MS),
    },
    source: "chat",
  });
  const week = await goalWeek(goal, start);
  return { entry, recommendation: rec, goal: week, message: lineFor(goal, week, "Logged.") };
}

/** The log entries that settle a block already, if any. */
async function settlementsOf(block: Event): Promise<Event[]> {
  const around = await store.listEvents({
    from: block.start_at,
    to: block.end_at ?? block.start_at,
    source: [LOG_SOURCE],
  });
  return around.filter((e) => isLogEntry(e) && e.data.event_id === block.id);
}

/** Did it (all, or `minutes` from its start) or Didn't (lost, with a reason) on a past goal block. */
export async function settleBlock(raw: unknown, via: LogVia, execute: Execute): Promise<LogTimeResponse> {
  const input = parse(SettleBlockInput, raw);
  const now = Date.now();
  const block = await store.getEvent(input.event_id);
  if (block?.type !== "calendar_event" || !block.end_at)
    throw new HttpError("not_found", "That block is not on the timeline");
  if (isOthers(block))
    throw new HttpError("conflict", "That block is with other people, so it is not goal time");
  const start = Date.parse(block.start_at);
  const end = Date.parse(block.end_at);
  if (start > now) throw new HttpError("conflict", "That block has not started yet");
  const goals = await store.listGoals();
  const match = goalForEvent(
    block,
    goals.filter((g) => g.active && goalKind(g) === "time"),
  );
  if (!match) throw new HttpError("bad_request", "That block is not tied to a goal");
  if ((await settlementsOf(block)).length > 0)
    throw new HttpError("conflict", "You already settled that block. Undo it first to change it");

  const goal = match.goal;
  const until = Math.min(end, now);
  const doneEnd = input.did && input.minutes ? Math.min(until, start + input.minutes * 60_000) : until;
  const minutes = Math.round((doneEnd - start) / 60_000);
  const z = zone();
  const title = input.did
    ? `Did ${block.title}, ${voiceShortDuration(minutes)} from ${z.clock(start)}`
    : `Didn't do ${block.title} at ${z.clock(start)}${input.reason ? `: ${input.reason}` : ""}`;
  const { rec, entry } = await carryOut(execute, {
    goal_id: goal.id,
    title,
    rationale:
      via === "chat" ? "You told me in chat." : via === "mcp" ? "Settled by an agent." : "You settled it.",
    action: {
      kind: "settle_block",
      payload: {
        event_id: block.id,
        goal_id: goal.id,
        did: input.did,
        start_at: iso(start),
        end_at: iso(input.did ? doneEnd : end),
        ...(input.reason ? { reason: input.reason } : {}),
      },
      involves_others: false,
      undo_until: iso(now + LOG_UNDO_MS),
    },
    source: "chat",
  });
  const week = await goalWeek(goal, start);
  return {
    entry,
    recommendation: rec,
    goal: week,
    message: lineFor(goal, week, input.did ? "Confirmed." : "Noted, counted as lost."),
  };
}
