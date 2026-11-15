import type Anthropic from "@anthropic-ai/sdk";
import {
  CheckInValue,
  type Event,
  IsoDateTime,
  type Recommendation,
  RitualEveningInput,
  RitualMorningInput,
} from "@michael/shared";
import { z } from "zod";
import { answerCheckIn } from "../checkin/service";
import { HttpError } from "../http";
import { forget, remember } from "../memory";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { logEvening, planMorning } from "../ritual/ritual";
import { goalBlockTitle } from "../score/match";
import { store } from "../store";
import { bookedLine, executeRecommendation, undoRecommendation } from "./calendar";
import { runWriteTool, WRITE_TOOLS } from "./chat-write-tools";
import { draftText, generateDrafts } from "./drafts";
import { guardMacApps } from "./mac-apps";
import { PROPOSAL_TOOLS, runProposalTool } from "./proposals";

// Tools the chat model can call so Michael acts, not only advises. Each action is a recommendation
// (source "chat") carried out by the same code as POST /v1/recommendations/:id/execute and undone by
// the same code as /undo, so it shows on Today and keeps every guard rail: only the user's own
// solo blocks, nothing that has started, undo until the block starts, never a delete of the user's
// own events.

const MAX_RANGE_MS = 8 * 24 * 3600_000;
const MAX_BLOCKS = 40;

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "find_calendar_blocks",
    description:
      "List calendar blocks between two times, with their ids and whether Michael may move them. Use it to find the event_id for move_calendar_block when the block is not listed for today, for example tomorrow's gym block. At most 8 days.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO 8601 start with offset, e.g. 2026-11-15T00:00:00+02:00" },
        to: { type: "string", description: "ISO 8601 end with offset" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "create_focus_block",
    description:
      "Put a new block on the user's own calendar, for example focus work, a gym session or a proper lunch. Only when the user asked for it or clearly agreed. The time must be in the future. It can be undone until it starts.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, e.g. 'Focus: pitch deck' or 'Gym'" },
        start_at: { type: "string", description: "ISO 8601 with offset" },
        end_at: { type: "string", description: "ISO 8601 with offset, after start_at" },
        goal_id: { type: "string", description: "Id of the goal this block serves, from the goals list" },
      },
      required: ["title", "start_at", "end_at"],
    },
  },
  {
    name: "move_calendar_block",
    description:
      "Move one of the user's own solo calendar blocks to a new time (the length is kept unless end_at is given), optionally renaming it. Refused for events with other people and for blocks that have started. It can be undone until the block starts.",
    input_schema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "The block's id, from today's list or find_calendar_blocks",
        },
        start_at: { type: "string", description: "New start, ISO 8601 with offset" },
        end_at: { type: "string", description: "New end, ISO 8601 with offset (optional)" },
        new_title: { type: "string", description: "New title (optional)" },
      },
      required: ["event_id", "start_at"],
    },
  },
  {
    name: "block_mac_app",
    description:
      "Close distracting apps on the user's Mac for a stretch of time, for example WhatsApp or Slack during a focus block. While it runs, the app is closed when it comes to the front and the user sees why. Only chat, social, music, video and game apps can be named (WhatsApp, Telegram, Messages, Slack, Discord, Mail, Instagram, X, Spotify, Music, TV, Netflix, Steam and similar). Only when the user asked for it or clearly agreed. It can be undone until it ends.",
    input_schema: {
      type: "object",
      properties: {
        apps: { type: "array", items: { type: "string" }, description: "App names, e.g. ['WhatsApp']" },
        start_at: { type: "string", description: "ISO 8601 with offset; now or later" },
        end_at: { type: "string", description: "ISO 8601 with offset, after start_at" },
        goal_id: { type: "string", description: "Id of the goal this protects, from the goals list" },
      },
      required: ["apps", "start_at", "end_at"],
    },
  },
  {
    name: "draft_follow_up",
    description:
      "Draft short follow up messages after the user's conversations and meetings with other people, from the summary and their own commitments, and save them under Follow ups for the user to copy. Nothing is ever sent. Without event_id it covers what ended in the last 24 hours. Use it when the user asks for a follow up, then show them the text.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "A conversation or meeting id (optional)" },
      },
    },
  },
  {
    name: "undo_action",
    description:
      "Take back something Michael did on the calendar or the Mac (a block he created or moved, or apps he muted), by its recommendation id from the list of things that can still be undone or from an earlier tool result.",
    input_schema: {
      type: "object",
      properties: { recommendation_id: { type: "string" } },
      required: ["recommendation_id"],
    },
  },
  {
    name: "answer_check_in",
    description:
      "Keep the user's answer to one of today's open check in questions (listed with a check_in_id in the context), when they answer it in chat. value is 'yes' or 'no' for a yes or no question, a number 1 to 5 for a scale, or the user's own words. Store only what the user actually said.",
    input_schema: {
      type: "object",
      properties: {
        check_in_id: { type: "string" },
        value: { description: "'yes', 'no', an integer 1 to 5, or the user's words" },
      },
      required: ["check_in_id", "value"],
    },
  },
  {
    name: "set_day_outcomes",
    description:
      'The morning plan: keep the one to three outcomes the user wants to get done today, in their own words, when they tell you ("my goals today are X and Y"). goal_id links an outcome to one of their goals when it clearly serves one (ids from the goals list); estimate_minutes only if they said how long. Outcomes already on today stay; three is the most.',
    input_schema: {
      type: "object",
      properties: {
        outcomes: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "The outcome in the user's words, at most 200 characters",
              },
              goal_id: { type: "string" },
              estimate_minutes: { type: "integer", minimum: 5, maximum: 720 },
            },
            required: ["text"],
          },
        },
      },
      required: ["outcomes"],
    },
  },
  {
    name: "log_day",
    description:
      "The evening log: record what the user says they got done of today's outcomes (listed with an item_id in the context), when they tell you (\"I finished X, did 30 min of Y\"). result is done, partly or not. carry: true continues an unfinished one tomorrow, only if they want that. minutes: time they did on it, which counts toward the outcome's goal. Only outcomes they spoke about; never tick one for them.",
    input_schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              item_id: { type: "string" },
              result: { type: "string", enum: ["done", "partly", "not"] },
              carry: { type: "boolean" },
              minutes: { type: "integer", minimum: 5, maximum: 720 },
            },
            required: ["item_id", "result"],
          },
        },
      },
      required: ["results"],
    },
  },
  {
    name: "remember",
    description:
      "Keep one lasting fact or preference the user told you about themselves, their routine or their goals, so you know it in every later conversation. One short line in the user's words, e.g. 'Trains best before 08:00'. Not one off plans and nothing about other people.",
    input_schema: {
      type: "object",
      properties: { fact: { type: "string", description: "One short line, at most 280 characters" } },
      required: ["fact"],
    },
  },
  {
    name: "forget_memory",
    description:
      "Forget one thing you remembered, when the user asks you to, by its memory_id from the context.",
    input_schema: {
      type: "object",
      properties: { memory_id: { type: "string" } },
      required: ["memory_id"],
    },
  },
  ...PROPOSAL_TOOLS,
  ...WRITE_TOOLS,
];

