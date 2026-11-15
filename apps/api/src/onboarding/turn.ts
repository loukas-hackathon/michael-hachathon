import {
  type Event,
  type GoalSuggestion,
  MICHAEL_VOICE,
  type OnboardingTurn,
  OnboardingTurnResponse,
  voiceDuration,
  voiceProblems,
} from "@michael/shared";
import { z } from "zod";
import { fastModelClient, ModelError } from "../analysis/model";
import { currentUserId } from "../context";
import { readByRules } from "../goals/from-words";
import { suggestGoals } from "../goals/suggest";
import { DEFAULT_TIMEZONE } from "../patterns";
import { DAY, MINUTE, Zone } from "../patterns/time";
import { store } from "../store";

// Michael's first talk with a new user (POST /v1/onboarding/turn), spoken out loud and hands free.
// The app sends every turn so far and gets Michael's next line: the opener, then one short
// reaction and one question per turn, then the line that hands over to the review. The user's
// answers are read into goals afterwards by from-words, so the questions draw out goals with time.
//
// The quick model writes the line when the server has a key; the fixed questions stand in when it
// has none, fails, is slow or breaks the voice rules, so the talk always moves. What the line may
// say about the user's week comes from facts computed here from their own calendar: the model
// phrases them and is checked against them, it never counts anything itself. Nothing is saved and
// nothing the user said is logged.

/** A spoken conversation: past this the scripted question goes out instead. */
export const MODEL_TIMEOUT_MS = 6_000;
/** After this many answers Michael has heard enough, whatever is missing. */
const MAX_USER_TURNS = 5;
const MAX_LINE = 320;

// ---------- the user's real week, as facts ----------

const PAST_DAYS = 28;
const RECENT_DAYS = 7;

export interface WeekFacts {
  /** The user's own recurring blocks, biggest first (at most three). */
  recurring: GoalSuggestion[];
  /** Meetings with other people in the last 7 days. */
  meetings: { count: number; minutes: number };
  /** Weekdays in the last 7 days with nothing in the calendar before 12:00. */
  freeMornings: number;
  /** Days in the last 7 with something in the calendar after 22:00. */
  lateEvenings: number;
}

const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const isWeekday = (day: string) => {
  const d = weekdayOf(day);
  return d >= 1 && d <= 5;
};

/**
 * What the user's Google Calendar shows about their week, or null when it shows nothing (not
 * connected, or empty). Pure: events in, facts out.
 */
export function weekFacts(events: Event[], now: Date = new Date()): WeekFacts | null {
  const nowMs = now.getTime();
  const calendar = events.filter(
    (e) =>
      e.type === "calendar_event" &&
      e.source === "google_calendar" &&
      e.data.all_day !== true &&
      Date.parse(e.start_at) >= nowMs - PAST_DAYS * DAY &&
      Date.parse(e.start_at) <= nowMs + 7 * DAY,
  );
  if (calendar.length === 0) return null;
  const zone = new Zone(DEFAULT_TIMEZONE);

  const recurring = suggestGoals(calendar, [], { now }).slice(0, 3);

  const recentFrom = nowMs - RECENT_DAYS * DAY;
  const recent = calendar.filter((e) => {
    const start = Date.parse(e.start_at);
    return start >= recentFrom && start <= nowMs;
  });
  const meetings = { count: 0, minutes: 0 };
  const busyMornings = new Set<string>();
  const late = new Set<string>();
  for (const e of recent) {
    const start = Date.parse(e.start_at);
    const end = e.end_at ? Date.parse(e.end_at) : start;
    const attendees = typeof e.data.attendees === "number" ? e.data.attendees : 0;
    if (attendees > 0 || e.data.with_others === true) {
      meetings.count += 1;
      meetings.minutes += Math.max(0, (end - start) / MINUTE);
    }
    if (zone.minuteOfDay(start) < 12 * 60) busyMornings.add(zone.dayOf(start));
    // Ends after 22:00, or runs past midnight.
    if (zone.minuteOfDay(end) >= 22 * 60 || zone.dayOf(end) !== zone.dayOf(start))
      late.add(zone.dayOf(start));
  }
  // The weekdays of the last 7 local days, today included only once it is afternoon.
  const weekdays: string[] = [];
  for (let i = 1; i <= RECENT_DAYS; i++) {
    const day = zone.dayOf(nowMs - i * DAY);
    if (isWeekday(day)) weekdays.push(day);
  }
  const freeMornings = weekdays.filter((d) => !busyMornings.has(d)).length;
  return {
    recurring,
    meetings: { count: meetings.count, minutes: Math.round(meetings.minutes) },
    freeMornings,
    lateEvenings: late.size,
  };
}

