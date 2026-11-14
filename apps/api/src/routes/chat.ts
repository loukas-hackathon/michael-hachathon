import Anthropic from "@anthropic-ai/sdk";
import {
  type ApiError,
  type ChatHistory,
  type ChatMessage,
  ChatRequest,
  type ChatResponse,
  type Event,
  type Goal,
  goalArea,
  type Instruction,
  MICHAEL_VOICE,
  type PatternReport,
  type Recommendation,
  type Score,
  voiceDuration,
} from "@michael/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { CHAT_TOOLS, runChatTool, undoLine } from "../actions/chat-tools";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { patternReportFor } from "./patterns";
import { scoreFor } from "./score";

// How many earlier lines Michael sees, and how many GET /v1/chat returns.
const HISTORY_TURNS = 20;
const HISTORY_MAX = 100;
// Lines of today's timeline handed to the model. A day has thousands of app events; those go in as
// totals, not lines.
const MAX_TODAY_LINES = 40;
const WEEK_MS = 7 * 24 * 3600_000;

// Event types listed one per line. App, web and AI detail arrive as totals from the pattern report;
// conversations and memories stay out entirely (privacy: send summaries, never other people's words).
const LISTED_TYPES = new Set<Event["type"]>([
  "calendar_event",
  "workout",
  "sleep",
  "meal",
  "focus_session",
  "recovery",
  "note",
]);
// Types totalled over the week so Michael can talk budgets.
const WEEK_TYPES = ["workout", "sleep", "focus_session", "meal"] as const;

const SYSTEM_PROMPT = `${MICHAEL_VOICE}

In this chat:
- Short answers: two to five sentences unless the user asks for detail.
- Show the maths when you use a number ("2h 10 of 9h this week").
- When you suggest a change, make it concrete and tie it to a goal: what, when, how long.

Facts:
- Use only the context below about the user's day, goals and patterns. If the data does not say, say so; never invent numbers or events.
- For goal progress and budgets, quote the score figures exactly as given; they are the same numbers the app shows.
- Quote times and ids only from the context or from tool results.

Acting:
- You act only on the user's own time: you can add a block to their calendar (create_focus_block), move one of their own solo blocks (move_calendar_block), close distracting apps on their Mac for a while (block_mac_app) and take back something you did (undo_action). On everything else you advise.
- Act when the user asks you to, or clearly agrees to a change you proposed. If the time or the block is unclear, ask first instead of guessing.
- You never touch events with other people, never delete the user's events, and never send anything in the user's name. If a tool refuses, say why in one line and offer advice instead.
- Never claim you did something unless a tool result says it is done.
- After acting, say in one or two short sentences what you did, with times, and end with the undo line exactly as the tool gave it, e.g. "Undo until 15:00."
- Times you pass to tools are ISO 8601 with the user's UTC offset, as in "Now (ISO)" below.`;

