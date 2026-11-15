import type { AgentScope } from "@michael/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentsStore } from "./agents-store";
import { currentAgent } from "./context";
import { toInstant } from "./mcp-format";

// Michael for agents (#38) on MCP: every tool checks the calling agent's scopes and every call
// is logged ("who asked about me today"). Applied by wrapping registerTool, so a tool added to
// mcp.ts later is covered without touching this file. API key callers (our own tools) carry no
// agent and pass straight through.

/** Which scope a tool needs. Unlisted tools: read only ones need `timeline`, the rest `write_events`. */
// Changing the calendar or the timeline needs `write_events`; keeping goals needs `goals`;
// answering Michael's advice needs `recommendations`.
export const TOOL_SCOPE: Record<string, AgentScope> = {
  get_timeline: "timeline",
  get_patterns: "timeline",
  get_insights: "timeline",
  get_goals: "goals",
  get_instructions: "goals",
  propose_goals: "goals",
  add_goal: "goals",
  update_goal: "goals",
  get_checklist: "goals",
  add_checklist_item: "goals",
  // The daily ritual (#318): the day's outcomes are kept with the goals.
  set_day_outcomes: "goals",
  log_day: "goals",
  list_recommendations: "recommendations",
  update_recommendation: "recommendations",
  get_nudges: "recommendations",
  // Drafts are Michael's advice for the user to send themselves; nothing is sent or booked.
  list_drafts: "recommendations",
  draft_follow_up: "recommendations",
  get_score: "score",
  get_records: "score",
  get_moments: "score",
  get_week_review: "score",
  add_event: "write_events",
  execute_recommendation: "write_events",
  undo_recommendation: "write_events",
  create_focus_block: "write_events",
  block_mac_app: "write_events",
  // #457: removing one of the user's own blocks changes the day, with undo.
  remove_calendar_block: "write_events",
  change_calendar_block: "write_events",
  suggest_app_mute: "recommendations",
  plan_travel: "write_events",
  get_check_in: "timeline",
  get_memories: "timeline",
  what_you_know: "timeline",
  remember: "write_events",
  answer_check_in: "timeline",
  // Done time and settled blocks (#317) change the timeline and the score: the same scope as add_event.
  log_done: "write_events",
  confirm_block: "write_events",
  // Focus now (#397) books a block from this minute and may mute Mac apps: the same as booking.
  focus_now: "write_events",
};

type ToolConfig = { title?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } };

export const scopeFor = (name: string, config: ToolConfig): AgentScope =>
  TOOL_SCOPE[name] ?? (config.annotations?.readOnlyHint ? "timeline" : "write_events");

const hhmm = (value: unknown) => {
  const iso = typeof value === "string" ? instant(value) : null;
  return iso
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Athens",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso))
    : null;
};

// Tool times may be Europe/Athens wall time without an offset (mcp-format.ts).
function instant(value: string): string | null {
  try {
    return toInstant(value);
  } catch {
    return null;
  }
}

/**
 * One plain line for the Agents screen, in Michael's voice. Never the full payload. Written from
 * the input alone, so it says what the call does when it goes through; `logLine` turns it into
 * what happened once the call has finished.
 */