/** The facts as lines the model may use. Durations as Michael says them, so they pass the check. */
export function factLines(f: WeekFacts): string[] {
  const lines = f.recurring.map((s) => {
    const sessions = Math.round(s.sessions_per_week);
    const times = sessions === 1 ? "once a week" : `${sessions} times a week`;
    return `Recurring own block: ${s.title}, ${times}, ${voiceDuration(s.weekly_budget_minutes)} a week (${s.evidence})`;
  });
  lines.push(
    f.meetings.count > 0
      ? `Meetings with other people in the last 7 days: ${f.meetings.count}, ${voiceDuration(f.meetings.minutes)} in all.`
      : "No meetings with other people in the last 7 days.",
  );
  lines.push(
    `Weekday mornings with nothing in the calendar before 12:00 in the last 7 days: ${f.freeMornings}.`,
  );
  if (f.lateEvenings > 0)
    lines.push(`Evenings with something in the calendar after 22:00 in the last 7 days: ${f.lateEvenings}.`);
  return lines;
}

// One read per user per talk: a talk lasts minutes and the facts do not change in that time.
const FACTS_TTL_MS = 5 * 60_000;
const factsCache = new Map<string, { at: number; facts: WeekFacts | null }>();

/** Clears the cached facts (tests). */
export function clearOnboardingFacts() {
  factsCache.clear();
}

async function currentWeekFacts(now = new Date()): Promise<WeekFacts | null> {
  const user = currentUserId();
  const hit = factsCache.get(user);
  if (hit && now.getTime() - hit.at < FACTS_TTL_MS) return hit.facts;
  const events = await store.listEvents({
    from: new Date(now.getTime() - PAST_DAYS * DAY).toISOString(),
    to: new Date(now.getTime() + 7 * DAY).toISOString(),
    type: ["calendar_event"],
    source: ["google_calendar"],
  });
  const facts = weekFacts(events, now);
  if (factsCache.size > 1000) factsCache.clear();
  factsCache.set(user, { at: now.getTime(), facts });
  return facts;
}

// ---------- where the talk stands ----------

