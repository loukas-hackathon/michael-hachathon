import {
  type Event,
  type Goal,
  type GoalArea,
  type GoalSuggestion,
  voiceShortDuration,
  type Weekday,
} from "@michael/shared";
import { DAY, MINUTE, Zone } from "../patterns/time";
import { goalForEvent, isOwnBlock, normaliseTitle } from "../score/match";

// Goals from the calendar (#134). People already live by goals they never wrote down: the gym three
// evenings a week, the Tuesday and Thursday lectures, the morning deep work. This reads the user's
// own calendar blocks (nobody else in them) over the last four weeks and the week ahead, groups the
// ones that recur into goals, and proposes each with the weekly hours it adds up to and the
// calendar titles that would count towards it (`target.calendar_titles`, which the score matches).
//
// Pure: events and goals in, suggestions out. Titles already counted by an active goal are skipped,
// so accepting a suggestion makes it disappear from the next call.

export const PAST_DAYS = 28;
export const AHEAD_DAYS = 7;
const DEFAULT_ZONE = "Europe/Athens";
/** At most this many suggestions, biggest first: a first run should feel like a short list. */
const MAX_SUGGESTIONS = 6;
/** A block shorter than this is a reminder, longer than this is a day out, not a habit. */
const MIN_BLOCK_MIN = 10;
const MAX_BLOCK_MIN = 6 * 60;

export type Theme = "training" | "study" | "deep_work" | "business" | "meals" | "personal" | "skip";

// Word lists over normalised titles (lower case, accents removed, ς as σ). First theme that hits
// wins, in this order, so "Lecture: Accounting" is study and "Meeting preparation" is business.
const THEMES: [Theme, string[]][] = [
  [
    "skip",
    [
      "sleep",
      "nap",
      "commute",
      "travel",
      "flight",
      "drive",
      "busy",
      "hold",
      "ooo",
      "out of office",
      "holiday",
      "vacation",
      "birthday",
      "reminder",
      "dentist",
      "doctor",
      "ταξιδι",
      "υπνοσ",
    ],
  ],
  [
    "study",
    [
      "study",
      "studying",
      "lecture",
      "lectures",
      "class",
      "classes",
      "seminar",
      "university",
      "uni",
      "course",
      "exam",
      "exams",
      "revision",
      "homework",
      "tutorial",
      "thesis",
      "μελετη",
      "μαθημα",
      "μαθηματα",
      "φροντιστηριο",
      "διαλεξη",
      "πανεπιστημιο",
      "σχολη",
    ],
  ],
  [
    "training",
    [
      "gym",
      "run",
      "running",
      "swim",
      "swimming",
      "yoga",
      "pilates",
      "bike",
      "cycling",
      "cycle",
      "ride",
      "spin",
      "workout",
      "training",
      "crossfit",
      "football",
      "basketball",
      "tennis",
      "padel",
      "climbing",
      "boxing",
      "hike",
      "hiking",
      "rowing",
      "strength",
      "lifting",
      "long ride",
      "γυμναστηριο",
      "προπονηση",
      "κολυμπι",
      "τρεξιμο",
    ],
  ],
  ["deep_work", ["deep work", "focus", "focus time", "writing", "coding", "build", "maker time", "research"]],
  [
    "business",
    [
      "outreach",
      "sales",
      "marketing",
      "leads",
      "lead",
      "prospecting",
      "pipeline",
      "invoices",
      "admin",
      "preparation",
      "prep",
      "pitch",
      "fundraising",
      "investor update",
      "content",
      "newsletter",
    ],
  ],
  ["meals", ["breakfast", "lunch", "dinner", "meal prep", "cook", "cooking"]],
  [
    "personal",
    [
      "reading",
      "read",
      "guitar",
      "piano",
      "music practice",
      "family",
      "date night",
      "friends",
      "meditation",
      "journal",
      "journaling",
      "language",
      "spanish",
      "french",
      "german",
      "painting",
      "hobby",
      "kids",
      "οικογενεια",
      "διαβασμα",
    ],
  ],
];

