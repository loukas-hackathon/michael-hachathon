import Anthropic from "@anthropic-ai/sdk";
import {
  type ApiError,
  budgetMinutesDone,
  type ChatHistory,
  type ChatMessage,
  ChatRequest,
  type ChatResponse,
  type ChatStep,
  type ChatThread,
  ChatWarmRequest,
  type CheckIn,
  type ChecklistItem,
  type ConnectorId,
  type Event,
  type Goal,
  goalArea,
  type Instruction,
  isLive,
  MICHAEL_VOICE,
  type PatternReport,
  type Recommendation,
  type RitualToday,
  type Score,
  voiceDuration,
} from "@michael/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { blockIdOf, goalIdOf, OPENING_STEP, stepLabel } from "../actions/chat-steps";
import { CHAT_TOOLS, type ChatTurnState, runChatTool, undoLine } from "../actions/chat-tools";
import { checkInContext, checkInLine } from "../checkin/service";
import { currentDemoVisitor, currentUserId } from "../context";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { instructionLine } from "../instructions/protected";
import { listMemories, type Memory, memoryContext } from "../memory";
import { DEFAULT_TIMEZONE, NO_HEADLINES } from "../patterns";
import { Zone } from "../patterns/time";
import { ritualFor } from "../ritual/ritual";
import { isLogEntry } from "../score/logged";
import { store } from "../store";
import { currentTiming } from "../timing";
import { writeVersion } from "../writes";
import { honestAnswer, type ToolCallRecord } from "./chat-honesty";
import { latestThread, titleFor, untitled } from "./chat-threads";
import { plannedVisitLines } from "./location";
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
  // Place visits (#267): "at Gym".
  "location",
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
- Talk like a person across the table, not a report. When the user tells you about a win, meet it in one line with its number before anything else. When they tell you about a bad day, no joke and no lecture: the number, then the next move.
- Show the maths when you use a number ("2h 10 of 9h this week").
- When you suggest a change, make it concrete and tie it to a goal: what, when, how long.

Facts:
- Use only the context below about the user's day, goals and patterns. If the data does not say, say so; never invent numbers or events.
- For goal progress and budgets, quote the score figures exactly as given; they are the same numbers the app shows.
- Quote times and ids only from the context or from tool results.

Logging what the user did:
- When the user says they did something for a goal ("I took a bath for 40 minutes at 13:00", "an hour of reading this morning"), log it at once with log_done. No calendar block is needed. Inside one of the goal's blocks it confirms that block; outside every block it counts toward the goal's weekly budget straight away but not toward the score, which is planned time only (say so if asked why the score did not move). Then reply in one line with the new maths from the tool result and end with "Undo", e.g. "Logged 40 min. Everything bath: 40 of 60 min this week. Undo".
- When the user says how one of their past goal blocks went ("skipped the gym", "only did half of deep work"), settle it with confirm_block (did, minutes, reason).
- You can always log time against a goal. Never say you cannot, and never offer a workaround such as renaming or moving another block instead.
- When no goal title plainly fits, still call log_done at once with goal set to the activity in the user's words ("bath", "ice bath after the ride"): the server matches it against goal titles, calendar titles and descriptions. Ask which goal only when the tool says it could be two, or none fits. If the time is unclear, ask one short question.