const RememberInput = z.object({ fact: z.string().min(1).max(1000) });
const ForgetInput = z.object({ memory_id: z.uuid() });

async function keep(input: unknown): Promise<ToolOutcome> {
  const p = RememberInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const m = await remember(p.data.fact, "chat");
  return m
    ? { content: `Remembered: ${m.text} (memory_id ${m.id}).`, isError: false }
    : { content: "Not kept: the user is off the record.", isError: true };
}

async function drop(input: unknown): Promise<ToolOutcome> {
  const p = ForgetInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return (await forget(p.data.memory_id))
    ? { content: "Forgotten.", isError: false }
    : { content: "No such memory.", isError: true };
}

/** What one answer has done so far, shared by its tool calls. */
export interface ChatTurnState {
  proposals: number;
}

const AnswerInput = z.object({ check_in_id: z.uuid(), value: CheckInValue });

async function answerQuestion(input: unknown): Promise<ToolOutcome> {
  const p = AnswerInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { check_in, follow_up } = await answerCheckIn(p.data.check_in_id, p.data.value);
  return {
    content:
      `Kept: ${check_in.question} Answer: ${String(check_in.answer)}.` +
      (follow_up
        ? ` Ask this follow up next, word for word: "${follow_up.question}" {check_in_id ${follow_up.id}}`
        : ""),
    isError: false,
  };
}

/** The morning plan from chat (#318): same rules as POST /v1/ritual/morning. */
async function setOutcomes(input: unknown): Promise<ToolOutcome> {
  const p = RitualMorningInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const day = await planMorning(p.data);
  const lines = day.items.map((i) => `- ${i.text} {item_id ${i.id}}`);
  return {
    content: `Kept today's outcomes (${day.items.length} of 3):\n${lines.join("\n")}`,
    isError: false,
  };
}

