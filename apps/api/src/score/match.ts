import { type Event, type Goal, GoalCategory, goalArea } from "@michael/shared";

// THE one place that says which goal a calendar event belongs to. The score and the patterns'
// calendar mode both read it, so a block counts the same everywhere.
//
// People do not name calendar events after their goals ("Gym", "Swimming 1,500m" and "Run" all
// mean the triathlon). So a goal carries the calendar titles that count towards it:
//
//   goal.target.calendar_titles = ["Gym", "Swimming", "Run"]
//
// An event matches an entry when its title equals the entry or starts with it, ignoring case and
// accents, and the entry ends at a word boundary: "Run" matches "Run" and "Run 8k", not "Runway".
//
// Rules, first hit wins:
//   1. `data.goal_id` names a goal;
//   2. `goal.target.calendar_titles` (the longest matching entry wins);
//   3. `data.goal_category` (or `data.category`) names a goal category;
//   4. the title starts with a goal's own title;
//   5. the title starts with one of the older category words ("Gym: legs", "Work: pitch"), or
//      contains "deep work" or "focus" (work).
// Rules 3 to 5 are the older provisional ones, kept as fallbacks. A category in rules 3 and 5
// means the first goal with exactly that category, or else the first goal in the same one of the
// three categories: "work" finds a business goal, "gym" a health goal ("rest" and "food" only find
// a goal that still carries that older name). The words business, health and personal are not
// title words: "Personal training" must not land on a personal goal.
//
// An event with other people in it (`data.attendees` above 0, the number of other people) is a
// meeting: it is never the user's own block, whatever its title says.

// `logged` is never a match: it marks done time the user logged (#317), standing in for a block.
export type MatchRule =
  | "goal_id"
  | "calendar_titles"
  | "goal_category"
  | "goal_title"
  | "category_word"
  | "logged";

export interface GoalMatch {
  goal: Goal;
  rule: MatchRule;
}

/** Lower case, accents removed, spaces collapsed, so "Φροντιστήριο" equals "ΦΡΟΝΤΙΣΤΗΡΙΟ". */
export const normaliseTitle = (title: string) =>
  title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ς/g, "σ").replace(/\s+/g, " ").trim();

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** True when `title` equals `entry` or starts with it at a word boundary. Both already normalised. */
function startsWithEntry(title: string, entry: string): boolean {
  if (entry.length === 0 || !title.startsWith(entry)) return false;
  if (title.length === entry.length) return true;
  // "Run" must not claim "Runway": after the entry comes a space, a colon, anything but a letter.
  const last = entry[entry.length - 1] ?? "";
  const next = title[entry.length] ?? "";
  return !(WORD_CHAR.test(last) && WORD_CHAR.test(next));
}

/**
 * True when a calendar title matches one of `entries` the way `calendar_titles` match: equal or
 * starting with the entry at a word boundary, ignoring case and accents. Standing instructions use
 * it for their `exceptions`, so a title counts the same everywhere.
 */
export function titleMatchesAny(title: string, entries: readonly string[]): boolean {
  const t = normaliseTitle(title);
  return entries.some((entry) => startsWithEntry(t, normaliseTitle(entry)));
}

/** The calendar titles a goal lists in `target.calendar_titles`. Anything that is not text is skipped. */
export function calendarTitles(goal: Goal): string[] {
  const list = goal.target?.calendar_titles;
  if (!Array.isArray(list)) return [];
  return list.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

/** The number of other people in a calendar event. Missing or not a number reads as nobody. */
export function attendeesOf(event: Event): number {
  const n = event.data.attendees;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** A calendar event with a start and an end and nobody else in it. */
export const isOwnBlock = (event: Event) =>
  event.type === "calendar_event" && event.end_at !== null && attendeesOf(event) <= 0;

/** The category words a calendar title may start with (rule 5). */
const TitleWord = GoalCategory.extract(["work", "gym", "rest", "food"]);

/** Among goals, the one whose candidate text is the longest prefix of the title. */
function longestPrefix(title: string, goals: Goal[], candidates: (goal: Goal) => string[]): Goal | null {
  let best: Goal | null = null;
  let bestLength = 0;
  for (const goal of goals) {
    for (const candidate of candidates(goal)) {
      const entry = normaliseTitle(candidate);
      if (entry.length > bestLength && startsWithEntry(title, entry)) {
        best = goal;
        bestLength = entry.length;
      }
    }
  }
  return best;
}

/**
 * The goal a calendar event counts towards, and the rule that said so. Null when the event is not
 * the user's own block or belongs to no goal. Pass the goals that may be matched (active ones).
 */
export function goalForEvent(event: Event, goals: Goal[]): GoalMatch | null {
  if (!isOwnBlock(event) || goals.length === 0) return null;
  // The older `rest` and `food` never meant training: they only find a goal that still says so.
  const byCategory = (category: GoalCategory) =>
    goals.find((g) => g.category === category) ??
    (category === "rest" || category === "food"
      ? undefined
      : goals.find((g) => goalArea(g.category) === goalArea(category)));

  const named = goals.find((g) => g.id === event.data.goal_id);
  if (named) return { goal: named, rule: "goal_id" };

  const title = normaliseTitle(event.title);
  const listed = longestPrefix(title, goals, calendarTitles);
  if (listed) return { goal: listed, rule: "calendar_titles" };

  const given = GoalCategory.safeParse(event.data.goal_category ?? event.data.category);
  if (given.success) {
    const goal = byCategory(given.data);
    if (goal) return { goal, rule: "goal_category" };
  }

  const titled = longestPrefix(title, goals, (g) => [g.title]);
  if (titled) return { goal: titled, rule: "goal_title" };

  const firstWord = TitleWord.safeParse(title.split(/[\s:]+/)[0] ?? "");
  const word = firstWord.success ? firstWord.data : /\b(deep work|focus)\b/.test(title) ? "work" : null;
  const goal = word ? byCategory(word) : undefined;
  return goal ? { goal, rule: "category_word" } : null;
}