Acting:
- You can write everything the user can write in the app: log time (log_done), settle a past block (confirm_block), add a block to their calendar (create_focus_block), move or rename one of their own solo blocks (move_calendar_block), remove one of their own blocks (remove_calendar_block: "delete my Boatspace block"), rename, resize or give a goal to one of their own blocks (change_calendar_block), carry out one of your offers on Today when they say yes (accept_recommendation), add a goal (add_goal), change a goal's budget, title or description, or pause and resume it (update_goal), add, tick off or reword an outcome (add_checklist_item, update_checklist_item), keep or pause a standing instruction (add_instruction, update_instruction), save a place (save_place), change quiet hours and the usual week (update_profile), close distracting apps on their Mac for a while (block_mac_app), start a Focus now session on a goal from this minute (focus_now: "let's focus on University for 45 minutes"), end or extend it (change_focus), start or end meetings mode when they ask (meetings_mode), go off the record when they ask (go_off_the_record), and take back something you did (undo_action).
- When the user asks you to change something in the app, do it with the tool in the same answer. Never tell them to go and do it themselves when a tool can.
- Off the record is the user's own switch: you may turn it on when they ask, never off. To turn it off, they use You.
- When the user says yes to one of your offers on Today ("do it", "yes, book that"), carry it out with accept_recommendation and its recommendation_id from "Waiting for the user's yes". If it is unclear which one, ask.
- Removing a block: find its event_id (today's list or find_calendar_blocks), call remove_calendar_block, then say what you removed and until when it can be undone ("Removed Boatspace, 15:00 to 16:00. Undo until 15:00.").
- Deleting data, a goal, an instruction or a place, disconnecting a source and revoking an agent stay in the app: say where ("You, Goals") instead.
- Prefer acting with undo over explaining why you cannot.
- You act only on the user's own time. On everything else you advise.
- You can draft a follow up message after a conversation or a meeting with other people (draft_follow_up). It is saved for the user to copy and send themselves; show them the text.
- Act when the user asks you to, or clearly agrees to a change you proposed. If the time or the block is unclear, ask first instead of guessing.
- You never touch events with other people, remove only the user's own events (always with undo until they start), and never send anything in the user's name. If a tool refuses, say why in one line and offer advice instead.
- Never claim you did something unless a tool result in this answer says it is done. Agreeing to a change is not making it: call the tool first, then say it. If you have not called it, say so and offer it ("I haven't added it yet. Shall I book Gym 10:00 to 11:00?").
- A tool result that is an error or a refusal means nothing changed: say it did not go through and why, in one line.
- Lines from an earlier day in this conversation start with their day and time in brackets. "Today" and "tomorrow" in them mean that day, not now. Check the "Now:" line for today's date and weekday before you say today, tomorrow or a weekday.
- What became of your earlier actions in this conversation is under "What I did earlier in this conversation". Trust it over your own earlier lines. A block you added that is gone since was removed, not never added. Correct an earlier line only when the records show it was wrong, in one line, then the fix.
- After acting, say in one or two short sentences what you did, with times, and end with the undo line exactly as the tool gave it, e.g. "Undo until 15:00."
- Times you pass to tools are ISO 8601 with the user's UTC offset, as in "Now (ISO)" below.
${CONNECT_LINE}

Proposing:
- When the user tells you something that changes their week (exams, an injury, travel, a deadline), propose one concrete change tied to a goal: a goal's weekly budget with propose_goal_change (with until for a temporary change), or this week's blocks with propose_plan_change. Show the maths ("University 4h to 8h a week until 22 December; Business 8h to 4h, so the week still adds up").
- A proposal changes nothing until the user taps Accept. Never say it is done. One proposal per answer. If a tool says the user declined it this week, do not propose it again.
- Propose when the change is your idea. When the user plainly asks for a change to a goal ("make bath 90 minutes a week", "pause Spanish"), make it with update_goal instead.

Memory:
- "What the user told you before" below is what you remember from earlier conversations. Use it without being asked; it is why the user does not repeat themselves.
- When the user tells you a lasting fact or preference about themselves, their routine or their goals ("I train best before 08:00", "Fridays are for family"), keep it with remember, in one short line in their words. Not one off plans, not other people's private details, not what is already in the goals.
- Call remember in the same answer, without asking first, and say so in a few words ("I'll remember that."). When the user says "remember", always call it. Never say you will remember something unless the tool result says Remembered.
- When the user asks you to forget something, use forget_memory with its id.
- When the user asks what you have learnt or noticed about them, or why a day went the way it did, call get_insights and cite one pattern with its numbers exactly as written, then its one fix. Never state a pattern it did not return.
- When the user asks what you know about them, call what_you_know and answer in two or three short lines grouped the same way (told me, what I read, what I never keep). The app shows a button to the full page under your answer, where they can forget anything; say so in one line.

Check in:
- "What you told me" below are the user's own answers to earlier check in questions. Use them, quote them, never invent them.
- When the user answers one of today's open check in questions in chat, keep it with answer_check_in. If the result gives a follow up, ask it word for word.

Conversations:
- The user keeps separate conversations with you, each on its own topic. You see the lines of this one only.
- You know the others only by their titles under "Other conversations" and through what you remember. Never claim to recall their exact words; if it matters, ask.

The daily ritual (morning outcomes, evening log):
- When the user tells you what they want to get done today ("my goals today are X and Y"), keep them with set_day_outcomes, in their words, linked to a goal only when one clearly fits. Three is the most.
- When they tell you what they got done ("I finished X, did 30 min of Y"), log it with log_day using the item ids under "Today's outcomes", then give the line the tool returns, word for word.
- If the morning is due and no outcomes are set, you may ask once: "What do you want to get done today?" In the evening, with outcomes open: "What did you get done?" Never guilt, never streaks; skipping a day is fine.`;

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
  /** #457: Michael's offers waiting for the user's yes on Today, with ids for accept_recommendation. */
  offers?: Recommendation[];
  /** Today's outcomes of checklist goals (#238), with ids for update_checklist_item. */
  checklist?: ChecklistItem[];
  /** Check in answers from the last week, and today's open questions (#187). */
  checkIns?: { answered: CheckIn[]; open: CheckIn[] };
  /** Facts the user asked Michael (or an agent) to keep, newest first. */
  memories?: Memory[];
  /** Calendar events at saved places with no location signal over them, as lines (#267). */
  plannedVisits?: string[];
  /** The user's other recent conversations, titles only (never their lines), latest first. */
  otherThreads?: Pick<ChatThread, "title" | "last_message_at">[];
  /** The daily ritual (#318): today's outcomes and which half is due. */
  ritual?: RitualToday | null;
}

/** "Today's outcomes" for the chat context, with the ids log_day needs. */
export function ritualContext(r: RitualToday, goals: Goal[]): string {
  const title = new Map(goals.map((g) => [g.id, g.title]));
  const lines = r.items.map((i) => {
    const extra = [
      i.linked_goal_id ? `for ${title.get(i.linked_goal_id) ?? "a goal"}` : null,
      i.estimate_minutes ? `about ${hm(i.estimate_minutes)}` : null,
      i.logged_minutes ? `${hm(i.logged_minutes)} logged` : null,
      i.carried_from ? "carried from yesterday" : null,
    ].filter(Boolean);
    return `- [${i.status}] ${i.text}${extra.length ? ` (${extra.join(", ")})` : ""} {item_id ${i.id}}`;
  });
  const state = (s: string) => s.replace("_", " ");
  return [
    `Today's outcomes (morning ${state(r.morning)}, evening ${state(r.evening)}):`,
    ...(lines.length ? lines : ["- none set yet"]),
    ...(r.summary ? [`Evening line: ${r.summary}`] : []),
  ].join("\n");
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
      `Time won back this week: ${hm(s.time_won_back_minutes)}.` +
      (s.logged_minutes
        ? ` Plus ${hm(s.logged_minutes)} the person logged outside their blocks: it counts toward each goal's budget, never toward the score, which reads planned time only.`
        : ""),
  ];
  const goals = s.goals.map((g) => {
    const budget = g.budget_minutes ? `budget ${hm(g.budget_minutes)}` : "no budget";
    if (!g.scored)
      return `- ${g.title} [${g.area}]: ${budget}, a ${g.kind} goal, not scored from calendar blocks`;
    const done = budgetMinutesDone(g);
    const left = Math.max(0, g.budget_minutes - done);
    const logged = g.logged_minutes
      ? ` (${hm(g.spent_minutes)} in its blocks plus ${hm(g.logged_minutes)} logged outside them)`
      : "";
    return (
      `- ${g.title} [${g.area}]: ${hm(done)} spent of ${budget}${logged}` +
      (g.budget_minutes ? ` (${hm(left)} left to reach it)` : "") +
      `; ${hm(g.planned_minutes)} planned in the calendar, ${hm(g.lost_minutes)} lost, ` +
      `${hm(g.ahead_minutes)} planned still ahead; ` +
      // Named, so it is never read as a share of the budget ("42% (2h 01 of 6h)" was wrong maths).
      `${pct(g.score_pct)} of its planned time already passed was spent (not a share of the budget)`
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
        (d.logged_minutes
          ? ` Plus ${hm(d.logged_minutes)} logged outside the blocks, not in the score.`
          : "") +
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
  return `${nowLine(input.now, input.timezone)}\n\n${contextBody(input)}`;
}

/** "Now: Saturday 14 November, 19:05 (Europe/Athens). Now (ISO): ...": the clock, apart from the rest. */
export function nowLine(now: number, timezone = DEFAULT_TIMEZONE): string {
  const zone = new Zone(timezone);
  return `Now: ${weekdayIn(zone, now)}, ${zone.clock(now)} (${zone.name}). Now (ISO): ${isoIn(zone, now)}.`;
}

/**
 * Everything but the clock, as of `input.now`. Kept apart from the clock so the same text can be
 * reused for a few minutes (contextFor) and read back from the model's prompt cache (#364).
 */
function contextBody(input: ChatContextInput): string {
  const zone = new Zone(input.timezone ?? DEFAULT_TIMEZONE);
  const { now } = input;
  const day = zone.dayOf(now);
  const dayStart = zone.startOfDay(day);
  const parts: string[] = [];

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
        .map((i) => `- ${instructionLine(i)} {instruction_id ${i.id}}`)
        .join("\n")}`,
    );
  }

  // Blocks the user already settled (#317), so Michael does not ask about them again.
  const settledBlocks = new Map<string, "did" | "didnt">();
  for (const e of input.events) {
    if (!isLogEntry(e) || typeof e.data.event_id !== "string") continue;
    settledBlocks.set(e.data.event_id, e.data.log === "didnt" ? "didnt" : "did");
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
      // Ids only where Michael may act: the user's own blocks; a past one can be settled.
      const others = e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;
      const settled = settledBlocks.get(e.id);
      const tag =
        e.type !== "calendar_event"
          ? ""
          : others
            ? " [with other people, advice only]"
            : start > now
              ? ` {event_id ${e.id}}`
              : settled
                ? ` [settled: ${settled}] {event_id ${e.id}}`
                : ` [past, unconfirmed: confirm_block] {event_id ${e.id}}`;
      // The user's own word (#317): logged time and settled blocks.
      if (isLogEntry(e))
        return e.data.log === "didnt" ? `- ${when} ${e.title}` : `- ${when} logged by the user: ${e.title}`;
      if (e.type === "location") return `- ${when} at ${e.title}`;
      return `- ${when} ${e.type.replace("_", " ")}: ${e.title}${planned}${tag}`;
    })
    .concat((input.plannedVisits ?? []).map((line) => `- ${line}`));
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
  const offers = (input.offers ?? []).slice(0, 8).map((r) => `- ${r.title} {recommendation_id ${r.id}}`);
  if (offers.length)
    parts.push(`Waiting for the user's yes on Today (accept_recommendation):\n${offers.join("\n")}`);

  const outcomes = (input.checklist ?? []).filter((i) => i.date === day && i.status !== "moved");
  if (outcomes.length)
    parts.push(
      `Today's outcomes (checklist):\n${outcomes.map((i) => `- [${i.status}] ${i.text} {item_id ${i.id}}`).join("\n")}`,
    );

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

  if (input.ritual) parts.push(ritualContext(input.ritual, input.goals));

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

type ContextReads = Omit<ChatContextInput, "otherThreads"> & {
  /** When each read finished, from the start of the context. */
  parts: Record<string, number>;
};

/** Every read the chat context needs but the other threads' titles, in parallel. */
async function readContext(): Promise<ContextReads> {
  const now = Date.now();
  const parts: Record<string, number> = {};
  const t0 = performance.now();
  // How long each read took, for chat_timing (#364).
  const timed = <T>(name: string, p: Promise<T>): Promise<T> =>
    p.finally(() => {
      parts[name] = Math.round(performance.now() - t0);
    });
  const zone = new Zone(DEFAULT_TIMEZONE);
  const dayStart = zone.startOfDay(zone.dayOf(now));
  const dayEnd = zone.startOfDay(zone.nextDay(zone.dayOf(now)));
  const nowIso = new Date(now).toISOString();
  // Pattern reports are best effort: a detector failing must not take the chat down.
  const report = (from: string) => patternReportFor({ from, to: nowIso }).catch(() => null);
  const [
    goals,
    instructions,
    events,
    today,
    week,
    score,
    recommendations,
    checkIns,
    memories,
    checklist,
    ritual,
    plannedVisits,
  ] = await Promise.all([
    timed("goals", store.listGoals()),
    timed(
      "instructions",
      store.listInstructions().catch(() => []),
    ),
    timed(
      "events",
      store.listEvents({
        from: new Date(now - WEEK_MS).toISOString(),
        to: new Date(dayEnd).toISOString(),
        type: [...LISTED_TYPES],
      }),
    ),
    timed(
      "patterns_today",
      now - dayStart > 60_000 ? report(new Date(dayStart).toISOString()) : Promise.resolve(null),
    ),
    timed("patterns_week", report(new Date(now - WEEK_MS).toISOString())),
    timed(
      "score",
      scoreFor({ now: nowIso }, { readOnly: true }).catch((err) => {
        console.error("chat: score failed", err);
        return null;
      }),
    ),
    timed(
      "undoable",
      store.listRecommendations().catch(() => []),
    ),
    timed("check_ins", checkInContext(now)),
    timed(
      "memories",
      listMemories().catch(() => []),
    ),
    timed(
      "checklist",
      store.listChecklist({ from: zone.dayOf(now), to: zone.dayOf(now) }).catch(() => []),
    ),
    timed(
      "ritual",
      ritualFor(now).catch(() => null),
    ),
    timed(
      "planned_visits",
      plannedVisitLines(new Date(dayStart).toISOString(), new Date(dayEnd).toISOString(), (ms) =>
        zone.clock(ms),
      ).catch(() => []),
    ),
  ]);
  return {
    now,
    goals,
    instructions,
    events,
    today,
    week,
    score,
    undoable: recommendations.filter((r) => r.status === "done"),
    // Only what Michael can carry out: an action of the user's own time, not a Timeline edit.
    offers: recommendations.filter(
      (r) =>
        (r.status === "proposed" || r.status === "accepted") &&
        r.action !== null &&
        !r.action.involves_others &&
        r.action.kind !== "draft_follow_up" &&
        r.source !== "user",
    ),
    checkIns,
    memories,
    checklist,
    ritual,
    plannedVisits,
    parts,
  };
}

// The context's reads, kept per user (and demo visitor) for a short while: a question asked soon
// after another, or after the chat screen warmed it (POST /v1/chat/warm), starts the model at once
// instead of after 0.4 to 1 s of reads (#364). Any write of the user's through the store (writes.ts)
// makes it read again, so an answer never misses what the user just did; the age limit covers time
// passing (blocks starting, the score moving). Other threads' titles are read every time: chat lines
// and thread names do not count as writes here.
const CONTEXT_TTL_MS = 2 * 60_000;
interface CachedContext {
  version: string;
  at: number;
  reads: Promise<ContextReads>;
}
const contexts = new Map<string, CachedContext>();

/** Tests only: forget every cached context. */
export function clearChatContextCache() {
  contexts.clear();
}

interface ChatContext {
  /** Everything but the clock: cached, so the model reads it back from its prompt cache too. */
  text: string;
  parts: Record<string, number>;
}

interface ContextHandle {
  entry: CachedContext;
  /** The reads were already there (or under way) before this request. */
  hit: boolean;
}

/**
 * When the cached context must be read again: any write of the user's (a calendar sync included,
 * it writes through the store) or a new day in Athens, so "Today" never carries yesterday (#483).
 */
export const contextVersion = (userId: string, now: number) =>
  `${writeVersion(userId)}|${new Zone(DEFAULT_TIMEZONE).dayOf(now)}`;

/** The caller's cached context reads, started now when there are none (or they are stale). */
function ensureContext(): ContextHandle {
  const userId = currentUserId();
  const key = `${userId}|${currentDemoVisitor() ?? ""}`;
  const now = Date.now();
  const version = contextVersion(userId, now);
  const cached = contexts.get(key);
  if (cached && cached.version === version && now - cached.at < CONTEXT_TTL_MS)
    return { entry: cached, hit: true };
  for (const [k, e] of contexts) if (now - e.at >= CONTEXT_TTL_MS) contexts.delete(k);
  const entry: CachedContext = { version, at: now, reads: readContext() };
  // A failed read is not kept: the next question reads again.
  entry.reads.catch(() => {
    if (contexts.get(key) === entry) contexts.delete(key);
  });
  contexts.set(key, entry);
  return { entry, hit: false };
}

/** The context text for one thread, once the reads are in. */
async function contextFor({ entry, hit }: ContextHandle, threadId: string | null): Promise<ChatContext> {
  const start = performance.now();
  const [{ parts, ...input }, threads] = await Promise.all([
    entry.reads,
    store.listChatThreads({ limit: OTHER_THREADS + 1 }).catch(() => []),
  ]);
  const text = contextBody({
    ...input,
    otherThreads: threads
      .filter((t) => t.id !== threadId && !untitled(t))
      .sort(
        (a, b) =>
          Date.parse(b.last_message_at ?? b.created_at) - Date.parse(a.last_message_at ?? a.created_at),
      ),
  });
  return {
    text,
    parts: hit
      ? { cached: 1, age_ms: Date.now() - entry.at, wait: Math.round(performance.now() - start) }
      : { ...parts },
  };
}

let client: Anthropic | null = null;
/** Tests only: answer with a stand in for Claude. */
/** The caller's context text as the model would read it, for tests. */
export async function readChatContextForTests(): Promise<string> {
  return (await contextFor(ensureContext(), null)).text;
}

export function setChatClientForTests(fake: Anthropic | null) {
  client = fake;
}
const chatConfigured = () => !!client || !!env.ANTHROPIC_API_KEY;
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

/** How this answer is asked for, besides the context: read aloud or not, and the clock. */
interface Style {
  spoken: boolean;
  /** The "Now:" line. Left out when the context carries it (older callers and tests). */
  now?: string;
}

function request(
  messages: Anthropic.MessageParam[],
  context: string,
  lastRound: boolean,
  { spoken, now }: Style,
  fast: boolean,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4000,
    // Chat is latency sensitive and the answers are short.
    output_config: { effort: "low" },
    ...(fast ? { speed: "fast" as const } : {}),
    // Caches the conversation so far as well, so the next round of a tool loop reads it back.
    cache_control: { type: "ephemeral" },
    system: [
      // Stable prompt first so it can be cached; the per-request context comes after, cached too:
      // every later round of the same answer (after a tool call) reads both back (#364).
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: `What I know about the user right now:\n\n${context}`,
        cache_control: { type: "ephemeral" },
      },
      // The clock after the cached blocks: it changes every minute, the context above does not.
      ...(now ? [{ type: "text" as const, text: now }] : []),
      ...(spoken ? [{ type: "text" as const, text: SPOKEN_STYLE }] : []),
    ],
    tools: CHAT_TOOLS,
    // The last round must answer in words, not call another tool.
    tool_choice: lastRound ? { type: "none" } : { type: "auto" },
    messages,
  };
}