/** The evening log from chat (#318): same rules as POST /v1/ritual/evening. */
async function logDay(input: unknown): Promise<ToolOutcome> {
  const p = RitualEveningInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { summary } = await logEvening(p.data);
  return { content: `Logged. Tell the user this line, word for word: "${summary}"`, isError: false };
}

const FindInput = z.object({ from: IsoDateTime, to: IsoDateTime });
const CreateInput = z.object({
  title: z.string().trim().min(1).max(200),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  goal_id: z.string().nullish(),
});
const MoveInput = z.object({
  event_id: z.uuid(),
  start_at: IsoDateTime,
  end_at: IsoDateTime.nullish(),
  new_title: z.string().trim().min(1).max(200).nullish(),
});
const UndoInput = z.object({ recommendation_id: z.uuid() });
const DraftInput = z.object({ event_id: z.uuid().nullish() });
const GuardInput = z.object({
  apps: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  goal_id: z.string().nullish(),
});

export interface ToolOutcome {
  /** What the model reads back. */
  content: string;
  isError: boolean;
  /** The recommendation done or undone, for the reply's `actions` and the stream's `action` event. */
  action?: Recommendation;
  /** A finished line for the user ("Logged. 70.3 40 min of 9h this week. Undo"): chat may answer with it. */
  reply?: string;
}

const zone = () => new Zone(DEFAULT_TIMEZONE);
const clock = (iso: string) => zone().clock(Date.parse(iso));
const isOthers = (e: Event) => e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;
const earliest = (...isos: string[]) => new Date(Math.min(...isos.map((x) => Date.parse(x)))).toISOString();

/** "Undo until 15:00" for a done recommendation, or null without a deadline. */
export function undoLine(rec: Recommendation): string | null {
  // Logged time can be taken back for a day: the reply just offers it, the chip holds the button.
  if (rec.action?.kind === "log_time" || rec.action?.kind === "settle_block") return "Undo";
  const until = rec.action?.undo_until;
  return until ? `Undo until ${clock(until)}` : null;
}

function invalid(err: z.ZodError): ToolOutcome {
  const issues = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  return { content: `Invalid input: ${issues}`, isError: true };
}

/** Carries out a fresh chat recommendation; on refusal it is dismissed so Today does not offer it. */
async function carryOut(rec: Recommendation): Promise<ToolOutcome> {
  try {
    const done = await executeRecommendation(rec.id);
    return {
      content: `Done: ${done.title}. ${undoLine(done) ?? "No undo deadline"}. Recommendation id ${done.id}.`,
      isError: false,
      action: done,
    };
  } catch (err) {
    await store.updateRecommendationStatus(rec.id, "dismissed").catch(() => null);
    throw err;
  }
}

async function findBlocks(input: unknown): Promise<ToolOutcome> {
  const p = FindInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const from = Date.parse(p.data.from);
  const to = Math.min(Date.parse(p.data.to), from + MAX_RANGE_MS);
  if (to <= from) return { content: "`to` must be after `from`", isError: true };
  const events = await store.listEvents({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    type: ["calendar_event"],
  });
  const now = Date.now();
  const z = zone();
  const lines = events
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, MAX_BLOCKS)
    .map((e) => {
      const start = Date.parse(e.start_at);
      const when = `${z.dayOf(start)} ${z.clock(start)}${e.end_at ? ` to ${z.clock(Date.parse(e.end_at))}` : ""}`;
      const rule = isOthers(e)
        ? "with other people, advice only"
        : start <= now
          ? "already started"
          : "yours, can move";
      return `- ${when} ${e.title} (id ${e.id}; ${rule})`;
    });
  return { content: lines.length ? lines.join("\n") : "No calendar blocks in that range.", isError: false };
}

async function createBlock(input: unknown): Promise<ToolOutcome> {
  const p = CreateInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { start_at, end_at } = p.data;
  if (Date.parse(end_at) <= Date.parse(start_at))
    return { content: "end_at must be after start_at", isError: true };
  const goal = p.data.goal_id ? await store.getGoal(p.data.goal_id).catch(() => null) : null;
  // A bare "Study" for the University goal becomes "University": the block names its goal.
  const title = goal ? goalBlockTitle(goal, p.data.title) : p.data.title;
  const rec = await store.createRecommendation({
    goal_id: goal?.id ?? null,
    title: `${title}, ${clock(start_at)} to ${clock(end_at)}`,
    rationale: bookedLine(title, start_at, end_at),
    action: {
      kind: "create_focus_block",
      payload: { start_at, end_at, title, ...(goal ? { goal_id: goal.id } : {}) },
      involves_others: false,
      undo_until: start_at,
    },
    source: "chat",
  });
  return carryOut(rec);
}

