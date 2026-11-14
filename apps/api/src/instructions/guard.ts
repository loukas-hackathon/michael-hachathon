import type { ActionKind, Event, Instruction, RecommendationAction } from "@michael/shared";
import { HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import type { Zone } from "../patterns/time";
import { forbiddenBy, protectedBy, refusalReason } from "./protected";

// THE guard between Michael and the time a standing instruction protects. A standing instruction
// is a rule Michael obeys everywhere, not only a flag on the score: no path may create, move or
// propose a block inside protected time, and nothing may be carried out there.
//
// `checkAction` is pure: an action (kind, where it would land, the block's title) and the user's
// instructions in, allowed or the instruction that forbids it out. The rules:
//
//   create_focus_block, move_calendar_block  refused when the time they land on is protected and
//                                            the block's title is not one of that instruction's
//                                            exceptions. Only where the block lands counts, so
//                                            moving a block OUT of protected time is allowed.
//   block_mac_app                            allowed: it protects the time, it plans nothing.
//   draft_follow_up                          allowed: not planning.
//   reminder                                 allowed, except inside quiet_hours.
//   custom instructions                      never refuse anything (they protect no time).
//
// `guardRecommendation` is the one choke point every new recommendation passes through: both
// stores call it in `createRecommendation` and `saveAnalysis`, so the analysis, the travel rules,
// the chat tools and the MCP booking are all covered without a call of their own. The execute
// route calls `refusalFor` again before it acts, for an instruction added after the
// recommendation was made. The moments (which propose moves without storing them) call
// `allowedMove`.

/** An action as the guard sees it: its kind, the span it lands on, the block's title. */
export interface PlannedAction {
  kind: ActionKind;
  /** Where the block (or the reminder) lands. Null when the action has no time. */
  start: string | number | null;
  end: string | number | null;
  /** The calendar title of the block it creates or moves, for the exceptions. */
  title: string | null;
}

export type Verdict = { allowed: true } | { allowed: false; instruction: Instruction; reason: string };

const ALLOWED: Verdict = { allowed: true };

/** Allowed, or the first instruction that forbids the action with Michael's one line reason. */
export function checkAction(
  action: PlannedAction,
  instructions: Instruction[],
  timezone: string | Zone = DEFAULT_TIMEZONE,
): Verdict {
  if (action.start === null) return ALLOWED;
  const start = action.start;
  const end = action.end ?? action.start;
  let hit: Instruction | undefined;
  switch (action.kind) {
    case "create_focus_block":
    case "move_calendar_block":
      hit = forbiddenBy(instructions, action.title, start, end, timezone)[0];
      break;
    case "reminder":
      hit = protectedBy(instructions, start, start, timezone).find((i) => i.kind === "quiet_hours");
      break;
    default:
      // block_mac_app guards the time; draft_follow_up is not planning.
      return ALLOWED;
  }
  return hit ? { allowed: false, instruction: hit, reason: refusalReason(hit) } : ALLOWED;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const instant = (v: unknown): string | null => {
  const t = text(v);
  return t && Number.isFinite(Date.parse(t)) ? t : null;
};

/**
 * A stored action's payload as a PlannedAction. A move reads the block it moves (`getEvent`) for
 * its length and title. Null when there is nothing to place in time (a move of a block that is
 * gone, a payload without times).
 */
export async function plannedAction(
  action: RecommendationAction,
  getEvent: (id: string) => Promise<Event | null>,
): Promise<PlannedAction | null> {
  const p = action.payload;
  switch (action.kind) {
    case "create_focus_block": {
      const start = instant(p.start_at);
      // The executor names an untitled block "Focus block".
      return start
        ? { kind: action.kind, start, end: instant(p.end_at), title: text(p.title) ?? "Focus block" }
        : null;
    }
    case "move_calendar_block": {
      const id = text(p.event_id);
      const event = id ? await getEvent(id).catch(() => null) : null;
      if (!event) return null;
      // As the executor does it: a new start keeps the length unless an end is given.
      const length =
        (event.end_at ? Date.parse(event.end_at) : Date.parse(event.start_at)) - Date.parse(event.start_at);
      const newStart = instant(p.start_at);
      const start = newStart ?? event.start_at;
      const end =
        instant(p.end_at) ??
        (newStart ? new Date(Date.parse(newStart) + length).toISOString() : event.end_at);
      return { kind: action.kind, start, end, title: text(p.new_title) ?? event.title };
    }
    case "reminder": {
      const at = instant(p.at);
      return at ? { kind: action.kind, start: at, end: at, title: null } : null;
    }
    default:
      return { kind: action.kind, start: null, end: null, title: null };
  }
}

export interface GuardDeps {
  instructions: Instruction[];
  getEvent: (id: string) => Promise<Event | null>;
  timezone?: string;
}

/** The verdict on a stored action, against the user's instructions as they are now. */
export async function refusalFor(action: RecommendationAction, deps: GuardDeps): Promise<Verdict> {
  const active = deps.instructions.filter((i) => i.active);
  if (active.length === 0) return ALLOWED;
  const planned = await plannedAction(action, deps.getEvent);
  return planned ? checkAction(planned, active, deps.timezone ?? DEFAULT_TIMEZONE) : ALLOWED;
}

type Log = (entry: Record<string, unknown>) => void;
const defaultLog: Log = (entry) => console.log(JSON.stringify(entry));

/**
 * The choke point for a new recommendation. An allowed one comes back as it is. A refused one
 * keeps its advice (title and rationale untouched) and loses its action, and the refusal is
 * logged. A recommendation asked for in chat (`source: "chat"`) is an order carried out at once:
 * without its action it would be nothing, so it is refused with 409 and the reason instead, and
 * the chat or the agent tells the user "Sundays are kept clear."
 */
export async function guardRecommendation<
  R extends { action: RecommendationAction | null; source?: string | null },
>(rec: R, deps: GuardDeps & { log?: Log }): Promise<R> {
  if (!rec.action) return rec;
  // The user's own change on the Timeline (#271): their instructions bind Michael, not them.
  if (rec.source === "user") return rec;
  const verdict = await refusalFor(rec.action, deps);
  if (verdict.allowed) return rec;
  (deps.log ?? defaultLog)({
    event: "instruction_guard_refused",
    action_kind: rec.action.kind,
    instruction_id: verdict.instruction.id,
    instruction_kind: verdict.instruction.kind,
    reason: verdict.reason,
    source: rec.source ?? "analysis",
  });
  if (rec.source === "chat") throw new HttpError("conflict", verdict.reason);
  return { ...rec, action: null };
}

/** The same for several at once (an analysis run); the instructions are read once by the caller. */
export function guardRecommendations<
  R extends { action: RecommendationAction | null; source?: string | null },
>(recs: R[], deps: GuardDeps & { log?: Log }): Promise<R[]> {
  return Promise.all(recs.map((r) => guardRecommendation(r, deps)));
}

/**
 * For a proposal that is not stored as a recommendation (a Morning or Evening move): true when a
 * move of this kind over [start, end) is allowed. A move with no time is allowed.
 */
export function allowedMove(
  move: { action_kind: ActionKind | null; start_at: string | null; end_at: string | null },
  instructions: Instruction[],
  timezone: string | Zone = DEFAULT_TIMEZONE,
): boolean {
  if (!move.action_kind || !move.start_at) return true;
  const active = instructions.filter((i) => i.active);
  return checkAction(
    { kind: move.action_kind, start: move.start_at, end: move.end_at, title: null },
    active,
    timezone,
  ).allowed;
}
