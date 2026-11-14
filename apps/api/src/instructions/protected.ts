import type { Instruction } from "@michael/shared";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { Zone } from "../patterns/time";
import { titleMatchesAny } from "../score/match";

// Standing instructions are the user's ground rules ("keep Sundays clear", "home every day by
// 21:00"). This file answers one question for the planner, the analysis and the actions: which
// instructions does a span of time fall under? Pure: the timezone is passed in, no clock is read.
//
// The time each kind protects, in the user's local time:
//
//   clear_day    the whole local day, midnight to midnight, on each of `days`.
//   home_by      from `time` until 05:00 the next morning, on each of `days` (every day when
//                `days` is absent). A block at 00:30 is after 21:00 of the day before: the small
//                hours belong to the evening that ran into them. A `time` before 05:00 ("home by
//                01:00") is that night's small hours.
//   quiet_hours  from `time` to `end_time`, starting on each of `days` (every day when absent).
//                When `end_time` is not after `time` the window runs past midnight (22:00 to
//                07:00) and belongs to the day it starts on.
//   custom       nothing: it is text for the coach to read.
//
// A span falls under an instruction when any part of it is inside protected time. Ends are
// exclusive: a block that stops at Sunday 00:00 has not touched Sunday. An instruction that is
// paused (`active: false`) or incomplete (a clear_day without days) protects nothing.
//
// `exceptions` are calendar titles allowed inside the protected time ("Rhefuel" on a clear
// Sunday), matched like a goal's `calendar_titles` (score/match.ts). `forbiddenBy` leaves out the
// instructions whose exceptions name the block.

/** Where a home_by night ends: 05:00 the next morning, local time. */
export const HOME_BY_NIGHT_ENDS = 5 * 60;

const minutesOf = (clock: string): number => {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** 0 = Sunday .. 6 = Saturday, for a local day written "YYYY-MM-DD". */
const weekdayOf = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
};

const onDay = (instruction: Instruction, day: string, everyDayWhenAbsent: boolean): boolean =>
  instruction.days ? instruction.days.includes(weekdayOf(day)) : everyDayWhenAbsent;

/** The time `instruction` protects that starts on the local day `day`, or null when it protects none. */
export function protectedWindow(
  instruction: Instruction,
  day: string,
  zone: Zone,
): { start: number; end: number } | null {
  if (!instruction.active) return null;
  const nextMidnight = zone.startOfDay(zone.nextDay(day));
  if (instruction.kind === "clear_day") {
    return onDay(instruction, day, false) ? { start: zone.startOfDay(day), end: nextMidnight } : null;
  }
  if (instruction.kind === "home_by") {
    if (!instruction.time || !onDay(instruction, day, true)) return null;
    const from = minutesOf(instruction.time);
    return {
      start: zone.at(day, from < HOME_BY_NIGHT_ENDS ? from + 1440 : from),
      end: zone.at(day, 1440 + HOME_BY_NIGHT_ENDS),
    };
  }
  if (instruction.kind === "quiet_hours") {
    if (!instruction.time || !instruction.end_time || !onDay(instruction, day, true)) return null;
    const from = minutesOf(instruction.time);
    const to = minutesOf(instruction.end_time);
    // 22:00 to 07:00 ends tomorrow: minutes past 1440 reach into the next day.
    return { start: zone.at(day, from), end: zone.at(day, to > from ? to : to + 1440) };
  }
  return null;
}

const toMs = (t: string | number): number => (typeof t === "number" ? t : Date.parse(t));

/**
 * The active instructions the span [start, end) falls under, in the order given. `start` and
 * `end` are instants (ISO strings or ms); an empty span is read as the instant `start`.
 */
export function protectedBy(
  instructions: Instruction[],
  start: string | number,
  end: string | number,
  timezone: string | Zone = DEFAULT_TIMEZONE,
): Instruction[] {
  const zone = typeof timezone === "string" ? new Zone(timezone) : timezone;
  const from = toMs(start);
  const to = Math.max(toMs(end), from + 1);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new RangeError("start and end must be instants");
  // A window that started yesterday (quiet hours past midnight) can still cover this span.
  const first = zone.nextDay(zone.dayOf(from), -1);
  const days: string[] = [];
  for (let day = first; zone.startOfDay(day) < to; day = zone.nextDay(day)) days.push(day);
  return instructions.filter((instruction) =>
    days.some((day) => {
      const window = protectedWindow(instruction, day, zone);
      return window !== null && window.start < to && window.end > from;
    }),
  );
}

/** True when `title` is one of the instruction's named exceptions. */
export const isException = (instruction: Instruction, title: string | null | undefined): boolean =>
  Boolean(title && instruction.exceptions?.length && titleMatchesAny(title, instruction.exceptions));

/**
 * The active instructions a block called `title` over [start, end) would break: `protectedBy`
 * without the ones whose exceptions name the block. A null title matches no exception.
 */
export function forbiddenBy(
  instructions: Instruction[],
  title: string | null | undefined,
  start: string | number,
  end: string | number,
  timezone: string | Zone = DEFAULT_TIMEZONE,
): Instruction[] {
  return protectedBy(instructions, start, end, timezone).filter((i) => !isException(i, title));
}

const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "Saturdays and Sundays", Monday first. */
const dayList = (days: number[]): string => {
  const names = [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_NAMES[d]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/**
 * Why Michael will not plan into an instruction's time, in one line in his voice, derived from
 * the instruction itself: "Sundays are kept clear.", "You're home by 21:00.", "That's in your
 * quiet hours." The user's own words stay as they wrote them; this line is Michael's.
 */
export function refusalReason(instruction: Instruction): string {
  switch (instruction.kind) {
    case "clear_day":
      return instruction.days?.length
        ? `${dayList(instruction.days)} are kept clear.`
        : "That day is kept clear.";
    case "home_by":
      return instruction.time ? `You're home by ${instruction.time}.` : "You're home by then.";
    case "quiet_hours":
      return "That's in your quiet hours.";
    default:
      return "That breaks one of your standing instructions.";
  }
}

/**
 * How the coach reads an instruction: the user's words, with the exceptions in words.
 * "Keep Sundays clear (except: Rhefuel)".
 */
export function instructionLine(instruction: Instruction): string {
  const text = instruction.text.trim();
  return instruction.exceptions?.length ? `${text} (except: ${instruction.exceptions.join(", ")})` : text;
}
