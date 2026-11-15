import {
  type CheckInAnswerType,
  type CheckInKind,
  type CheckInMoment,
  type CheckInValue,
  type Event,
  type Goal,
  goalArea,
  goalKind,
  voiceDuration,
} from "@michael/shared";
import { napIn } from "../patterns/sleep";
import { HOUR, MINUTE, type Zone } from "../patterns/time";
import { goalForEvent } from "../score/match";

// The check in's questions (#187), drawn from the day's timeline. Pure: same input, same questions.
// Copy follows the voice sheet (packages/shared/src/voice.ts): the time or number first, then the
// answer type; a follow up offers a likely cause with its number, never a why.

/** At most this many questions in a round. */
export const MAX_QUESTIONS = 5;
/** Under this much sleep the night counts as short. */
export const SHORT_NIGHT_MINUTES = 6 * 60;
/** A stretch with nothing on the timeline worth asking about. */
export const MIN_GAP_MINUTES = 45;
/** The working day the gaps are looked for in. */
const WORK_FROM = 9 * 60;
const WORK_TO = 19 * 60;
/** A workout this close to a training block counts as that block's session. */
const WORKOUT_SLACK = HOUR;

const TRAINING =
  /\b(gym|run|running|swim|swimming|train|training|workout|bike|ride|cycling|yoga|lift|lifting|tri|70\.3|ironman|pilates|climb)/i;

export interface QuestionDraft {
  /** Stable per user and day, so the same question is never stored twice. */
  key: string;
  kind: CheckInKind;
  question: string;
  answer_type: CheckInAnswerType;
  event_id: string | null;
  goal_id: string | null;
  start_at: string | null;
  end_at: string | null;
}