// Pooled themes become one goal; a personal habit or an unknown title stays a goal of its own.
const POOLED: Partial<Record<Theme, { title: string; area: GoalArea }>> = {
  training: { title: "Training", area: "health" },
  study: { title: "Study", area: "business" },
  deep_work: { title: "Deep work", area: "business" },
  business: { title: "Business", area: "business" },
  meals: { title: "Proper meals", area: "health" },
};
const UNIVERSITY = [
  "lecture",
  "lectures",
  "university",
  "uni",
  "seminar",
  "διαλεξη",
  "πανεπιστημιο",
  "σχολη",
];

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEK_ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const tokens = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** True when the words of `phrase` appear in `words`, next to each other. */
function hasPhrase(words: string[], phrase: string): boolean {
  const p = tokens(phrase);
  for (let i = 0; i + p.length <= words.length; i++) {
    if (p.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

export function themeOf(title: string): Theme | null {
  const words = tokens(normaliseTitle(title));
  for (const [theme, list] of THEMES) if (list.some((k) => hasPhrase(words, k))) return theme;
  return null;
}

/**
 * The part of a title that stays the same week to week, as the user wrote it: "Lecture: Pricing"
 * is "Lecture", "Cold Outreach / Sales" is "Cold Outreach", "Swimming 1,500m" is "Swimming". The
 * score matches a calendar entry as a prefix, so this label also counts every variant.
 */
export function stableLabel(title: string): string {
  const cut = title.split(/\s*(?::|\/|\||\(|\[|,|\s[-–—]\s)\s*/u)[0] ?? title;
  // Trailing distances, counts and times ("1500m", "8 km", "x3", "#2") change every week.
  const label = cut.replace(/(\s+(?:[#x×]?\d[\d.,]*\s*(?:m|km|k|min|h|x)?|ii|iii|iv))+\s*$/iu, "").trim();
  return label.length > 0 ? label : title.trim();
}

/** The window suggestions read: four weeks back and the week ahead. */
export function suggestionRange(now: Date | string = new Date()): { from: string; to: string } {
  const ms = typeof now === "string" ? Date.parse(now) : now.getTime();
  return {
    from: new Date(ms - PAST_DAYS * DAY).toISOString(),
    to: new Date(ms + AHEAD_DAYS * DAY).toISOString(),
  };
}

interface Cluster {
  key: string;
  labels: Map<string, number>;
  theme: Theme | null;
  minutes: number;
  count: number;
  days: Set<string>;
  perDay: Map<string, number>;
  weekdays: Set<Weekday>;
  recurring: boolean;
  workHoursMinutes: number;
}

/**
 * Blocks a week. A window of eight days can hold the same Sunday twice, so a block is counted at
 * most as often as its weekdays allow: "Sunday long ride" twice in eight days is still once a week.
 */
function perWeek(c: Cluster, weeks: number): number {
  const most = Math.max(...c.perDay.values());
  return Math.min(c.count / weeks, c.weekdays.size * most);
}

const labelOf = (c: Cluster) =>
  [...c.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? c.key;

function joinWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** "Mon to Thu", "Tue and Thu", "Mon, Wed and Fri", "every day". */
export function daysText(days: Weekday[]): string {
  const sorted = WEEK_ORDER.filter((d) => days.includes(d));
  if (sorted.length === 7) return "every day";
  const idx = sorted.map((d) => WEEK_ORDER.indexOf(d));
  const contiguous = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? -2) + 1);
  if (sorted.length >= 3 && contiguous) {
    return `${DAY_LABEL[sorted[0] as Weekday]} to ${DAY_LABEL[sorted[sorted.length - 1] as Weekday]}`;
  }
  return joinWords(sorted.map((d) => DAY_LABEL[d]));
}

const roundBudget = (minutes: number) => Math.max(30, Math.round(minutes / 30) * 30);
const slug = (s: string) =>
  normaliseTitle(s)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

export interface SuggestOptions {
  now?: Date | string;
  timezone?: string;
}

/**
 * Goals the user already lives by, read from their own calendar blocks. `events` may hold anything;
 * only own calendar blocks inside `suggestionRange(now)` are read. `goals` are the user's goals:
 * titles an active goal already counts are skipped, and so is a suggestion with an active goal's name.
 */
export function suggestGoals(events: Event[], goals: Goal[], opts: SuggestOptions = {}): GoalSuggestion[] {
  const { from, to } = suggestionRange(opts.now ?? new Date());
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  let zone: Zone;
  try {
    zone = new Zone(opts.timezone ?? DEFAULT_ZONE);
  } catch {
    zone = new Zone(DEFAULT_ZONE);
  }
  const active = goals.filter((g) => g.active);
  const goalNames = new Set(active.map((g) => normaliseTitle(g.title)));

  const calendar = events.filter((e) => {
    if (e.type !== "calendar_event") return false;
    const start = Date.parse(e.start_at);
    return start >= fromMs && start < toMs;
  });
  if (calendar.length === 0) return [];

  // How many weeks of calendar we can see: first to last day with anything on it, at least one.
  const dayIndex = (ms: number) => Math.floor((ms + zone.offsetAt(ms)) / DAY);
  const starts = calendar.map((e) => Date.parse(e.start_at));
  const spanDays = dayIndex(Math.max(...starts)) - dayIndex(Math.min(...starts)) + 1;
  const weeks = Math.max(1, Math.round(spanDays / 7));

  const clusters = new Map<string, Cluster>();
  for (const e of calendar) {
    if (!isOwnBlock(e) || e.end_at === null) continue;
    const d = e.data;
    // Google marks events with other people even when the attendee count is missing; Michael's own
    // bookings and all day entries are not habits.
    if (d.with_others === true || d.all_day === true || d.michael === true) continue;
    const start = Date.parse(e.start_at);
    const minutes = (Date.parse(e.end_at) - start) / MINUTE;
    if (!(minutes >= MIN_BLOCK_MIN && minutes <= MAX_BLOCK_MIN)) continue;
    if (goalForEvent(e, active)) continue;
    const label = stableLabel(e.title);
    const key = normaliseTitle(label);
    if (!key || key === "busy") continue;

    let c = clusters.get(key);
    if (!c) {
      c = {
        key,
        labels: new Map(),
        theme: themeOf(label) ?? themeOf(e.title),
        minutes: 0,
        count: 0,
        days: new Set(),
        perDay: new Map(),
        weekdays: new Set(),
        recurring: false,
        workHoursMinutes: 0,
      };
      clusters.set(key, c);
    }
    c.labels.set(label, (c.labels.get(label) ?? 0) + 1);
    c.minutes += minutes;
    c.count += 1;
    const day = zone.dayOf(start);
    c.days.add(day);
    c.perDay.set(day, (c.perDay.get(day) ?? 0) + 1);
    const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] as Weekday;
    c.weekdays.add(weekday);
    if (d.recurring === true) c.recurring = true;
    const hour = ((start + zone.offsetAt(start)) % DAY) / (60 * MINUTE);
    if (weekday !== "sat" && weekday !== "sun" && hour >= 8 && hour < 18) c.workHoursMinutes += minutes;
  }

  // Group: pooled themes into one goal each, everything else on its own.
  const groups = new Map<string, { theme: Theme | null; clusters: Cluster[] }>();
  for (const c of clusters.values()) {
    if (c.theme === "skip") continue;
    const id = c.theme && POOLED[c.theme] ? c.theme : `title:${slug(c.key)}`;
    const g = groups.get(id) ?? { theme: c.theme, clusters: [] };
    g.clusters.push(c);
    groups.set(id, g);
  }

  const out: GoalSuggestion[] = [];
  for (const [id, g] of groups) {
    const days = new Set(g.clusters.flatMap((c) => [...c.days]));
    const recurring = g.clusters.some((c) => c.recurring);
    // A habit shows up on at least two days, or Google says it repeats. One-offs are noise.
    if (days.size < 2 && !recurring) continue;
    const minutes = g.clusters.reduce((s, c) => s + c.minutes, 0);
    const sessions = g.clusters.reduce((s, c) => s + perWeek(c, weeks), 0);
    const weekly = g.clusters.reduce((s, c) => s + (c.minutes / c.count) * perWeek(c, weeks), 0);
    if (weekly < 30) continue;

    const pooled = g.theme ? POOLED[g.theme] : undefined;
    const ordered = [...g.clusters].sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key));
    const titles = ordered.map(labelOf);
    let title: string;
    let area: GoalArea;
    if (pooled) {
      const university =
        g.theme === "study" && ordered.some((c) => UNIVERSITY.some((k) => hasPhrase(tokens(c.key), k)));
      title = university ? "University" : pooled.title;
      area = pooled.area;
    } else {
      title = titles[0] ?? id;
      const work = g.clusters.reduce((s, c) => s + c.workHoursMinutes, 0);
      area = g.theme === "personal" ? "personal" : work * 2 > minutes ? "business" : "personal";
    }
    if (goalNames.has(normaliseTitle(title))) continue;

    const weekdays = WEEK_ORDER.filter((d) => g.clusters.some((c) => c.weekdays.has(d)));
    const budget = roundBudget(weekly);
    out.push({
      id,
      title,
      // New goals use the three areas (#131): the category is the area.
      category: area,
      area,
      weekly_budget_minutes: budget,
      target: { kind: "time", calendar_titles: titles },
      evidence: `${joinWords(titles)}, ${daysText(weekdays)}, ${voiceShortDuration(weekly)} a week.`,
      sessions_per_week: Math.round(sessions * 10) / 10,
      days: weekdays,
    });
  }

  return out
    .sort((a, b) => b.weekly_budget_minutes - a.weekly_budget_minutes || a.id.localeCompare(b.id))
    .slice(0, MAX_SUGGESTIONS);
}