// Fast mode off for a while after the account refused it or was out of fast capacity.
const FAST_BACKOFF_MS = 10 * 60_000;
let fastOffUntil = 0;
const fastWanted = () => env.CHAT_SPEED === "fast" && Date.now() >= fastOffUntil;
/** A fast request the API turned down before writing anything: try again at standard speed. */
const fastRefused = (err: unknown) =>
  err instanceof Anthropic.APIError && (err.status === 429 || err.status === 400 || err.status === 403);

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
  /** Each model call of the answer, in order. */
  timing?: RoundTiming[];
}

interface Hooks {
  /** Streams text as it is written; without it the model is called without streaming. */
  onText?: (text: string) => Promise<void>;
  onAction?: (action: Recommendation) => Promise<void>;
  /** How Michael is working it out: "running" then "done" for each tool call, in order. */
  onStep?: (step: ChatStep) => Promise<void>;
  /** The answer is read aloud: brief, no lists (SPOKEN_STYLE). */
  spoken?: boolean;
  /** The "Now:" line, when the context leaves the clock out (contextFor). */
  now?: string;
  /** Done actions from earlier answers in this thread: a line about them is not a false claim. */
  earlierDone?: number;
}

/** Where the time of one model call went, for the chat_timing log and the stream's `timing` event. */
export interface RoundTiming {
  /** Until the first event of the response (thinking included). */
  first_event_ms: number | null;
  /** Until the first visible text of this round, if it wrote any. */
  first_text_ms: number | null;
  ms: number;
  tools_ms: number;
  speed: "fast" | "standard";
  input_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  output_tokens?: number;
}

