import type { CheckIn, CheckInMoment, CheckInToday, CheckInValue } from "@michael/shared";
import { HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { HOUR, Zone } from "../patterns/time";
import { type NewCheckIn, type StoredCheckIn, store } from "../store";
import {
  dayQuestions,
  dueMoment,
  followUpFor,
  labelFor,
  lastNight,
  MAX_QUESTIONS,
  type QuestionDraft,
} from "./questions";

// The check in (#187): opens a round when one is due, stores answers once, asks a follow up only
// when the answer calls for one. Everything runs as the current user through the store.

/** The Evening round opens from this local time (minutes after midnight). */
export const EVENING_FROM = 20 * 60;
const CONTEXT_DAYS = 7;

const publicOf = ({ key: _key, ...c }: StoredCheckIn): CheckIn => c;

/** Questions in the order to ask them: each follow up straight after its question. */
export function ordered(rows: StoredCheckIn[]): StoredCheckIn[] {
  const roots = rows.filter((r) => !r.follow_up_of);
  const out: StoredCheckIn[] = [];
  for (const r of roots) {
    out.push(r);
    out.push(...rows.filter((f) => f.follow_up_of === r.id));
  }
  // Follow ups whose question was deleted still show.
  out.push(...rows.filter((r) => r.follow_up_of && !out.includes(r)));
  return out;
}

async function dayEvents(zone: Zone, day: string, now: number) {
  // From last evening, for last night's sleep, to now.
  const from = zone.startOfDay(day) - 6 * HOUR;
  return store.listEvents({ from: new Date(from).toISOString(), to: new Date(now).toISOString() });
}

const toNew = (d: QuestionDraft, day: string, moment: CheckInMoment): NewCheckIn => ({
  ...d,
  day,
  moment,
  follow_up_of: null,
});

/** Today's check in, opening a round when one is due (at most two a day). */
export async function checkInToday(now = Date.now(), timezone = DEFAULT_TIMEZONE): Promise<CheckInToday> {
  const zone = new Zone(timezone);
  const day = zone.dayOf(now);
  const [events, goals, existing] = await Promise.all([
    dayEvents(zone, day, now),
    store.listGoals(),
    store.listCheckIns({ fromDay: day, toDay: day }),
  ]);
  const drafts = dayQuestions({ now, zone, events, goals });
  const known = new Set(existing.map((c) => c.key));
  const fresh = drafts.filter((d) => !known.has(d.key));
  const rounds = new Set(existing.filter((c) => !c.follow_up_of).map((c) => c.moment));
  const moment = dueMoment({
    now,
    zone,
    events,
    goals,
    eveningAt: zone.at(day, EVENING_FROM),
    drafts: fresh,
    rounds,
  });
  let rows = existing;
  if (moment) {
    // After a missed block only that question; in the evening the rest, up to five a round.
    const pick = moment === "missed_block" ? fresh.filter((d) => d.kind === "missed_block") : fresh;
    const created = await store.createCheckIns(
      pick.slice(0, MAX_QUESTIONS).map((d) => toNew(d, day, moment)),
    );
    rows = [...existing, ...created];
  }
  const questions = ordered(rows);
  const open = questions.find((q) => q.answer === null);
  return { day, open: Boolean(open), moment: open?.moment ?? null, questions: questions.map(publicOf) };
}

/** Stores an answer once, labels what it settles, and asks the follow up it calls for. */
export async function answerCheckIn(
  id: string,
  value: CheckInValue,
  now = Date.now(),
  timezone = DEFAULT_TIMEZONE,
): Promise<{ check_in: CheckIn; follow_up: CheckIn | null }> {
  const q = await store.getCheckIn(id);
  if (!q) throw new HttpError("not_found", "Check in question not found");
  if (q.answer !== null) throw new HttpError("conflict", "That one is already answered");
  if (q.answer_type === "scale" && typeof value === "string" && /^[1-5]$/.test(value.trim())) {
    value = Number(value.trim());
  }
  if (q.answer_type === "yes_no" && typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "yes" || v === "no") value = v;
  }
  const parent = q.follow_up_of ? await store.getCheckIn(q.follow_up_of) : null;
  const label = labelFor(q.kind, value, parent?.kind);
  const answered = await store.answerCheckIn(id, { answer: value, label });
  if (!answered) throw new HttpError("not_found", "Check in question not found");

  let followUp: StoredCheckIn | null = null;
  if (q.kind !== "follow_up") {
    const zone = new Zone(timezone);
    const slept = lastNight({ now, zone, events: await dayEvents(zone, q.day, now), goals: [] });
    const draft = followUpFor(q, value, slept, zone);
    if (draft) {
      const [created] = await store.createCheckIns([
        { ...draft, day: q.day, moment: q.moment, follow_up_of: q.id },
      ]);
      followUp = created ?? null;
    }
  }
  return { check_in: publicOf(answered), follow_up: followUp ? publicOf(followUp) : null };
}

export async function deleteCheckIn(id: string): Promise<void> {
  if (!(await store.deleteCheckIn(id))) throw new HttpError("not_found", "Check in question not found");
}

const shown = (v: CheckInValue) =>
  typeof v === "number" ? `${v} of 5` : v === "yes" || v === "no" ? v : `"${v}"`;

/** One answered question as a line for the model: the question, then the user's own answer. */
export function checkInLine(c: CheckIn): string {
  const label = c.label ? ` [${c.label}]` : "";
  return `- ${c.day}: ${c.question} Answer: ${c.answer === null ? "not answered" : shown(c.answer)}${label}`;
}

/**
 * What the user told Michael in the last week, and today's open questions with their ids, for
 * the chat and the analysis. Best effort: a failed read gives empty lists.
 */
export async function checkInContext(
  now = Date.now(),
  timezone = DEFAULT_TIMEZONE,
): Promise<{ answered: CheckIn[]; open: CheckIn[] }> {
  const zone = new Zone(timezone);
  const day = zone.dayOf(now);
  try {
    const rows = ordered(await store.listCheckIns({ fromDay: zone.nextDay(day, -CONTEXT_DAYS), toDay: day }));
    return {
      answered: rows.filter((r) => r.answer !== null).map(publicOf),
      open: rows.filter((r) => r.answer === null && r.day === day).map(publicOf),
    };
  } catch (err) {
    console.error("check in context failed", err);
    return { answered: [], open: [] };
  }
}