export function summarise(name: string, title: string | undefined, input: unknown): string {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const from = hhmm(a.from);
  const to = hhmm(a.to);
  const range = from && to ? ` from ${from} to ${to}` : from ? ` from ${from}` : "";
  switch (name) {
    case "get_timeline":
      return `Read your day${range}`;
    case "get_patterns":
      return `Read your patterns${range}`;
    case "get_insights":
      return "Read what I have learnt about you";
    case "get_check_in":
      return "Read your check in";
    case "what_you_know":
      return "Read what I know about you";
    case "answer_check_in":
      return "Kept an answer to your check in";
    case "log_done": {
      const what = typeof a.goal === "string" ? a.goal.slice(0, 60) : "a goal";
      return typeof a.minutes === "number" ? `Logged ${a.minutes} min of ${what}` : `Logged time for ${what}`;
    }
    case "confirm_block":
      return a.did === false ? "Marked a block as not done" : "Confirmed a block you did";
    case "focus_now": {
      const what = typeof a.goal === "string" ? a.goal.slice(0, 60) : "a goal";
      return typeof a.minutes === "number"
        ? `Started ${a.minutes} min of focus on ${what}`
        : `Started a focus session on ${what}`;
    }
    case "get_goals":
      return "Read your goals";
    case "get_instructions":
      return "Read your standing instructions";
    case "propose_goals":
      return "Read the goals your calendar suggests";
    case "list_recommendations":
      return "Read my advice";
    case "get_nudges":
      return "Read your nudges";
    case "list_drafts":
      return "Read your follow up drafts";
    case "draft_follow_up":
      return "Drafted a follow up for you to send";
    case "get_week_review":
      return "Read your week's review";
    case "get_moments":
      return a.kind === "evening" ? "Read your evening moment" : "Read your morning moment";
    case "add_goal":
      return typeof a.title === "string" ? `Added the goal "${a.title.slice(0, 80)}"` : "Added a goal";
    case "get_checklist":
      return typeof a.date === "string" ? `Read your outcomes for ${a.date}` : "Read today's outcomes";
    case "add_checklist_item":
      return typeof a.text === "string"
        ? `Added "${a.text.slice(0, 80)}" to your outcomes`
        : "Added an outcome";
    case "set_day_outcomes": {
      const n = Array.isArray(a.outcomes) ? a.outcomes.length : 0;
      return n === 1 ? "Set one outcome for today" : `Set ${n} outcomes for today`;
    }
    case "log_day":
      return "Logged what you got done today";
    case "update_goal":
      return a.active === false ? "Paused one of your goals" : "Changed one of your goals";
    case "update_recommendation":
      return a.status === "dismissed" ? "Dismissed my advice" : "Accepted my advice";
    case "execute_recommendation":
      return "Carried out my advice on your calendar";
    case "undo_recommendation":
      return "Undid a change on your calendar";
    case "remove_calendar_block":
      return "Removed one of your blocks";
    case "change_calendar_block":
      return "Changed one of your blocks";
    case "plan_travel":
      return `Planned your drives${range}`;
    case "create_focus_block": {
      const what = typeof a.title === "string" ? `"${a.title.slice(0, 80)}"` : "a focus block";
      const start = hhmm(a.start);
      return start ? `Booked ${what} for ${start}` : `Booked ${what}`;
    }
    case "block_mac_app": {
      const apps = Array.isArray(a.apps) ? a.apps.filter((x) => typeof x === "string").slice(0, 3) : [];
      const end = hhmm(a.end);
      const what = apps.length ? apps.join(", ") : "apps";
      return end ? `Muted ${what} on your Mac until ${end}` : `Muted ${what} on your Mac`;
    }
    case "suggest_app_mute":
      return "Suggested muting an app";
    case "get_score":
      return typeof a.date === "string" ? `Read your score for ${a.date}` : "Read your score";
    case "get_records":
      return "Read your personal records";
    case "get_memories":
      return "Read what you asked me to remember";
    case "remember":
      return typeof a.fact === "string" ? `Remembered "${a.fact.slice(0, 80)}"` : "Remembered something";
    case "add_event":
      return typeof a.title === "string"
        ? `Added "${a.title.slice(0, 80)}" to your day`
        : "Added to your day";
    default:
      return title ?? name;
  }
}

// ---------- what happened: the line is written from the outcome, not from the input ----------

/** What a finished call did. `changed` is null for a tool that only reads. */
export interface Outcome {
  changed: boolean | null;
  /** Set when the call did not do what it asked: why, in a few words, with no names in it. */
  failed: { how: "Refused" | "Nothing changed" | "Failed"; reason: string } | null;
}