async function moveBlock(input: unknown): Promise<ToolOutcome> {
  const p = MoveInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { event_id, start_at, end_at, new_title } = p.data;
  const event = await store.getEvent(event_id);
  if (!event) throw new HttpError("not_found", "That block is not on the timeline");
  const rec = await store.createRecommendation({
    goal_id: null,
    title: `Moved ${new_title ?? event.title} to ${clock(start_at)}`,
    rationale: "Asked for in chat.",
    action: {
      kind: "move_calendar_block",
      payload: {
        event_id,
        start_at,
        ...(end_at ? { end_at } : {}),
        ...(new_title ? { new_title } : {}),
      },
      // The executor refuses these with 409; the flag keeps the record honest.
      involves_others: isOthers(event),
      undo_until: earliest(event.start_at, start_at),
    },
    source: "chat",
  });
  return carryOut(rec);
}

async function guardApps(input: unknown): Promise<ToolOutcome> {
  const p = GuardInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const goalId = p.data.goal_id && z.uuid().safeParse(p.data.goal_id).success ? p.data.goal_id : null;
  const done = await guardMacApps({ ...p.data, goal_id: goalId, requested_by: "chat with Michael" });
  return {
    content: `Done: ${done.title}. ${undoLine(done) ?? "No undo deadline"}. Recommendation id ${done.id}.`,
    isError: false,
    action: done,
  };
}

async function undo(input: unknown): Promise<ToolOutcome> {
  const p = UndoInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const rec = await undoRecommendation(p.data.recommendation_id);
  return { content: `Undone: ${rec.title}.`, isError: false, action: rec };
}

async function draftFollowUp(input: unknown): Promise<ToolOutcome> {
  const p = DraftInput.safeParse(input ?? {});
  if (!p.success) return invalid(p.error);
  const { drafts, skipped } = await generateDrafts({ eventId: p.data.event_id ?? undefined });
  if (drafts.length)
    return {
      content: `Saved under Follow ups; nothing was sent.\n\n${drafts.map(draftText).join("\n\n")}`,
      isError: false,
    };
  return {
    content: skipped
      ? "Those already have drafts under Follow ups."
      : "No conversation or meeting with other people ended in the last 24 hours.",
    isError: false,
  };
}

/**
 * Runs one tool call. Guard rail refusals (HttpError, e.g. 409 for an event with other people)
 * come back as error results the model explains; anything else is a real failure and throws.
 */
export async function runChatTool(
  name: string,
  input: unknown,
  turn: ChatTurnState = { proposals: 0 },
): Promise<ToolOutcome> {
  try {
    if (name.startsWith("propose_")) {
      // One proposal per answer (#188): the user decides one change at a time.
      if (turn.proposals > 0)
        return { content: "One proposal per answer. Wait for the user.", isError: true };
      const outcome = await runProposalTool(name, input);
      if (!outcome) return { content: `Unknown tool ${name}`, isError: true };
      if (!outcome.isError) turn.proposals++;
      return outcome;
    }
    switch (name) {
      case "answer_check_in":
        return await answerQuestion(input);
      case "set_day_outcomes":
        return await setOutcomes(input);
      case "log_day":
        return await logDay(input);
      case "find_calendar_blocks":
        return await findBlocks(input);
      case "create_focus_block":
        return await createBlock(input);
      case "move_calendar_block":
        return await moveBlock(input);
      case "block_mac_app":
        return await guardApps(input);
      case "undo_action":
        return await undo(input);
      case "remember":
        return await keep(input);
      case "forget_memory":
        return await drop(input);
      case "draft_follow_up":
        return await draftFollowUp(input);
      default:
        return (await runWriteTool(name, input)) ?? { content: `Unknown tool ${name}`, isError: true };
    }
  } catch (err) {
    if (err instanceof HttpError) {
      const issues = Array.isArray(err.details)
        ? (err.details as { path?: unknown[]; message?: string }[])
            .map((i) => `${(i.path ?? []).join(".") || "input"}: ${i.message}`)
            .join("; ")
        : "";
      return {
        content: `Refused (${err.code}): ${err.message}${issues ? ` (${issues})` : ""}`,
        isError: true,
      };
    }
    throw err;
  }
}
