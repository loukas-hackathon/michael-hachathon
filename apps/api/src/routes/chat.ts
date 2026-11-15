import Anthropic from "@anthropic-ai/sdk";
import {
  type ApiError,
  type ChatHistory,
  type ChatMessage,
  ChatRequest,
  type ChatResponse,
  type ChatThread,
  type CheckIn,
  type ConnectorId,
  type Event,
  type Goal,
  goalArea,
  type Instruction,
  isLive,
  MICHAEL_VOICE,
  type PatternReport,
  type Recommendation,
  type Score,
  voiceDuration,
} from "@michael/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { CHAT_TOOLS, type ChatTurnState, runChatTool, undoLine } from "../actions/chat-tools";
import { checkInContext, checkInLine } from "../checkin/service";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { instructionLine } from "../instructions/protected";
import { listMemories, type Memory, memoryContext } from "../memory";
import { DEFAULT_TIMEZONE, NO_HEADLINES } from "../patterns";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { latestThread, titleFor, untitled } from "./chat-threads";
import { patternReportFor } from "./patterns";
import { scoreFor } from "./score";

const ThreadIdParam = z.uuid();

// How many earlier lines Michael sees, and how many GET /v1/chat returns.
const HISTORY_TURNS = 20;
const HISTORY_MAX = 100;
// Lines of today's timeline handed to the model. A day has thousands of app events; those go in as
// totals, not lines.
const MAX_TODAY_LINES = 40;
const WEEK_MS = 7 * 24 * 3600_000;
// Titles of other conversations handed to the model: enough to say "as we planned on Tuesday".
const OTHER_THREADS = 5;

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

// "Connect my calendar" (#307): the web puts the one tap button under the answer for live
// connections (CONNECTOR_STATUS, #295), so Michael points to it instead of giving steps.
const CONNECT_NAMES: Record<ConnectorId, string> = {
  "google-calendar": "their calendar",
  claude: "Claude",
  telegram: "Telegram",
  nudges: "nudges",
  "apple-watch": "their Apple Watch",
  mac: "their Mac",
  iphone: "their iPhone apps",
  travel: "their location",
};
const spoken = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
const connectIds = Object.keys(CONNECT_NAMES) as ConnectorId[];
export const CONNECT_LINE = [
  `- When the user asks to connect ${spoken(connectIds.filter(isLive).map((id) => CONNECT_NAMES[id]))}, the app shows a one tap Connect button under your answer: say in one short line what it gives you and that the button below does it.`,
  connectIds.some((id) => !isLive(id))
    ? `${spoken(connectIds.filter((id) => !isLive(id)).map((id) => CONNECT_NAMES[id]))}: coming soon, say so in one line.`
    : "",
  "Never give steps, links or keys.",
]
  .filter(Boolean)
  .join(" ");

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
- You can draft a follow up message after a conversation or a meeting with other people (draft_follow_up). It is saved for the user to copy and send themselves; show them the text.
- Act when the user asks you to, or clearly agrees to a change you proposed. If the time or the block is unclear, ask first instead of guessing.
- You never touch events with other people, never delete the user's events, and never send anything in the user's name. If a tool refuses, say why in one line and offer advice instead.
- Never claim you did something unless a tool result says it is done.
- After acting, say in one or two short sentences what you did, with times, and end with the undo line exactly as the tool gave it, e.g. "Undo until 15:00."
- Times you pass to tools are ISO 8601 with the user's UTC offset, as in "Now (ISO)" below.
${CONNECT_LINE}

Proposing:
- When the user tells you something that changes their week (exams, an injury, travel, a deadline), propose one concrete change tied to a goal: a goal's weekly budget with propose_goal_change (with until for a temporary change), or this week's blocks with propose_plan_change. Show the maths ("University 4h to 8h a week until 22 December; Business 8h to 4h, so the week still adds up").
- A proposal changes nothing until the user taps Accept. Never say it is done. Never change goals any other way. One proposal per answer. If a tool says the user declined it this week, do not propose it again.

Memory:
- "What the user told you before" below is what you remember from earlier conversations. Use it without being asked; it is why the user does not repeat themselves.
- When the user tells you a lasting fact or preference about themselves, their routine or their goals ("I train best before 08:00", "Fridays are for family"), keep it with remember, in one short line in their words. Not one off plans, not other people's private details, not what is already in the goals.
- When the user asks you to forget something, use forget_memory with its id.

Check in:
- "What you told me" below are the user's own answers to earlier check in questions. Use them, quote them, never invent them.
- When the user answers one of today's open check in questions in chat, keep it with answer_check_in. If the result gives a follow up, ask it word for word.

