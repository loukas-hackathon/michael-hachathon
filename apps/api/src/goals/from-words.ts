import {
  type GoalArea,
  GoalWordsResponse,
  type HeardGoal,
  MICHAEL_VOICE,
  voiceDuration,
  voiceProblems,
} from "@michael/shared";
import { z } from "zod";
import { modelClient } from "../analysis/model";

// Goals from the user's own words (the onboarding talk). People do not speak in goals: "the startup
// mostly, investors in December, and I want to get back to the gym, I keep losing nights on my
// phone". This turns that, typed or transcribed, into at most five goals with weekly hours, plus a
// few notes on how the user works. Nothing is saved here: the app shows what was heard, the user
// fixes it, and only then are goals created. Claude reads it when the server has a key; the word
// lists below read it otherwise, or when the model fails or is slow, so the talk always ends.

const MAX_WEEK = 7 * 24 * 60;
const MODEL_TIMEOUT_MS = 25_000;

// ---------- the word lists (no key, or the model failed) ----------

type Theme = {
  title: string;
  area: GoalArea;
  words: RegExp;
  /** A starting budget when the user named no time. */
  minutes: number;
  /** One session, for "three times a week". */
  session: number;
  calendar: string[];
};

// First match wins, so "study for the exam" is Study, not Deep work. Greek included: the users are.
const THEMES: Theme[] = [
  {
    title: "Study",
    area: "business",
    words: /\b(stud(y|ying)|exams?|uni(versity)?|lectures?|thesis|revision|course|μελετ|εξεταστ|σχολ)/i,
    minutes: 8 * 60,
    session: 120,
    calendar: ["Study", "Lecture", "Revision"],
  },
  {
    title: "Fundraising",
    area: "business",
    words: /\b(investors?|fundrais\w*|raise|raising|pitch deck|vcs?|round)\b/i,
    minutes: 5 * 60,
    session: 90,
    calendar: ["Investor", "Fundraising", "Pitch"],
  },
  {
    title: "Sales",
    area: "business",
    words: /\b(sales|customers?|clients?|outreach|leads?|revenue|sell)\b/i,
    minutes: 6 * 60,
    session: 90,
    calendar: ["Sales", "Outreach", "Customer"],
  },
  {
    title: "Ship the product",
    area: "business",
    words: /\b(ship|launch|product|build(ing)?|code|coding|mvp|app|feature|startup|company|business)\b/i,
    minutes: 10 * 60,
    session: 120,
    calendar: ["Deep work", "Build", "Focus"],
  },
  {
    title: "Deep work",
    area: "business",
    words: /\b(deep work|focus|work|writ(e|ing)|δουλει)/i,
    minutes: 10 * 60,
    session: 120,
    calendar: ["Deep work", "Focus"],
  },
  {
    title: "Sleep",
    area: "health",
    words: /\b(sleep|bed|rest|ύπνο|υπνο)/i,
    minutes: 7.5 * 60 * 7,
    session: 0,
    calendar: [],
  },
  {
    title: "Training",
    area: "health",
    words:
      /\b(gym|train(ing)?|work ?out|run(ning)?|swim(ming)?|yoga|fitness|marathon|triathlon|cycl(e|ing)|bike|lift(ing)?|sport|football|tennis|padel|γυμναστ)/i,
    minutes: 4 * 60,
    session: 60,
    calendar: ["Gym", "Run", "Swim", "Training"],
  },
  {
    title: "Proper meals",
    area: "health",
    words: /\b(eat(ing)?|meals?|cook(ing)?|lunch|dinner|breakfast|diet|food)\b/i,
    minutes: 5 * 60,
    session: 45,
    calendar: ["Lunch", "Dinner", "Breakfast"],
  },
  {
    title: "Family",
    area: "personal",
    words: /\b(family|kids?|children|son|daughter|wife|husband|partner|girlfriend|boyfriend|parents|οικογ)/i,
    minutes: 6 * 60,
    session: 120,
    calendar: ["Family"],
  },
  {
    title: "Friends",
    area: "personal",
    words: /\b(friends?|social life|going out|night out|φιλ)/i,
    minutes: 3 * 60,
    session: 120,
    calendar: ["Friends", "Dinner with"],
  },
  {
    title: "Reading",
    area: "personal",
    words: /\b(read(ing)?|books?)\b/i,
    minutes: 3 * 60,
    session: 30,
    calendar: ["Reading"],
  },
  {
    title: "Time for yourself",
    area: "personal",
    words: /\b(hobby|guitar|piano|music|paint(ing)?|myself|me time|travel|fun)\b/i,
    minutes: 3 * 60,
    session: 60,
    calendar: [],
  },
];