export interface DayInput {
  now: number;
  zone: Zone;
  /** Events of the day (and last night's sleep), any order. */
  events: Event[];
  goals: Goal[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const startOf = (e: Event) => Date.parse(e.start_at);
const endOf = (e: Event) => (e.end_at ? Date.parse(e.end_at) : Date.parse(e.start_at));
const withOthers = (e: Event) => e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;
const isMac = (e: Event) => e.type === "app_usage" && e.source !== "iphone_usage";

/** Minutes of last night's sleep: sleep that ended this morning (before 13:00). Null with none. */
export function lastNight(input: DayInput): number | null {
  const { zone, now } = input;
  const day = zone.dayOf(now);
  const from = zone.startOfDay(zone.nextDay(day, -1)) + 18 * HOUR;
  const to = zone.at(day, 13 * 60);
  const sleeps = input.events.filter(
    (e) =>
      e.type === "sleep" &&
      e.end_at &&
      endOf(e) > from &&
      endOf(e) <= to &&
      !napIn(zone, startOf(e), endOf(e)),
  );
  if (!sleeps.length) return null;
  return Math.round(sleeps.reduce((sum, e) => sum + (endOf(e) - startOf(e)), 0) / MINUTE);
}

/** A training block: a health goal of kind time, or a title that names a sport. */
function isTraining(e: Event, goal: Goal | null): boolean {
  if (goal && goalArea(goal.category) === "health" && goalKind(goal) === "time") return true;
  return TRAINING.test(e.title) || (goal ? TRAINING.test(goal.title) : false);
}

function span(zone: Zone, start: number, end: number) {
  return `${zone.clock(start)} to ${zone.clock(end)}`;
}

/** Stretches of the working day so far with no Mac activity and nothing else on the timeline. */
export function unaccounted(input: DayInput): { start: number; end: number }[] {
  const { zone, now } = input;
  const day = zone.dayOf(now);
  const mac = input.events.filter(isMac).sort((a, b) => startOf(a) - startOf(b));
  if (mac.length < 2) return [];
  // Only between the first and the last Mac activity: before and after is not "the Mac day".
  const from = Math.max(zone.at(day, WORK_FROM), startOf(mac[0] as Event));
  const to = Math.min(zone.at(day, WORK_TO), now, Math.max(...mac.map(endOf)));
  if (to <= from) return [];
  const busy = input.events
    .filter((e) => e.type !== "app_usage" || isMac(e))
    .filter((e) =>
      ["app_usage", "calendar_event", "workout", "sleep", "focus_session", "meal", "travel"].includes(e.type),
    )
    .map((e) => ({ start: startOf(e), end: Math.max(endOf(e), startOf(e) + MINUTE) }))
    .filter((s) => s.end > from && s.start < to)
    .sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = from;
  for (const s of busy) {
    if (s.start - cursor >= MIN_GAP_MINUTES * MINUTE) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (to - cursor >= MIN_GAP_MINUTES * MINUTE) gaps.push({ start: cursor, end: to });
  return gaps;
}

/**
 * The day's questions, most useful first: a missed training block, an unaccounted stretch, a
 * training block that happened, a meeting with other people, a short night. Only what has ended.
 */
export function dayQuestions(input: DayInput): QuestionDraft[] {
  const { zone, now } = input;
  const day = zone.dayOf(now);
  const dayStart = zone.startOfDay(day);
  const goals = input.goals.filter((g) => g.active);
  const ended = input.events.filter((e) => startOf(e) >= dayStart && e.end_at && endOf(e) <= now);
  const workouts = input.events.filter((e) => e.type === "workout");
  const night = lastNight(input);
  const short = night !== null && night < SHORT_NIGHT_MINUTES;

  const missed: QuestionDraft[] = [];
  const trained: QuestionDraft[] = [];
  const meetings: QuestionDraft[] = [];
  for (const e of ended.filter((x) => x.type === "calendar_event").sort((a, b) => startOf(a) - startOf(b))) {
    const when = span(zone, startOf(e), endOf(e));
    const base = { event_id: e.id, start_at: e.start_at, end_at: e.end_at };
    if (withOthers(e)) {
      meetings.push({
        ...base,
        key: `meeting:${e.id}`,
        kind: "meeting",
        question: `${e.title}, ${zone.clock(startOf(e))}. Did it go the way you wanted?`,
        answer_type: "yes_no",
        goal_id: null,
      });
      continue;
    }
    const goal = goalForEvent(e, goals)?.goal ?? null;
    if (!isTraining(e, goal)) continue;
    const happened = workouts.some(
      (w) => startOf(w) < endOf(e) + WORKOUT_SLACK && endOf(w) > startOf(e) - WORKOUT_SLACK,
    );
    if (happened) {
      trained.push({
        ...base,
        key: `training:${e.id}`,
        kind: "training",
        question: `${e.title}, ${when}. How did it go? 1 to 5.`,
        answer_type: "scale",
        goal_id: goal?.id ?? null,
      });
    } else {
      missed.push({
        ...base,
        key: `missed:${e.id}`,
        kind: "missed_block",
        question: `${e.title}, ${when}. No workout recorded. Did you train?`,
        answer_type: "yes_no",
        goal_id: goal?.id ?? null,
      });
    }
  }

  const gaps: QuestionDraft[] = unaccounted(input)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 2)
    .map((g) => ({
      key: `unaccounted:${iso(g.start)}`,
      kind: "unaccounted",
      question: `${span(zone, g.start, g.end)} is unaccounted for on your Mac. Were you in a meeting?`,
      answer_type: "yes_no",
      event_id: null,
      goal_id: null,
      start_at: iso(g.start),
      end_at: iso(g.end),
    }));

  const sleep: QuestionDraft[] =
    short && night !== null
      ? [
          {
            key: `short_night:${day}`,
            kind: "short_night",
            question: `You slept ${voiceDuration(night)}. Energy today? 1 to 5.`,
            answer_type: "scale",
            event_id: null,
            goal_id: null,
            start_at: null,
            end_at: null,
          },
        ]
      : [];

  return [...missed, ...gaps, ...trained, ...meetings.slice(0, 2), ...sleep].slice(0, MAX_QUESTIONS);
}

/** Which round is due now: the evening from its time, else one right after a missed block. */
export function dueMoment(
  input: DayInput & { eveningAt: number; drafts: QuestionDraft[]; rounds: Set<CheckInMoment> },
): CheckInMoment | null {
  if (input.now >= input.eveningAt && !input.rounds.has("evening") && input.drafts.length > 0)
    return "evening";
  if (!input.rounds.has("missed_block") && input.drafts.some((d) => d.kind === "missed_block"))
    return "missed_block";
  return null;
}

export interface AnsweredQuestion {
  id: string;
  key: string;
  kind: CheckInKind;
  day: string;
  event_id: string | null;
  goal_id: string | null;
  start_at: string | null;
  end_at: string | null;
}

/** What an answer settles, in a word. */
export function labelFor(kind: CheckInKind, value: CheckInValue, parentKind?: CheckInKind): string | null {
  if (kind === "unaccounted") return value === "yes" ? "meeting" : value === "no" ? null : "other";
  if (kind === "missed_block") return value === "yes" ? "trained" : value === "no" ? "skipped" : null;
  if (kind === "follow_up" && parentKind) return value === "yes" ? "played_a_part" : null;
  if (typeof value === "number") return value <= 2 ? "low" : value >= 4 ? "high" : null;
  return null;
}

/**
 * The follow up an answer calls for, or null. A "no" or a low score after a short night offers the
 * night as the likely cause; an unaccounted stretch that was not a meeting asks for a few words.
 */
export function followUpFor(
  q: AnsweredQuestion,
  value: CheckInValue,
  sleptMinutes: number | null,
  zone: Zone,
): QuestionDraft | null {
  const base = {
    key: `follow_up:${q.key}`,
    kind: "follow_up" as const,
    event_id: q.event_id,
    goal_id: q.goal_id,
    start_at: q.start_at,
    end_at: q.end_at,
  };
  const short = sleptMinutes !== null && sleptMinutes < SHORT_NIGHT_MINUTES;
  const bad =
    (q.kind === "meeting" && value === "no") ||
    (q.kind === "missed_block" && value === "no") ||
    (q.kind === "training" && typeof value === "number" && value <= 2);
  if (bad && short && sleptMinutes !== null) {
    return {
      ...base,
      question: `You slept ${voiceDuration(sleptMinutes)}. Did that play a part?`,
      answer_type: "yes_no",
    };
  }
  if (q.kind === "unaccounted" && value === "no" && q.start_at && q.end_at) {
    return {
      ...base,
      question: `${span(zone, Date.parse(q.start_at), Date.parse(q.end_at))}. What was it? A few words.`,
      answer_type: "text",
    };
  }
  return null;
}