Conversations:
- The user keeps separate conversations with you, each on its own topic. You see the lines of this one only.
- You know the others only by their titles under "Other conversations" and through what you remember. Never claim to recall their exact words; if it matters, ask.`;

// Added after the cached prompt when the answer is read aloud in a voice conversation (#299).
const SPOKEN_STYLE = `This answer is spoken aloud in a voice conversation:
- One or two short sentences, then one question or one concrete fix. Never a list, heading or markdown.
- Say numbers as a person would: "forty seven minutes", "half past six", "two of three sessions".
- If the user only greets you or says thanks, answer in a few words.`;

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
  /** Check in answers from the last week, and today's open questions (#187). */
  checkIns?: { answered: CheckIn[]; open: CheckIn[] };
  /** Facts the user asked Michael (or an agent) to keep, newest first. */
  memories?: Memory[];
  /** The user's other recent conversations, titles only (never their lines), latest first. */
  otherThreads?: Pick<ChatThread, "title" | "last_message_at">[];
}

const weekdayIn = (zone: Zone, ms: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone.name,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(ms);

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
        .map((i) => `- ${instructionLine(i)}`)
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

  const told = input.checkIns?.answered ?? [];
  if (told.length)
    parts.push(
      `What you told me (check in answers, the user's own words):\n${told.map(checkInLine).join("\n")}`,
    );
  const open = input.checkIns?.open ?? [];
  if (open.length) {
    parts.push(
      `Open check in questions today:\n${open.map((c) => `- ${c.question} {check_in_id ${c.id}}`).join("\n")}`,
    );
  }

  const remembered = memoryContext(input.memories ?? []);
  if (remembered) parts.push(remembered);

  const others = (input.otherThreads ?? []).slice(0, OTHER_THREADS).flatMap((t) => {
    if (!t.last_message_at) return [];
    const at = Date.parse(t.last_message_at);
    return [`- ${t.title} (${zone.dayOf(at) === day ? "today" : weekdayIn(zone, at)})`];
  });
  if (others.length) parts.push(`Other conversations (titles only):\n${others.join("\n")}`);

  const headlines = (label: string, r: PatternReport | null) =>
    !r
      ? []
      : r.headlines.length
        ? [`${label}:\n${r.headlines.map((h) => `- ${h}`).join("\n")}`]
        : [`${label}: ${NO_HEADLINES}.`];
  parts.push(
    ...headlines("Patterns today", input.today),
    ...headlines("Patterns over the last 7 days", input.week),
  );

  return parts.join("\n\n");
}