/** One model call: streamed piece by piece when `onText` is given. */
async function callModel(
  messages: Anthropic.MessageParam[],
  context: string,
  lastRound: boolean,
  onText: Hooks["onText"],
  style: Style,
  timing: RoundTiming[],
): Promise<Anthropic.Message> {
  const fast = fastWanted();
  const start = performance.now();
  const round: RoundTiming = {
    first_event_ms: null,
    first_text_ms: null,
    ms: 0,
    tools_ms: 0,
    speed: fast ? "fast" : "standard",
  };
  timing.push(round);
  const since = () => Math.round(performance.now() - start);
  try {
    const body = request(messages, context, lastRound, style, fast);
    // A fast request is not retried at fast speed: it falls back to standard at once.
    const options = fast ? { maxRetries: 0 } : undefined;
    let message: Anthropic.Message;
    if (!onText) {
      message = await anthropic().messages.create(body, options);
    } else {
      const stream = anthropic().messages.stream(body, options);
      for await (const event of stream) {
        round.first_event_ms ??= since();
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          round.first_text_ms ??= since();
          await onText(event.delta.text);
        }
      }
      message = await stream.finalMessage();
    }
    round.ms = since();
    const u = message.usage;
    round.input_tokens = u?.input_tokens;
    round.cache_read_tokens = u?.cache_read_input_tokens ?? undefined;
    round.cache_write_tokens = u?.cache_creation_input_tokens ?? undefined;
    round.output_tokens = u?.output_tokens;
    return message;
  } catch (err) {
    // Nothing was written yet when fast mode is refused, so the same round runs at standard speed.
    if (fast && round.first_text_ms === null && fastRefused(err)) {
      console.warn("chat: fast mode refused, standard speed for a while", (err as Error).message);
      fastOffUntil = Date.now() + FAST_BACKOFF_MS;
      timing.pop();
      return callModel(messages, context, lastRound, onText, style, timing);
    }
    throw upstream(err);
  }
}