// What people say when they talk about where time goes. Such a clause becomes a note, not a goal.
const LEAK =
  /\b(phone|instagram|tiktok|youtube|netflix|scroll\w*|social media|twitter|x\.com|reddit|emails?|slack|meetings?|distract\w*|procrastinat\w*|waste|lose|losing|lost|late nights?|κινητ)/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  an: 1,
  a: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  half: 0.5,
};
const NUM = String.raw`(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|an|a)`;
const toNumber = (w: string) => NUMBER_WORDS[w.toLowerCase()] ?? Number(w.replace(",", "."));

/** The time a clause names, in minutes a week, or null when it names none. */
export function minutesIn(clause: string, theme: Pick<Theme, "session" | "title">): number | null {
  const daily = /\b(a|per|each|every) ?(day|night|evening|morning)\b|\bdaily\b|\bnightly\b/i.test(clause);
  const hours = clause.match(new RegExp(`${NUM}\\s*(?:hours?|hrs?|h)\\b`, "i"));
  const mins = clause.match(new RegExp(`${NUM}\\s*(?:minutes?|mins?)\\b`, "i"));
  const times = clause.match(new RegExp(`${NUM}\\s*(?:times|x|days|sessions|evenings|mornings)\\b`, "i"));
  const perDay = (m: number) => (daily || theme.title === "Sleep" ? m * 7 : m);
  if (hours?.[1]) return Math.round(perDay(toNumber(hours[1]) * 60));
  if (mins?.[1]) return Math.round(perDay(toNumber(mins[1])));
  if (times?.[1] && theme.session > 0) return Math.round(toNumber(times[1]) * theme.session);
  if (daily && theme.session > 0) return theme.session * 7;
  return null;
}

const clamp = (m: number) => Math.max(30, Math.min(MAX_WEEK, Math.round(m / 30) * 30));

/** The text cut into clauses: sentences, lines, "and", "but", "also" and commas. */
export function clauses(text: string): string[] {
  return text
    .replace(/[^\S\n]+/g, " ")
    .split(/[.!?;\n]+|,\s+|\s+(?:and also|and|but|also|plus|then)\s+/i)
    .map((c) => c.trim().replace(/^(?:and|but|also|plus|then|so|um+|uh+|like)\b[\s,]*/i, ""))
    .filter((c) => c.length >= 3);
}

const sentence = (s: string) => {
  const t = s.trim().replace(/[.,;:]+$/, "");
  return t ? `${t[0]?.toUpperCase()}${t.slice(1)}` : t;
};

function setMinutes(g: HeardGoal, minutes: number) {
  g.weekly_budget_minutes = clamp(minutes);
  g.estimated = false;
  if (g.target.kind === "target")
    g.target.sleep_hours = Math.round((g.weekly_budget_minutes / 7 / 60) * 2) / 2;
}