/** "2026-11-14T19:05:00+02:00": the instant as the user's wall clock with its UTC offset. */
function isoIn(zone: Zone, ms: number): string {
  const offset = zone.offsetAt(ms);
  const wall = new Date(Math.floor(ms / 1000) * 1000 + offset).toISOString().slice(0, 19);
  const m = Math.abs(offset) / 60_000;
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${wall}${offset < 0 ? "-" : "+"}${pad(m / 60)}:${pad(m % 60)}`;
}

const minutes = (ms: number) => Math.round(ms / 60_000);
// Durations the voice sheet way, so the model copies the same format: "47 minutes", "2h 15".
const hm = (totalMinutes: number) => voiceDuration(totalMinutes);

export interface ChatContextInput {
  now: number;
  timezone?: string;
  goals: Goal[];
  /** The user's standing instructions. Paused ones are left out. */
  instructions?: Instruction[];
  /** Events from the start of the week window to now. */
  events: Event[];
  today: PatternReport | null;
  week: PatternReport | null;
  /** The week's score as GET /v1/score gives it; null when it could not be built. */
  score?: Score | null;
  /** Things Michael did that can still be undone (status done, undo deadline ahead). */
  undoable?: Recommendation[];
}

const pct = (p: number | null) => (p === null ? "no score yet" : `${Math.round(p)}%`);

/**
 * The score in words, with every figure as the score has it, so Michael quotes the same maths as
 * the Today and Goals screens.
 */
export function scoreLines(s: Score): string {
  const lines = [
    `Score this week (Monday to Sunday, so far): ${pct(s.score_pct)} of planned goal time spent. ` +
      `${hm(s.spent_minutes)} spent of ${hm(s.elapsed_minutes)} planned time already passed; ` +
      `${hm(s.lost_minutes)} lost, ${hm(s.ahead_minutes)} still ahead, ${hm(s.planned_minutes)} planned in total. ` +
      `Time won back this week: ${hm(s.time_won_back_minutes)}.`,
  ];
  const goals = s.goals.map((g) => {
    const budget = g.budget_minutes ? `budget ${hm(g.budget_minutes)}` : "no budget";
    if (!g.scored)
      return `- ${g.title} [${g.area}]: ${budget}, a ${g.kind} goal, not scored from calendar blocks`;
    const left = Math.max(0, g.budget_minutes - g.spent_minutes);
    return (
      `- ${g.title} [${g.area}]: ${hm(g.spent_minutes)} spent of ${budget}` +
      (g.budget_minutes ? ` (${hm(left)} left to reach it)` : "") +
      `; ${hm(g.planned_minutes)} planned in the calendar, ${hm(g.lost_minutes)} lost, ` +
      `${hm(g.ahead_minutes)} planned still ahead; ${pct(g.score_pct)}`
    );
  });
  if (goals.length) lines.push(`Goals this week:\n${goals.join("\n")}`);
  const d = s.day;
  if (d.planned_minutes > 0) {
    const lost = d.blocks
      .flatMap((b) => b.lost)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 3)
      .map((l) => `${l.what} ${hm(l.minutes)}`);
    lines.push(
      `Score today: ${pct(d.score_pct)}, ${hm(d.spent_minutes)} spent of ${hm(d.elapsed_minutes)} passed ` +
        `(${hm(d.planned_minutes)} planned, ${hm(d.lost_minutes)} lost, ${hm(d.ahead_minutes)} ahead). ` +
        `Time won back today: ${hm(d.time_won_back.minutes)}.` +
        (lost.length ? ` Biggest losses inside goal blocks: ${lost.join(", ")}.` : ""),
    );
  }
  return lines.join("\n\n");
}

/**
 * The summary Michael answers from. Pure: same input, same text. Raw events never leave the API
 * whole; only titles of the user's own calendar, workout, sleep and meal entries, plus totals.
 */
export function buildChatContext(input: ChatContextInput): string {
  const zone = new Zone(input.timezone ?? DEFAULT_TIMEZONE);
  const { now } = input;
  const day = zone.dayOf(now);
  const dayStart = zone.startOfDay(day);
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone.name,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const parts: string[] = [
    `Now: ${weekday}, ${zone.clock(now)} (${zone.name}). Now (ISO): ${isoIn(zone, now)}.`,
  ];

  const active = input.goals.filter((g) => g.active);
  parts.push(
    active.length
      ? `Goals:\n${active
          .map((g) => {
            const budget = g.weekly_budget_minutes ? `, ${hm(g.weekly_budget_minutes)} a week planned` : "";
            const why = g.description ? ` (${g.description})` : "";
            // The one of the three categories: an older `work` goal reads as business.
            return `- ${g.title} [${goalArea(g.category)}${budget}]${why} {goal_id ${g.id}}`;
          })
          .join("\n")}`
      : "Goals: none set yet.",
  );

  // The user's ground rules, in their own words. They are not goals.
  const rules = (input.instructions ?? []).filter((i) => i.active);
  if (rules.length > 0) {
    parts.push(
      `Standing instructions (never plan, move or suggest anything inside the time they protect):\n${rules
        .map((i) => `- ${i.text}`)
        .join("\n")}`,
    );
  }

  const todayLines = input.events
    .filter((e) => LISTED_TYPES.has(e.type))
    .filter((e) => {
      const start = Date.parse(e.start_at);
      const end = e.end_at ? Date.parse(e.end_at) : start;
      // Today's events, including planned ones later today and last night's sleep.
      return end >= dayStart && start < zone.startOfDay(zone.nextDay(day));
    })
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, MAX_TODAY_LINES)
    .map((e) => {
      const start = Date.parse(e.start_at);
      const end = e.end_at ? Date.parse(e.end_at) : null;
      const when = end ? `${zone.clock(start)} to ${zone.clock(end)}` : zone.clock(start);
      const planned = start > now ? " (planned)" : "";
      // Ids only where Michael may act: the user's own blocks that have not started.
      const others = e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;
      const tag =
        e.type !== "calendar_event" || start <= now
          ? ""
          : others
            ? " [with other people, advice only]"
            : ` {event_id ${e.id}}`;
      return `- ${when} ${e.type.replace("_", " ")}: ${e.title}${planned}${tag}`;
    });
  parts.push(
    todayLines.length
      ? `Today:\n${todayLines.join("\n")}`
      : "Today: no calendar, workout, sleep or meal entries.",
  );

  const totals = input.today?.time_by_app.data?.totals;
  if (totals && totals.active_seconds > 0) {
    const cats = totals.by_category
      .filter((c) => c.seconds >= 60)
      .slice(0, 6)
      .map((c) => `${c.category} ${hm(c.seconds / 60)}`)
      .join(", ");
    const apps = totals.apps
      .slice(0, 5)
      .map((a) => `${a.subject.name} ${hm(a.seconds / 60)}`)
      .join(", ");
    parts.push(
      `Screen time today: ${hm(totals.active_seconds / 60)} (Mac ${hm(totals.mac_seconds / 60)}, iPhone ${hm(totals.iphone_seconds / 60)}).` +
        (cats ? ` By category: ${cats}.` : "") +
        (apps ? ` Top apps: ${apps}.` : ""),
    );
  }

  const weekStart = now - WEEK_MS;
  const weekLines = WEEK_TYPES.flatMap((type) => {
    const list = input.events.filter(
      (e) => e.type === type && Date.parse(e.start_at) >= weekStart && Date.parse(e.start_at) <= now,
    );
    if (!list.length) return [];
    const total = list.reduce(
      (sum, e) => sum + (e.end_at ? Math.max(0, Date.parse(e.end_at) - Date.parse(e.start_at)) : 0),
      0,
    );
    return [`- ${type.replace("_", " ")}: ${list.length} entries, ${hm(minutes(total))} in total`];
  });
  if (input.score) parts.push(scoreLines(input.score));
  if (weekLines.length) parts.push(`Last 7 days:\n${weekLines.join("\n")}`);

  const undoable = (input.undoable ?? []).flatMap((r) =>
    r.action?.undo_until && Date.parse(r.action.undo_until) > now
      ? [
          `- ${r.title}, undo until ${zone.clock(Date.parse(r.action.undo_until))} {recommendation_id ${r.id}}`,
        ]
      : [],
  );
  if (undoable.length) parts.push(`Things I did that can still be undone:\n${undoable.join("\n")}`);

  const headlines = (label: string, r: PatternReport | null) =>
    r?.headlines.length ? [`${label}:\n${r.headlines.map((h) => `- ${h}`).join("\n")}`] : [];
  parts.push(
    ...headlines("Patterns today", input.today),
    ...headlines("Patterns over the last 7 days", input.week),
  );

  return parts.join("\n\n");
}

async function contextForNow(): Promise<string> {
  const now = Date.now();
  const zone = new Zone(DEFAULT_TIMEZONE);
  const dayStart = zone.startOfDay(zone.dayOf(now));
  const dayEnd = zone.startOfDay(zone.nextDay(zone.dayOf(now)));
  const nowIso = new Date(now).toISOString();
  // Pattern reports are best effort: a detector failing must not take the chat down.
  const report = (from: string) => patternReportFor({ from, to: nowIso }).catch(() => null);
  const [goals, instructions, events, today, week, score, undoable] = await Promise.all([
    store.listGoals(),
    store.listInstructions().catch(() => []),
    store.listEvents({
      from: new Date(now - WEEK_MS).toISOString(),
      to: new Date(dayEnd).toISOString(),
      type: [...LISTED_TYPES],
    }),
    now - dayStart > 60_000 ? report(new Date(dayStart).toISOString()) : Promise.resolve(null),
    report(new Date(now - WEEK_MS).toISOString()),
    scoreFor({ now: nowIso }).catch((err) => {
      console.error("chat: score failed", err);
      return null;
    }),
    store.listRecommendations({ status: "done" }).catch(() => []),
  ]);
  return buildChatContext({ now, goals, instructions, events, today, week, score, undoable });
}

let client: Anthropic | null = null;
/** Tests only: answer with a stand in for Claude. */
export function setChatClientForTests(fake: Anthropic | null) {
  client = fake;
}
function anthropic(): Anthropic {
  if (client) return client;
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError("unavailable", "Chat is not set up yet: the API has no ANTHROPIC_API_KEY");
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

const REFUSAL = "I can't help with that one. Ask me about your day or your goals.";
// Model calls per answer: room to look a block up, act, and then say what was done.
const MAX_ROUNDS = 5;

function request(messages: Anthropic.MessageParam[], context: string, lastRound: boolean) {
  return {
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4000,
    // Chat is latency sensitive and the answers are short.
    output_config: { effort: "low" as const },
    system: [
      // Stable prompt first so it can be cached; the per-request context comes after.
      { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: `What I know about the user right now:\n\n${context}` },
    ],
    tools: CHAT_TOOLS,
    // The last round must answer in words, not call another tool.
    tool_choice: lastRound ? { type: "none" as const } : { type: "auto" as const },
    messages,
  };
}

function upstream(err: unknown): unknown {
  return err instanceof Anthropic.APIError
    ? new HttpError("upstream_error", `Claude failed (${err.status ?? "network"}): ${err.message}`)
    : err;
}

const textOf = (response: Anthropic.Message) =>
  response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();

export interface MichaelAnswer {
  answer: string;
  /** Recommendations done or undone while answering, in order. */
  actions: Recommendation[];
}

interface Hooks {
  /** Streams text as it is written; without it the model is called without streaming. */
  onText?: (text: string) => Promise<void>;
  onAction?: (action: Recommendation) => Promise<void>;
}

/** One model call: streamed piece by piece when `onText` is given. */
async function callModel(
  messages: Anthropic.MessageParam[],
  context: string,
  lastRound: boolean,
  onText: Hooks["onText"],
): Promise<Anthropic.Message> {
  try {
    if (!onText) return await anthropic().messages.create(request(messages, context, lastRound));
    const stream = anthropic().messages.stream(request(messages, context, lastRound));
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        await onText(event.delta.text);
      }
    }
    return await stream.finalMessage();
  } catch (err) {
    throw upstream(err);
  }
}

/**
 * Michael's answer, acting through the chat tools when asked. Tools run here, server side; the
 * caller sees text (and, when streaming, each action as it lands). The answer always ends with the
 * undo deadline of what was done, even if the model forgot to say it.
 */
export async function askMichael(
  turns: Anthropic.MessageParam[],
  context: string,
  hooks: Hooks = {},
): Promise<MichaelAnswer> {
  const messages = [...turns];
  const texts: string[] = [];
  const actions: Recommendation[] = [];
  let wrote = false;
  // Text from a later round starts a new paragraph in the stream too.
  const onText = hooks.onText
    ? async (text: string) => {
        if (!wrote && texts.length) await hooks.onText?.("\n\n");
        wrote = true;
        await hooks.onText?.(text);
      }
    : undefined;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    wrote = false;
    const response = await callModel(messages, context, round === MAX_ROUNDS - 1, onText);
    if (response.stop_reason === "refusal") {
      texts.push(REFUSAL);
      break;
    }
    const text = textOf(response);
    if (text) texts.push(text);
    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || calls.length === 0) break;

    // Hand the whole turn back unchanged (thinking blocks included), then every result in one turn.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      const outcome = await runChatTool(call.name, call.input);
      if (outcome.action) {
        actions.push(outcome.action);
        await hooks.onAction?.(outcome.action);
      }
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }

  let answer = texts.join("\n\n").trim();
  const done = actions.filter((a) => a.status === "done");
  const missing = done.flatMap((a) => {
    const line = undoLine(a);
    return line && !answer.includes(line) ? [`${line}.`] : [];
  });
  if (!answer && done.length) answer = `Done: ${done.map((a) => a.title).join("; ")}.`;
  if (missing.length) {
    const tail = [...new Set(missing)].join(" ");
    await hooks.onText?.(answer ? ` ${tail}` : tail);
    answer = answer ? `${answer} ${tail}` : tail;
  }
  if (!answer) {
    if (actions.length) answer = `Undone: ${actions.map((a) => a.title).join("; ")}.`;
    else throw new HttpError("upstream_error", "Claude returned an empty answer");
  }
  return { answer, actions };
}

/** Everything both POST routes need before the model is called. */
async function prepare(body: unknown) {
  const { message } = parse(ChatRequest, body);
  // Fail before storing anything when chat is not configured.
  anthropic();
  const [earlier, context] = await Promise.all([store.listChatMessages(HISTORY_TURNS), contextForNow()]);
  const turns: Anthropic.MessageParam[] = [...toTurns(earlier), { role: "user", content: message }];
  return { message, turns, context };
}

async function save(message: string, { answer, actions }: MichaelAnswer): Promise<ChatResponse> {
  const stored = await store.addChatMessage("user", message);
  const reply = await store.addChatMessage("assistant", answer);
  return { message: stored, reply, actions };
}

/** Stored lines as model turns. The first turn must be the user's, so a leading answer is dropped. */
export function toTurns(history: ChatMessage[]): Anthropic.MessageParam[] {
  const first = history.findIndex((m) => m.role === "user");
  return first === -1 ? [] : history.slice(first).map((m) => ({ role: m.role, content: m.content }));
}

export const chat = new Hono()
  // GET /v1/chat?limit=50  recent history, oldest first
  .get("/chat", async (c) => {
    const raw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), HISTORY_MAX) : 50;
    const body: ChatHistory = { messages: await store.listChatMessages(limit) };
    return c.json(body);
  })
  // POST /v1/chat { message }  Michael answers from today's timeline, goals and patterns, and acts
  // on the user's own calendar when asked (ChatResponse.actions)
  .post("/chat", async (c) => {
    const { message, turns, context } = await prepare(await jsonBody(c));
    const body = await save(message, await askMichael(turns, context));
    return c.json(body, 201);
  })
  // POST /v1/chat/stream { message }  the same answer as server-sent events: `delta` { text } as it
  // is written, `action` Recommendation for each thing done or undone, then `done` ChatResponse, or
  // `error` ApiError if the model fails mid-way.
  .post("/chat/stream", async (c) => {
    // Validation and "not set up" still fail as plain JSON errors, before the stream opens.
    const { message, turns, context } = await prepare(await jsonBody(c));
    return streamSSE(c, async (sse) => {
      try {
        const answer = await askMichael(turns, context, {
          onText: (text) => sse.writeSSE({ event: "delta", data: JSON.stringify({ text }) }),
          onAction: (action) => sse.writeSSE({ event: "action", data: JSON.stringify(action) }),
        });
        const body = await save(message, answer);
        await sse.writeSSE({ event: "done", data: JSON.stringify(body) });
      } catch (err) {
        const e = err instanceof HttpError ? err : new HttpError("internal", "Internal server error");
        if (!(err instanceof HttpError)) console.error(err);
        const body: ApiError = { error: { code: e.code, message: e.message } };
        await sse.writeSSE({ event: "error", data: JSON.stringify(body) });
      }
    });
  });