type ToolResult = {
  isError?: boolean;
  content?: { type?: string; text?: unknown }[];
  structuredContent?: Record<string, unknown>;
};

// The refusals an agent meets most, in a few words. Anything else falls back to the first
// sentence of the tool's own answer, cut before a title or a list (the line is never the payload).
const REASONS: [RegExp, string][] = [
  [/already started/i, "already started"],
  [/already ended/i, "already ended"],
  [/has not (happened|started) yet/i, "not started yet"],
  [/overlaps .*other people/i, "it overlaps an event with other people"],
  [/other people|someone else/i, "other people are in it"],
  [/^validation failed|^use yyyy/i, "the request was not valid"],
  [/^no goal called/i, "no goal by that name"],
  [/^not allowed/i, "not shared"],
];

/** A tool's refusal in a few words: "already started", "Sundays are kept clear". */
export function shortReason(text: string): string {
  const said = text.trim();
  for (const [pattern, reason] of REASONS) if (pattern.test(said)) return reason;
  // The first sentence, cut before a quoted title or a list ("Your goals: ..."), never inside 21:00.
  const first = (said.split(/(?<=[.?])\s|\n/)[0] ?? "").split(/["“]|:\s/)[0] ?? "";
  const words = first
    .replace(/[.,;:\s]+$/, "")
    .replace(/[\u2010-\u2015!]|\s-\s/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10)
    .join(" ");
  if (!words) return "it did not go through";
  // Michael's own "I" and a weekday keep their capital; a plain sentence start does not.
  return /^(I\b|I'|[A-Z][a-z]+days\b)/.test(words) ? words : words.charAt(0).toLowerCase() + words.slice(1);
}

/** A result that is no error and still changed nothing, by tool: why, or null when it did its job. */
function nothingChanged(name: string, s: Record<string, unknown>): string | null {
  switch (name) {
    case "add_event":
      if (s.inserted !== 0) return null;
      return s.ignored ? "that source is off, or you are off the record" : "already on your timeline";
    case "remember":
      return s.memory === null ? "you are off the record" : null;
    case "suggest_app_mute":
      return s.recommendation ? null : "no app stands out";
    case "draft_follow_up":
      if (!Array.isArray(s.drafts) || s.drafts.length > 0) return null;
      return s.skipped ? "those already have drafts" : "nothing to follow up";
    case "plan_travel":
      return s.status === "maps_unavailable"
        ? "maps could not be reached"
        : s.status === "travel_off"
          ? "travel is switched off"
          : null;
    default:
      return null;
  }
}

/**
 * What the call did, read from its result (`threw`: the tool crashed instead of answering). A read
 * changes nothing either way; a write counts as a change only when it went through.
 */
export function outcomeOf(name: string, readOnly: boolean, result: unknown, threw = false): Outcome {
  const r = (result && typeof result === "object" ? result : {}) as ToolResult;
  let failed: Outcome["failed"] = null;
  if (threw || result === undefined) failed = { how: "Failed", reason: "an error on my side" };
  else if (r.isError) {
    const said = (r.content ?? []).map((c) => (typeof c.text === "string" ? c.text : "")).join(" ");
    failed = { how: "Refused", reason: shortReason(said) };
  } else if (!readOnly) {
    const why = nothingChanged(name, r.structuredContent ?? {});
    if (why) failed = { how: "Nothing changed", reason: why };
  }
  return { changed: readOnly ? null : failed === null, failed };
}

// The first word of every summary above, and how it reads after "Tried to".
const INFINITIVE: Record<string, string> = {
  Read: "read",
  Kept: "keep",
  Logged: "log",
  Marked: "mark",
  Confirmed: "confirm",
  Drafted: "draft",
  Added: "add",
  Set: "set",
  Paused: "pause",
  Changed: "change",
  Dismissed: "dismiss",
  Accepted: "accept",
  Carried: "carry",
  Undid: "undo",
  Planned: "plan",
  Booked: "book",
  Muted: "mute",
  Suggested: "suggest",
  Remembered: "remember",
  Removed: "remove",
  Started: "start",
};

/** Every line that tells of a call that did not go through starts with this. */
export const TRIED = "Tried to ";

/**
 * The line that is logged: the summary when the call did what it says, else what was tried and
 * why it did not happen. `Tried to book "Past" for Sun 00:30. Refused: already started.`
 */
export function logLine(summary: string, outcome: Outcome): string {
  if (!outcome.failed) return summary;
  const verb = /^[A-Za-z]+/.exec(summary)?.[0] ?? "";
  const to = INFINITIVE[verb];
  const tried = to ? `${to}${summary.slice(verb.length)}` : `use ${summary}`;
  return `${TRIED}${tried}. ${outcome.failed.how}: ${outcome.failed.reason}.`;
}

const SCOPE_WORDS: Record<AgentScope, string> = {
  timeline: "their day",
  goals: "their goals",
  recommendations: "Michael's advice",
  score: "their score",
  write_events: "adding to their day",
};

type Callback = (...args: unknown[]) => unknown;

/** Tools whose change the user can undo from the Agents screen. */
export const UNDOABLE_TOOLS = new Set([
  "execute_recommendation",
  "create_focus_block",
  "block_mac_app",
  "remove_calendar_block",
  "change_calendar_block",
  "log_done",
  "confirm_block",
]);

/** The recommendation an undoable tool's successful result carries, if any. */
export function changedRecommendation(name: string, result: unknown): string | null {
  if (!UNDOABLE_TOOLS.has(name) || !result || typeof result !== "object") return null;
  const r = result as { isError?: boolean; structuredContent?: { recommendation?: { id?: unknown } } };
  if (r.isError) return null;
  const id = r.structuredContent?.recommendation?.id;
  return typeof id === "string" ? id : null;
}

export function guardTools(server: McpServer): void {
  const register = server.registerTool.bind(server) as unknown as (
    n: string,
    c: ToolConfig,
    cb: Callback,
  ) => unknown;
  const guarded = (name: string, config: ToolConfig, cb: Callback) =>
    register(name, config, async (...args: unknown[]) => {
      const agent = currentAgent();
      if (!agent) return cb(...args);
      const scope = scopeFor(name, config);
      const allowed = agent.status === "approved" && agent.scopes.includes(scope);
      const input = config.inputSchema ? args[0] : undefined;
      const readOnly = config.annotations?.readOnlyHint === true;
      const summary = summarise(name, config.title, input);
      const log = async (line: string, changed: boolean | null, recommendation_id: string | null) => {
        try {
          await agentsStore.logQuery({
            agent_id: agent.id,
            tool: name,
            summary: line,
            allowed,
            changed,
            recommendation_id,
          });
        } catch (err) {
          console.error("agent query log failed", err);
        }
      };
      if (!allowed) {
        // Not shared: the line stays what was asked for, and nothing changed.
        await log(summary, readOnly ? null : false, null);
        const why =
          agent.status === "approved"
            ? `The user has not shared ${SCOPE_WORDS[scope]} with ${agent.name}.`
            : `${agent.name} is not approved yet.`;
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Not allowed. ${why} They can change this in Michael, under Agents.`,
            },
          ],
        };
      }
      // Allowed calls are logged once they finish, from what happened: a booking Michael refused
      // reads as tried and refused, and only a call that changed something counts as a change. A
      // change carries the recommendation that holds it, so the Agents screen can offer Undo.
      let result: unknown;
      let threw = false;
      try {
        result = await cb(...args);
        return result;
      } catch (err) {
        threw = true;
        throw err;
      } finally {
        const outcome = outcomeOf(name, readOnly, result, threw);
        await log(
          logLine(summary, outcome),
          outcome.changed,
          outcome.changed ? changedRecommendation(name, result) : null,
        );
      }
    });
  (server as unknown as { registerTool: typeof guarded }).registerTool = guarded;
}