/** The word lists' reading: themes found in order, one goal per theme, leaks as notes. */
export function readByRules(text: string): Omit<GoalWordsResponse, "line" | "source"> {
  const goals: HeardGoal[] = [];
  const notes: string[] = [];
  for (const c of clauses(text)) {
    // "I lose my evenings on my phone" is how they work, not a goal. "I want more time for the
    // gym, I lose it to meetings" keeps both.
    if (LEAK.test(c)) {
      if (notes.length < 4) notes.push(sentence(c).slice(0, 200));
      if (!/\b(more|want|need|goal|get back|start)\b/i.test(c)) continue;
    }
    const theme = THEMES.find((t) => t.words.test(c));
    if (!theme) {
      // "Also sleep, like 7 hours": a clause that only names a time belongs to the goal before it.
      const prev = goals.at(-1);
      const prevTheme = THEMES.find((t) => t.title === prev?.title);
      const said = prev && prevTheme ? minutesIn(c, prevTheme) : null;
      if (prev && said !== null && prev.estimated) setMinutes(prev, said);
      continue;
    }
    const said = minutesIn(c, theme);
    const existing = goals.find((g) => g.title === theme.title);
    if (existing) {
      // "Gym. Three times a week": the second clause gives the first its hours.
      if (said !== null && existing.estimated) setMinutes(existing, said);
      continue;
    }
    if (goals.length >= 5) continue;
    const minutes = clamp(said ?? theme.minutes);
    const sleep = theme.title === "Sleep";
    goals.push({
      title: theme.title,
      category: theme.area,
      weekly_budget_minutes: minutes,
      target: sleep
        ? { kind: "target", sleep_hours: Math.round((minutes / 7 / 60) * 2) / 2 }
        : { kind: "time", calendar_titles: theme.calendar },
      evidence: c.slice(0, 200),
      estimated: said === null,
    });
  }
  return { goals, notes };
}

// ---------- Michael's line ----------

const COUNT = ["no goals", "one goal", "two goals", "three goals", "four goals", "five goals"];

/** The template line: how many, and what to check. Used when the model's line fails the voice rules. */
export function heardLine(goals: HeardGoal[]): string {
  if (goals.length === 0) return "I didn't hear a goal in that. What do you want more time for this week?";
  const guessed = goals.filter((g) => g.estimated).length;
  const top = goals[0] as HeardGoal;
  const lead = `I heard ${COUNT[goals.length]}. ${top.title} leads at ${voiceDuration(top.weekly_budget_minutes)} a week.`;
  if (guessed === 0) return `${lead} Keep them and we start.`;
  return `${lead} I set the hours you didn't name. Check them.`;
}

// ---------- Claude ----------