// The context text whose prompt cache was last written, per user (and visitor): a warm up with the
// same text inside the cache's 5 minutes would only pay for a second write.
const PROMPT_WARM_MS = 4 * 60_000;
const warmPrompts = new Map<string, { text: string; at: number }>();
const promptKey = () => `${currentUserId()}|${currentDemoVisitor() ?? ""}`;
const notePromptWritten = (context: string) => {
  const now = Date.now();
  for (const [k, w] of warmPrompts) if (now - w.at >= PROMPT_WARM_MS) warmPrompts.delete(k);
  warmPrompts.set(promptKey(), { text: context, at: now });
};

/**
 * Writes the prompt cache up to the context (tools, system prompt, context) with a request that
 * generates nothing (`max_tokens: 0`), so the first question reads it back instead of writing it.
 * Same model, speed, effort and tools as an answer, or the cache would not match. Best effort.
 */
async function warmPrompt(context: string): Promise<void> {
  const last = warmPrompts.get(promptKey());
  if (last && last.text === context && Date.now() - last.at < PROMPT_WARM_MS) return;
  notePromptWritten(context);
  const fast = fastWanted();
  const body = request([{ role: "user", content: "Hello" }], context, false, { spoken: false }, fast);
  try {
    await anthropic().messages.create({ ...body, max_tokens: 0 }, { maxRetries: 0 });
  } catch (err) {
    warmPrompts.delete(promptKey());
    console.warn("chat: prompt warm up failed", (err as Error).message);
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
  // Every tool call of this turn, for the claim guard after the loop (#483).
  const calls: ToolCallRecord[] = [];
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
  let steps = 0;
  // The user's own goals, read once and only when a step points at one ("Booking time for Gym").
  let goals: Promise<Map<string, string>> | null = null;
  const labelFor = async (call: Anthropic.ToolUseBlock) => {
    const blockId = blockIdOf(call.name, call.input);
    if (blockId) {
      // "Removing Boatspace": the user's own block title, never an event with other people on it.
      const event = await store.getEvent(blockId).catch(() => null);
      const own = event && event.data.with_others !== true && Number(event.data.attendees ?? 0) < 2;
      return stepLabel(call.name, call.input, undefined, own ? event.title : undefined);
    }
    const id = goalIdOf(call.name, call.input);
    if (!id) return stepLabel(call.name, call.input);
    goals ??= store
      .listGoals()
      .then((list) => new Map(list.map((g) => [g.id, g.title])))
      .catch(() => new Map<string, string>());
    return stepLabel(call.name, call.input, (await goals).get(id));
  };
  const timing: RoundTiming[] = [];
  // A plain statement ("I took a bath for 40 minutes"), not a question: when every tool of a round
  // hands back a finished line (log_done, confirm_block), that line is the answer and the model is
  // not asked again just to repeat it, which saves a whole round trip (#364).
  const last = turns.at(-1);
  const statement = typeof last?.content === "string" && !last.content.includes("?");
  for (let round = 0; round < MAX_ROUNDS; round++) {
    wrote = false;
    const response = await callModel(
      messages,
      context,
      round === MAX_ROUNDS - 1,
      onText,
      { spoken: hooks.spoken ?? false, now: hooks.now },
      timing,
    );
    if (response.stop_reason === "refusal") {
      texts.push(REFUSAL);
      break;
    }
    const text = textOf(response);
    if (text) texts.push(text);
    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) break;

    // Hand the whole turn back unchanged (thinking blocks included), then every result in one turn.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    const replies: string[] = [];
    const toolsStart = performance.now();
    for (const call of uses) {
      const step = { id: `s${++steps}`, label: hooks.onStep ? await labelFor(call) : "" };
      await hooks.onStep?.({ ...step, status: "running" });
      const outcome = await runChatTool(call.name, call.input, turn);
      await hooks.onStep?.({ ...step, status: "done" });
      if (outcome.reply && !outcome.isError) replies.push(outcome.reply);
      calls.push({ name: call.name, input: call.input, ok: !outcome.isError, content: outcome.content });
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
    const current = timing.at(-1);
    if (current) current.tools_ms = Math.round(performance.now() - toolsStart);
    if (statement && replies.length === uses.length) {
      const line = replies.join(" ");
      if (hooks.onText) await hooks.onText(text ? `\n\n${line}` : line);
      texts.push(line);
      break;
    }
    messages.push({ role: "user", content: results });
  }

  // A change is claimed only when this turn made one; otherwise one honest line and an offer (#483).
  // The stream already showed the model's words; the stored reply (the `done` event) replaces them.
  let answer = honestAnswer({
    answer: texts.join("\n\n").trim(),
    actions,
    calls,
    earlierDone: hooks.earlierDone,
  });
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
  return { answer, actions, timing };
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
  /** Everything Michael knows but the clock (cached for a few minutes, contextFor). */
  context: string;
  /** The "Now:" line (and this thread's earlier actions), sent apart from the cached context. */
  now: string;
  /** Done actions from earlier answers in the thread. */
  earlierDone: number;
  /** The answer is read aloud (conversation mode): brief, no lists. */
  spoken: boolean;
  /** Null when the pair starts a new thread (made in save, so a failed answer leaves nothing). */
  thread: ChatThread | null;
  /** The thread's name, started alongside the answer when this is its first line. */
  title: Promise<string> | null;
  /** How long building the context (and reading the thread) took. */
  contextMs: number;
  /** When each context read finished, from the start of the context, and the database round trips. */
  contextParts: Record<string, number>;
}

/** Everything both POST routes need before the model is called. */
async function prepare(body: unknown): Promise<Prepared> {
  const { message, thread_id, spoken = false } = parse(ChatRequest, body);
  const contextStart = performance.now();
  const db = currentTiming();
  const dbBefore = db?.dbCount ?? 0;
  // The context reads start alongside the thread lookup (or come from the cache).
  const handle = chatConfigured() ? ensureContext() : null;
  // Someone else's thread is a 404 even before the model is asked.
  const thread = await existingThread(thread_id);
  // Fail before storing anything when chat is not configured.
  anthropic();
  const [earlier, context] = await Promise.all([
    thread ? store.listChatMessages(thread.id, HISTORY_TURNS) : Promise.resolve([]),
    contextFor(handle ?? ensureContext(), thread?.id ?? null),
  ]);
  const nowMs = Date.now();
  const turns: Anthropic.MessageParam[] = [...toTurns(earlier, nowMs), { role: "user", content: message }];
  // What became of this thread's earlier actions, read fresh every turn (never from the cache).
  const earlierActions = await actionsOf(earlier).catch(() => []);
  const actionLines = earlierActions.length ? await threadActionLines(earlierActions, nowMs) : [];
  // Named from the first line, in parallel with the answer, so naming adds no wait.
  const title = !thread || (untitled(thread) && earlier.length === 0) ? titleFor(message) : null;
  const contextMs = Math.round(performance.now() - contextStart);
  const contextParts = context.parts;
  if (db) contextParts.db_round_trips = db.dbCount - dbBefore;
  // The answer writes the prompt cache with this context: a warm up right after it can skip.
  notePromptWritten(context.text);
  return {
    message,
    turns,
    context: context.text,
    // The clock, and this thread's actions as they stand: both per turn, after the cached context.
    now: [
      nowLine(nowMs),
      ...(actionLines.length
        ? [`What I did earlier in this conversation, as it stands now:\n${actionLines.join("\n")}`]
        : []),
    ].join("\n\n"),
    earlierDone: earlierActions.filter((a) => a.status === "done").length,
    spoken,
    thread,
    title,
    contextMs,
    contextParts,
  };
}

/** Where the time of one answer went: logged as one JSON line, and sent as the stream's `timing`. */
export interface ChatTiming {
  context_ms: number;
  context_parts: Record<string, number>;
  rounds: RoundTiming[];
  save_ms: number;
  total_ms: number;
}

function timingOf(p: Prepared, answer: MichaelAnswer, start: number, saveMs: number): ChatTiming {
  const t: ChatTiming = {
    context_ms: p.contextMs,
    context_parts: p.contextParts,
    rounds: answer.timing ?? [],
    save_ms: saveMs,
    total_ms: Math.round(performance.now() - start),
  };
  console.log(JSON.stringify({ event: "chat_timing", ...t }));
  return t;
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

/**
 * Stored lines as model turns. The first turn must be the user's, so a leading answer is dropped.
 * With `now`, a user line from an earlier day starts with its day and time in brackets, so a
 * Saturday "tomorrow" is never read on Sunday as if said today (#483).
 */
export function toTurns(history: ChatMessage[], now?: number): Anthropic.MessageParam[] {
  const first = history.findIndex((m) => m.role === "user");
  if (first === -1) return [];
  const zone = new Zone(DEFAULT_TIMEZONE);
  const today = now === undefined ? null : zone.dayOf(now);
  return history.slice(first).map((m) => {
    const at = Date.parse(m.created_at);
    const earlier = today !== null && m.role === "user" && !Number.isNaN(at) && zone.dayOf(at) !== today;
    return {
      role: m.role,
      content: earlier ? `[${weekdayIn(zone, at)}, ${zone.clock(at)}] ${m.content}` : m.content,
    };
  });
}

/**
 * What became of each action of this thread's earlier answers, as it stands now, so Michael never
 * guesses: "Gym, 10:00 to 11:00 (Sunday 15 November): undone". A block that was booked but is gone
 * from the calendar since says so, so it is never called "never added" (#483).
 */
export async function threadActionLines(actions: Recommendation[], now = Date.now()): Promise<string[]> {
  const zone = new Zone(DEFAULT_TIMEZONE);
  return Promise.all(
    actions.map(async (a) => {
      const start =
        typeof a.action?.payload?.start_at === "string" ? Date.parse(a.action.payload.start_at) : NaN;
      const day = Number.isNaN(start) ? "" : ` (${weekdayIn(zone, start)})`;
      const when = (iso: string | null | undefined) =>
        iso ? ` at ${weekdayIn(zone, Date.parse(iso))}, ${zone.clock(Date.parse(iso))}` : "";
      let state: string;
      if (a.status === "done") {
        state = `done${when(a.executed_at)}`;
        if (a.action?.kind === "create_focus_block") {
          const ex = (await store.getRecommendationExecution(a.id).catch(() => null)) as {
            timeline_event_id?: string | null;
          } | null;
          const id = ex?.timeline_event_id;
          const event = id ? await store.getEvent(id).catch(() => null) : null;
          if (id && !event) state += "; the block is no longer on the calendar (removed since, not by me)";
        }
        const until = a.action?.undo_until ? Date.parse(a.action.undo_until) : NaN;
        if (!Number.isNaN(until) && until > now) state += `; undo until ${zone.clock(until)}`;
      } else if (a.status === "undone") state = `undone${when(a.undone_at)}`;
      else if (a.status === "proposed") state = "proposed, not accepted";
      else state = `${a.status}, nothing changed`;
      return `- ${a.title}${day}: ${state}`;
    }),
  );
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
  // POST /v1/chat/warm { thread_id? }  the chat screen is open: read the context now and warm the
  // model's prompt cache with it, so the next question starts the model at once (#364). 204, and
  // nothing is stored.
  .post("/chat/warm", async (c) => {
    if (!chatConfigured()) return c.body(null, 204);
    const { thread_id } = parse(ChatWarmRequest, await c.req.json().catch(() => ({})));
    const start = performance.now();
    const handle = ensureContext();
    const context = await contextFor(handle, thread_id && thread_id !== "new" ? thread_id : null);
    void warmPrompt(context.text);
    c.header(
      "Server-Timing",
      `context;desc="${handle.hit ? "cached" : "read"}";dur=${Math.round(performance.now() - start)}`,
      {
        append: true,
      },
    );
    return c.body(null, 204);
  })
  // POST /v1/chat { message }  Michael answers from today's timeline, goals and patterns, and acts
  // on the user's own calendar when asked (ChatResponse.actions)
  .post("/chat", async (c) => {
    const start = performance.now();
    const p = await prepare(await jsonBody(c));
    const answer = await askMichael(p.turns, p.context, {
      spoken: p.spoken,
      now: p.now,
      earlierDone: p.earlierDone,
    });
    const saveStart = performance.now();
    const body = await save(p, answer);
    const t = timingOf(p, answer, start, Math.round(performance.now() - saveStart));
    const model = t.rounds.reduce((sum, r) => sum + r.ms, 0);
    c.header("Server-Timing", `context;dur=${t.context_ms}`, { append: true });
    c.header("Server-Timing", `model;desc="${t.rounds.length} rounds";dur=${model}`, { append: true });
    return c.json(body, 201);
  })
  // POST /v1/chat/stream { message }  the same answer as server-sent events: `step` ChatStep for how
  // Michael is working it out (opening "Reading your day", then each tool call), `delta` { text } as it
  // is written, `action` Recommendation for each thing done or undone, then `done` ChatResponse, or
  // `error` ApiError if the model fails mid-way.
  .post("/chat/stream", async (c) => {
    // Validation and "not set up" still fail as plain JSON errors, before the stream opens.
    const start = performance.now();
    const p = await prepare(await jsonBody(c));
    c.header("Server-Timing", `context;dur=${p.contextMs}`, { append: true });
    return streamSSE(c, async (sse) => {
      const step = (s: ChatStep) => sse.writeSSE({ event: "step", data: JSON.stringify(s) });
      // Something specific shows before the first word: "Reading your day", done at the first
      // word or the first tool step, whichever comes first.
      let opening = true;
      const closeOpening = async () => {
        if (!opening) return;
        opening = false;
        await step({ ...OPENING_STEP, status: "done" });
      };
      try {
        await step({ ...OPENING_STEP, status: "running" });
        const answer = await askMichael(p.turns, p.context, {
          spoken: p.spoken,
          now: p.now,
          earlierDone: p.earlierDone,
          onText: async (text) => {
            await closeOpening();
            await sse.writeSSE({ event: "delta", data: JSON.stringify({ text }) });
          },
          onAction: (action) => sse.writeSSE({ event: "action", data: JSON.stringify(action) }),
          onStep: async (s) => {
            await closeOpening();
            await step(s);
          },
        });
        await closeOpening();
        const saveStart = performance.now();
        const body = await save(p, answer);
        const t = timingOf(p, answer, start, Math.round(performance.now() - saveStart));
        await sse.writeSSE({ event: "timing", data: JSON.stringify(t) });
        await sse.writeSSE({ event: "done", data: JSON.stringify(body) });
      } catch (err) {
        const e = err instanceof HttpError ? err : new HttpError("internal", "Internal server error");
        if (!(err instanceof HttpError)) console.error(err);
        const body: ApiError = { error: { code: e.code, message: e.message } };
        await sse.writeSSE({ event: "error", data: JSON.stringify(body) });
      }
    });
  });
