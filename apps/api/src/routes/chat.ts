import Anthropic from "@anthropic-ai/sdk";
import {
  type ChatHistory,
  type ChatMessage,
  ChatRequest,
  type ChatResponse,
  type Event,
  type Goal,
  type PatternReport,
} from "@michael/shared";
import { Hono } from "hono";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { patternReportFor } from "./patterns";

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

const SYSTEM_PROMPT = `You are Michael, a coach for the whole day. You are on the user's side: you find the time they lose every day and give it back to their goals (work, gym, rest, food).

Voice:
- A firm sports coach. Talk about goals and time, plainly and warmly, never preachy.
- Short answers: two to five sentences unless the user asks for detail. No headings.
- Show the maths when you use a number ("2h 10m of 9h this week").
- British spelling, 24-hour time (14:30), "I" for yourself.
- No emoji. No dashes as punctuation. Never say "productivity" or "wellness".
- Ask a question only when you are genuinely unsure what the user wants.
- If you got something wrong, admit it in one line and move on.
- When you suggest a change, make it concrete and tie it to a goal: what, when, how long.

Facts:
- Use only the context below about the user's day, goals and patterns. If the data does not say, say so; never invent numbers or events.
- You can advise but in this chat you cannot change the calendar or anything else yet. Never claim you did something.
- You never touch events with other people, never delete, and never send anything in the user's name.`;

const minutes = (ms: number) => Math.round(ms / 60_000);
function hm(totalMinutes: number): string {
  const m = Math.round(totalMinutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

export interface ChatContextInput {
  now: number;
  timezone?: string;
  goals: Goal[];
  /** Events from the start of the week window to now. */
  events: Event[];
  today: PatternReport | null;
  week: PatternReport | null;
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
  const parts: string[] = [`Now: ${weekday}, ${zone.clock(now)} (${zone.name}).`];

  const active = input.goals.filter((g) => g.active);
  parts.push(
    active.length
      ? `Goals:\n${active
          .map((g) => {
            const budget = g.weekly_budget_minutes ? `, ${hm(g.weekly_budget_minutes)} a week planned` : "";
            const why = g.description ? ` (${g.description})` : "";
            return `- ${g.title} [${g.category}${budget}]${why}`;
          })
          .join("\n")}`
      : "Goals: none set yet.",
  );

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
      return `- ${when} ${e.type.replace("_", " ")}: ${e.title}${planned}`;
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
  if (weekLines.length) parts.push(`Last 7 days:\n${weekLines.join("\n")}`);

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
  const [goals, events, today, week] = await Promise.all([
    store.listGoals(),
    store.listEvents({
      from: new Date(now - WEEK_MS).toISOString(),
      to: new Date(dayEnd).toISOString(),
      type: [...LISTED_TYPES],
    }),
    now - dayStart > 60_000 ? report(new Date(dayStart).toISOString()) : Promise.resolve(null),
    report(new Date(now - WEEK_MS).toISOString()),
  ]);
  return buildChatContext({ now, goals, events, today, week });
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError("unavailable", "Chat is not set up yet: the API has no ANTHROPIC_API_KEY");
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

async function askMichael(messages: Anthropic.MessageParam[], context: string): Promise<string> {
  const api = anthropic();
  let response: Anthropic.Message;
  try {
    response = await api.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2000,
      // Chat is latency sensitive and the answers are short.
      output_config: { effort: "low" },
      system: [
        // Stable prompt first so it can be cached; the per-request context comes after.
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: `What I know about the user right now:\n\n${context}` },
      ],
      messages,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new HttpError("upstream_error", `Claude failed (${err.status ?? "network"}): ${err.message}`);
    }
    throw err;
  }
  if (response.stop_reason === "refusal") {
    return "I can't help with that one. Ask me about your day or your goals.";
  }
  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  if (!text) throw new HttpError("upstream_error", "Claude returned an empty answer");
  return text;
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
  // POST /v1/chat { message }  Michael answers from today's timeline, goals and patterns
  .post("/chat", async (c) => {
    const { message } = parse(ChatRequest, await jsonBody(c));
    // Fail before storing anything when chat is not configured.
    anthropic();
    const [earlier, context] = await Promise.all([store.listChatMessages(HISTORY_TURNS), contextForNow()]);
    const answer = await askMichael([...toTurns(earlier), { role: "user", content: message }], context);
    const stored = await store.addChatMessage("user", message);
    const reply = await store.addChatMessage("assistant", answer);
    const body: ChatResponse = { message: stored, reply };
    return c.json(body, 201);
  });