const SYSTEM = `${MICHAEL_VOICE}

Task: the user is setting up Michael. They answered a few questions out loud or in a note: what they are working towards, what this week must hold, and where their time leaks. The words may be a messy voice transcript, in English or Greek, with filler, repeats and half sentences. Read it as a coach would and return their goals.

Rules:
- At most 5 goals, the most important first. Only goals the user actually said or clearly meant. Never invent one. Merge repeats.
- Each goal: a short title in plain words, 1 to 4 words, in English, in the user's terms where possible ("Ship the beta", "Training", "Time with Eleni"). category is exactly one of business, health, personal.
- weekly_budget_minutes: per week. If they named a time, convert it ("three gym sessions" = 3 x 60, "two hours a day" = 14 hours, "ten hours" = 600) and set estimated false. If not, set a sensible starting budget and estimated true. Round to 30 minutes.
- Sleep: target.kind "target", sleep_hours per night (default 7.5), weekly_budget_minutes = 7 x hours x 60, no calendar_titles. Every other goal: target.kind "time" with 1 to 4 calendar_titles, words their calendar blocks would carry ("Gym", "Deep work", "Investor call").
- evidence: the user's own words the goal came from, trimmed, at most 15 words.
- notes: up to 4 short facts about how they work or where time goes, in plain third person without a name ("Loses evenings to the phone", "Trains best before work"). Only what they said.
- line: one or two sentences in Michael's voice, under 30 words: what you heard, the number first. If a goal is unclear or nothing usable was said, ask the one question you need instead. No dashes, no exclamation marks, no emoji.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["goals", "notes", "line"],
  properties: {
    goals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "category", "weekly_budget_minutes", "target", "evidence", "estimated"],
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: ["business", "health", "personal"] },
          weekly_budget_minutes: { type: "integer" },
          target: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: { type: "string", enum: ["time", "target"] },
              calendar_titles: { type: "array", items: { type: "string" } },
              sleep_hours: { type: "number" },
            },
          },
          evidence: { type: "string" },
          estimated: { type: "boolean" },
        },
      },
    },
    notes: { type: "array", items: { type: "string" } },
    line: { type: "string" },
  },
} as const;

const ModelAnswer = z.object({
  goals: z.array(z.unknown()),
  notes: z.array(z.string()),
  line: z.string(),
});

/** The model's goals, cleaned: bad rows dropped, numbers clamped, at most five. */
export function cleanGoals(raw: unknown[]): HeardGoal[] {
  const out: HeardGoal[] = [];
  for (const r of raw) {
    const g = r as Partial<HeardGoal> & { target?: Partial<HeardGoal["target"]> };
    const title = typeof g.title === "string" ? g.title.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (!title || !["business", "health", "personal"].includes(String(g.category))) continue;
    if (out.some((x) => x.title.toLowerCase() === title.toLowerCase())) continue;
    const sleep = g.target?.kind === "target";
    const hours = Math.min(12, Math.max(4, Number(g.target?.sleep_hours) || 7.5));
    const minutes = sleep
      ? Math.round(hours * 60 * 7)
      : clamp(Number.isFinite(g.weekly_budget_minutes) ? Number(g.weekly_budget_minutes) : 5 * 60);
    const titles = (g.target?.calendar_titles ?? [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 60))
      .slice(0, 4);
    out.push({
      title,
      category: g.category as GoalArea,
      weekly_budget_minutes: minutes,
      target: sleep
        ? { kind: "target", sleep_hours: Math.round(hours * 2) / 2 }
        : { kind: "time", calendar_titles: titles.length ? titles : [title] },
      evidence: (typeof g.evidence === "string" && g.evidence.trim() ? g.evidence.trim() : title).slice(
        0,
        200,
      ),
      estimated: g.estimated !== false,
    });
    if (out.length >= 5) break;
  }
  return out;
}

async function readByModel(text: string): Promise<GoalWordsResponse> {
  const client = modelClient();
  const reply = await Promise.race([
    client.complete({
      system: SYSTEM,
      user: `The user's words:\n"""\n${text}\n"""`,
      schema: SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("model timed out")), MODEL_TIMEOUT_MS),
    ),
  ]);
  const answer = ModelAnswer.parse(JSON.parse(reply.text));
  const goals = cleanGoals(answer.goals);
  const notes = answer.notes
    .map((n) => n.replace(/\s+/g, " ").trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 4);
  const line = answer.line.replace(/\s+/g, " ").trim();
  // A line that breaks the voice rules, or claims goals when none survived, gives way to the template.
  const usable = line.length > 0 && line.length <= 240 && voiceProblems(line).length === 0;
  return {
    goals,
    notes,
    line: usable && (goals.length > 0 || /\?$/.test(line)) ? line : heardLine(goals),
    source: "model",
  };
}

/** POST /v1/goals/from-words: Claude first, the word lists when it cannot answer. */
export async function goalsFromWords(text: string): Promise<GoalWordsResponse> {
  try {
    return GoalWordsResponse.parse(await readByModel(text));
  } catch (err) {
    // No key, a refusal, a timeout or a reply that does not parse: the talk still ends with goals.
    console.error("[goals] from words by rules:", err instanceof Error ? err.message : "unknown");
    const read = readByRules(text);
    return GoalWordsResponse.parse({ ...read, line: heardLine(read.goals), source: "rules" });
  }
}