// "That's it", "I'm done", "nothing else", "let's go": the user wants to stop talking.
const DONE_WORDS =
  /\b(that'?s (it|all|everything|about it|enough)|i'?m (done|finished)|i think that'?s it|nothing (else|more)|no(thing)? more|let'?s (go|start|begin)|enough (for now|talking)|we'?re done|that covers it)\b/i;

export interface TalkState {
  /** Turns the user answered (said something, did not skip). */
  answers: string[];
  userTurns: number;
  /** The last user turn was skipped. */
  lastSkipped: boolean;
  /** The last two user turns were both skipped. */
  twoSkips: boolean;
  /** What a rough reading of the answers already covers. */
  covered: { goals: string[]; time: boolean; leaks: boolean };
  /** Michael has enough, or the user is done: the next line hands over to the review. */
  finish: boolean;
}

const skipped = (t: OnboardingTurn) => t.role === "user" && (t.skipped === true || !t.text.trim());

export function talkState(turns: OnboardingTurn[]): TalkState {
  const user = turns.filter((t) => t.role === "user");
  const answers = user.filter((t) => !skipped(t)).map((t) => t.text.trim());
  const last = user.at(-1);
  const lastSkipped = last ? skipped(last) : false;
  const twoSkips = user.length >= 2 && user.slice(-2).every(skipped);
  const read = readByRules(answers.join(".\n"));
  const covered = {
    goals: read.goals.map((g) => g.title),
    time: read.goals.some((g) => !g.estimated),
    leaks: read.notes.length > 0,
  };
  const saidDone = last !== undefined && !lastSkipped && DONE_WORDS.test(last.text);
  const enough = covered.goals.length > 0 && covered.time && covered.leaks;
  return {
    answers,
    userTurns: user.length,
    lastSkipped,
    twoSkips,
    covered,
    finish: user.length >= MAX_USER_TURNS || twoSkips || saidDone || enough,
  };
}

// ---------- the script (no key, the model failed, was slow or broke the rules) ----------

export const SCRIPT_QUESTIONS = [
  "What are you working towards right now?",
  "What would make this a good week? Roughly how much time does each thing need?",
  "Where does your time go that you wish it didn't?",
] as const;

const OPENER = `Hi, I'm Michael. I'm here to find the time you lose and give it back to what matters. ${SCRIPT_QUESTIONS[0]}`;

/** The scripted opener: from the calendar when it shows something, else the plain one. */
export function scriptOpener(facts: WeekFacts | null): { line: string; from_calendar: boolean } {
  const top = facts?.recurring[0];
  if (top)
    return {
      line: `Hi, I'm Michael. I had a look at your last four weeks. ${top.title} takes about ${voiceDuration(top.weekly_budget_minutes)} of your week. ${SCRIPT_QUESTIONS[0]}`,
      from_calendar: true,
    };
  if (facts && facts.meetings.count > 0)
    return {
      line: `Hi, I'm Michael. I had a look at your calendar. ${facts.meetings.count === 1 ? "One meeting" : `${facts.meetings.count} meetings`} with other people in the last 7 days. ${SCRIPT_QUESTIONS[0]}`,
      from_calendar: true,
    };
  return { line: OPENER, from_calendar: false };
}

/** The line that hands over to the review. */
export function handoverLine(state: TalkState): string {
  if (state.answers.length === 0) return "No problem. We'll start simple and fill the rest in as we go.";
  return "That's plenty. Here's what I heard.";
}

/** The next fixed question not yet asked or answered, or null when they are all done. */
export function nextScriptQuestion(turns: OnboardingTurn[], state: TalkState): string | null {
  const asked = turns
    .filter((t) => t.role === "michael")
    .map((t) => t.text.toLowerCase())
    .join("\n");
  const covered = [state.covered.goals.length > 0, state.covered.time, state.covered.leaks];
  const i = SCRIPT_QUESTIONS.findIndex((q, n) => !covered[n] && !asked.includes(q.toLowerCase()));
  return i === -1 ? null : (SCRIPT_QUESTIONS[i] as string);
}

function scriptTurn(turns: OnboardingTurn[], state: TalkState): OnboardingTurnResponse {
  const question = state.finish ? null : nextScriptQuestion(turns, state);
  if (!question) return { line: handoverLine(state), done: true, from_calendar: false, source: "script" };
  const reaction = state.lastSkipped ? "No problem." : "Got it.";
  return { line: `${reaction} ${question}`, done: false, from_calendar: false, source: "script" };
}

// ---------- Claude ----------

const SYSTEM = `${MICHAEL_VOICE}

Task: this is the user's first talk with Michael, out loud and hands free. You write Michael's next line. A voice reads it aloud, so it must sound like a warm person talking, never like a form or a survey. They should feel heard and never tired: get the most useful answer from the fewest, most natural turns.

What we want to learn, roughly in this order:
1. What they are working towards right now: business, health, personal.
2. Roughly how much time a week each needs, and when (which days, mornings or evenings).
3. What gets in the way: the phone, meetings, late nights, anything.
4. Anything non negotiable (the school run, Sunday with family, training).
Ask about two of these in one question when it sounds natural ("What are you working towards, and how many hours a week does it need?"). Never ask about something they already answered. If they skipped a question, move on to the next topic and never ask it again.

The line:
- Opener (no turns yet): introduce yourself in a few words and ask one open question. If calendar facts are given, mention one or two real things from their week, numbers exactly as the facts write them, and ask about them in a way that draws out their goals ("Gym 3 times a week and nothing before 12:00 on 4 mornings. Is that the week you want?").
- Later turns: first a short reaction that shows you listened, using their own words or the detail that matters ("Investors by December, got it."). Never generic praise like "great", "love that" or "sounds good". Then exactly ONE question.
- Finishing (when the brief says finish, or when you already have goals with some sense of time and something about what gets in the way): a short reaction to their last answer, then hand over to the review, for example "That's plenty. Here's what I heard." No question. Set done true.
- At most 3 short sentences and 45 words. It is speech: no lists, no brackets, no abbreviations, no quotes.
- Use only numbers that appear in the calendar facts or in the user's own words. Never invent a number.
- done: true only when finishing. uses_calendar: true when the line refers to something from the calendar facts.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["line", "done", "uses_calendar"],
  properties: {
    line: { type: "string" },
    done: { type: "boolean" },
    uses_calendar: { type: "boolean" },
  },
} as const;

const ModelAnswer = z.object({ line: z.string(), done: z.boolean(), uses_calendar: z.boolean() });

/** The brief for one turn: the facts, the talk so far, what is covered and what this turn is. */
export function briefFor(turns: OnboardingTurn[], facts: WeekFacts | null, state: TalkState): string {
  const factText = facts
    ? `Calendar facts (the user's own Google Calendar):\n${factLines(facts)
        .map((l) => `- ${l}`)
        .join("\n")}`
    : "No calendar connected.";
  if (state.userTurns === 0) return `${factText}\n\nTurn: opener.`;
  const talk = turns
    .map((t) =>
      t.role === "michael"
        ? `Michael: ${t.text}`
        : skipped(t)
          ? "User: [skipped this question]"
          : `User: ${t.text}`,
    )
    .join("\n");
  const heard = [
    `goals heard: ${state.covered.goals.length ? state.covered.goals.join(", ") : "none yet"}`,
    `time named: ${state.covered.time ? "yes" : "not yet"}`,
    `what gets in the way: ${state.covered.leaks ? "yes" : "not yet"}`,
  ].join("; ");
  const turn = state.finish
    ? "finish (they have said enough or want to stop): react to their last answer and hand over, no question."
    : state.lastSkipped
      ? "follow up. They skipped the last question: move on to another topic without asking it again."
      : "follow up.";
  return `${factText}\n\nConversation so far:\n${talk}\n\nRough reading so far: ${heard}.\n\nTurn: ${turn}`;
}

/**
 * True when a model line can be spoken: finished, short, in the voice, and with no number that is
 * not in the facts or the user's words.
 */
export function speakable(line: string, allowed: string): boolean {
  if (line.length < 10 || line.length > MAX_LINE || /\n/.test(line)) return false;
  if (!/[.?]$/.test(line)) return false;
  if (voiceProblems(line).length > 0) return false;
  const known = new Set(allowed.match(/\d+/g) ?? []);
  return (line.match(/\d+/g) ?? []).every((n) => known.has(n));
}

async function modelTurn(
  turns: OnboardingTurn[],
  facts: WeekFacts | null,
  state: TalkState,
  timeoutMs: number,
): Promise<OnboardingTurnResponse | null> {
  const client = fastModelClient();
  const brief = briefFor(turns, facts, state);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reply = await Promise.race([
    client.complete({
      system: SYSTEM,
      user: brief,
      schema: SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ModelError("api", "the model timed out")), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  const answer = ModelAnswer.parse(JSON.parse(reply.text));
  const line = answer.line.replace(/\s+/g, " ").trim();
  if (!speakable(line, brief)) return null;

  const question = line.endsWith("?");
  let done: boolean;
  if (state.finish) {
    // Finishing hands over: a question here would leave the user waiting for a talk that is over.
    if (question) return null;
    done = true;
  } else if (answer.done && state.answers.length > 0 && !question) {
    done = true;
  } else {
    // Still talking: the line must ask something.
    if (!question) return null;
    done = false;
  }
  return { line, done, from_calendar: facts !== null && answer.uses_calendar, source: "model" };
}

export interface TurnOptions {
  timeoutMs?: number;
  now?: Date;
}

/** POST /v1/onboarding/turn: Michael's next line. Never throws for a model problem. */
export async function onboardingTurn(
  turns: OnboardingTurn[],
  opts: TurnOptions = {},
): Promise<OnboardingTurnResponse> {
  const state = talkState(turns);
  const facts = await currentWeekFacts(opts.now).catch(() => null);
  try {
    const reply = await modelTurn(turns, facts, state, opts.timeoutMs ?? MODEL_TIMEOUT_MS);
    if (reply) return OnboardingTurnResponse.parse(reply);
    console.warn("[onboarding] model line failed the checks, using the script");
  } catch (err) {
    // The kind only: a parse error can quote the reply, and the reply can quote the user.
    const why = err instanceof ModelError ? err.kind : err instanceof Error ? err.name : "unknown";
    console.warn(`[onboarding] model unavailable (${why}), using the script`);
  }
  if (state.userTurns === 0)
    return OnboardingTurnResponse.parse({ ...scriptOpener(facts), done: false, source: "script" });
  return OnboardingTurnResponse.parse(scriptTurn(turns, state));
}