async function contextForNow(threadId: string | null): Promise<string> {
  const now = Date.now();
  const zone = new Zone(DEFAULT_TIMEZONE);
  const dayStart = zone.startOfDay(zone.dayOf(now));
  const dayEnd = zone.startOfDay(zone.nextDay(zone.dayOf(now)));
  const nowIso = new Date(now).toISOString();
  // Pattern reports are best effort: a detector failing must not take the chat down.
  const report = (from: string) => patternReportFor({ from, to: nowIso }).catch(() => null);
  const [goals, instructions, events, today, week, score, undoable, checkIns, memories, threads] =
    await Promise.all([
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
      checkInContext(now),
      listMemories().catch(() => []),
      store.listChatThreads({ limit: OTHER_THREADS + 1 }).catch(() => []),
    ]);
  return buildChatContext({
    now,
    goals,
    instructions,
    events,
    today,
    week,
    score,
    undoable,
    checkIns,
    memories,
    otherThreads: threads
      .filter((t) => t.id !== threadId && !untitled(t))
      .sort(
        (a, b) =>
          Date.parse(b.last_message_at ?? b.created_at) - Date.parse(a.last_message_at ?? a.created_at),
      ),
  });
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

function request(messages: Anthropic.MessageParam[], context: string, lastRound: boolean, spoken = false) {
  return {
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4000,
    // Chat is latency sensitive and the answers are short.
    output_config: { effort: "low" as const },
    system: [
      // Stable prompt first so it can be cached; the per-request context comes after.
      { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: `What I know about the user right now:\n\n${context}` },
      ...(spoken ? [{ type: "text" as const, text: SPOKEN_STYLE }] : []),
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
  /** The answer is read aloud: brief, no lists (SPOKEN_STYLE). */
  spoken?: boolean;
}

/** One model call: streamed piece by piece when `onText` is given. */
async function callModel(
  messages: Anthropic.MessageParam[],
  context: string,
  lastRound: boolean,
  onText: Hooks["onText"],
  spoken = false,
): Promise<Anthropic.Message> {
  try {
    const body = request(messages, context, lastRound, spoken);
    if (!onText) return await anthropic().messages.create(body);
    const stream = anthropic().messages.stream(body);
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

  const turn: ChatTurnState = { proposals: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    wrote = false;
    const response = await callModel(messages, context, round === MAX_ROUNDS - 1, onText, hooks.spoken);
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
      const outcome = await runChatTool(call.name, call.input, turn);
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
  const proposed = actions.filter((a) => a.status === "proposed");
  if (!answer && proposed.length)
    answer = `${proposed.map((a) => a.title).join("; ")}. Tap Accept to apply it.`;
  if (!answer) {
    if (actions.length) answer = `Undone: ${actions.map((a) => a.title).join("; ")}.`;
    else throw new HttpError("upstream_error", "Claude returned an empty answer");
  }
  return { answer, actions };
}

/** The thread a request writes in, if it exists yet: a "new" one is only made once the answer is in. */
async function existingThread(id: string | undefined): Promise<ChatThread | null> {
  if (id === "new") return null;
  if (!id) return latestThread();
  const thread = await store.getChatThread(id);
  if (!thread) throw new HttpError("not_found", "Chat thread not found");
  return thread;
}

interface Prepared {
  message: string;
  turns: Anthropic.MessageParam[];
  context: string;
  /** The answer is read aloud (conversation mode): brief, no lists. */
  spoken: boolean;
  /** Null when the pair starts a new thread (made in save, so a failed answer leaves nothing). */
  thread: ChatThread | null;
  /** The thread's name, started alongside the answer when this is its first line. */
  title: Promise<string> | null;
}

/** Everything both POST routes need before the model is called. */
async function prepare(body: unknown): Promise<Prepared> {
  const { message, thread_id, spoken = false } = parse(ChatRequest, body);
  // Someone else's thread is a 404 even before the model is asked.
  const thread = await existingThread(thread_id);
  // Fail before storing anything when chat is not configured.
  anthropic();
  const [earlier, context] = await Promise.all([
    thread ? store.listChatMessages(thread.id, HISTORY_TURNS) : Promise.resolve([]),
    contextForNow(thread?.id ?? null),
  ]);
  const turns: Anthropic.MessageParam[] = [...toTurns(earlier), { role: "user", content: message }];
  // Named from the first line, in parallel with the answer, so naming adds no wait.
  const title = !thread || (untitled(thread) && earlier.length === 0) ? titleFor(message) : null;
  return { message, turns, context, spoken, thread, title };
}

async function save(p: Prepared, { answer, actions }: MichaelAnswer): Promise<ChatResponse> {
  const thread = p.thread ?? (await store.createChatThread());
  const stored = await store.addChatMessage(thread.id, "user", p.message);
  const ids = [...new Set(actions.map((a) => a.id))];
  const reply = await store.addChatMessage(thread.id, "assistant", answer, ids);
  if (p.title) {
    const title = await p.title;
    const current = await store.getChatThread(thread.id);
    // Unless the user renamed it in the meantime.
    if (current && untitled(current)) await store.updateChatThread(thread.id, { title });
  }
  const after = (await store.getChatThread(thread.id)) ?? thread;
  return { message: stored, reply, actions, thread: after };
}

/** The recommendations the lines name, as they stand now. Missing ones (deleted data) are skipped. */
async function actionsOf(messages: ChatMessage[]): Promise<Recommendation[]> {
  const ids = [...new Set(messages.flatMap((m) => m.action_ids))];
  const found = await Promise.all(ids.map((id) => store.getRecommendation(id).catch(() => null)));
  return found.filter((r): r is Recommendation => r !== null);
}

/** Stored lines as model turns. The first turn must be the user's, so a leading answer is dropped. */
export function toTurns(history: ChatMessage[]): Anthropic.MessageParam[] {
  const first = history.findIndex((m) => m.role === "user");
  return first === -1 ? [] : history.slice(first).map((m) => ({ role: m.role, content: m.content }));
}

export const chat = new Hono()
  // GET /v1/chat?limit=50  recent history, oldest first
  // GET /v1/chat?thread_id=&limit=50  one thread's lines (default: the latest thread)
  .get("/chat", async (c) => {
    const raw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), HISTORY_MAX) : 50;
    const id = c.req.query("thread_id");
    const thread = await existingThread(id ? parse(ThreadIdParam, id) : undefined);
    const messages = thread ? await store.listChatMessages(thread.id, limit) : [];
    const body: ChatHistory = { messages, actions: await actionsOf(messages), thread };
    return c.json(body);
  })
  // POST /v1/chat { message }  Michael answers from today's timeline, goals and patterns, and acts
  // on the user's own calendar when asked (ChatResponse.actions)
  .post("/chat", async (c) => {
    const p = await prepare(await jsonBody(c));
    const body = await save(p, await askMichael(p.turns, p.context, { spoken: p.spoken }));
    return c.json(body, 201);
  })
  // POST /v1/chat/stream { message }  the same answer as server-sent events: `delta` { text } as it
  // is written, `action` Recommendation for each thing done or undone, then `done` ChatResponse, or
  // `error` ApiError if the model fails mid-way.
  .post("/chat/stream", async (c) => {
    // Validation and "not set up" still fail as plain JSON errors, before the stream opens.
    const p = await prepare(await jsonBody(c));
    return streamSSE(c, async (sse) => {
      try {
        const answer = await askMichael(p.turns, p.context, {
          spoken: p.spoken,
          onText: (text) => sse.writeSSE({ event: "delta", data: JSON.stringify({ text }) }),
          onAction: (action) => sse.writeSSE({ event: "action", data: JSON.stringify(action) }),
        });
        const body = await save(p, answer);
        await sse.writeSSE({ event: "done", data: JSON.stringify(body) });
      } catch (err) {
        const e = err instanceof HttpError ? err : new HttpError("internal", "Internal server error");
        if (!(err instanceof HttpError)) console.error(err);
        const body: ApiError = { error: { code: e.code, message: e.message } };
        await sse.writeSSE({ event: "error", data: JSON.stringify(body) });
      }
    });
  });
