// Local time without a date library. Everything here is pure: the timezone is passed in and the
// clock is never read. Offsets come from Intl.DateTimeFormat, so daylight saving changes are
// handled by the platform's own timezone data.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// Offsets only change on quarter hours of UTC in every zone in use, so one lookup per quarter
// hour is exact and keeps tens of thousands of events fast.
const BUCKET = 15 * MINUTE;

export interface LocalDaySpan {
  /** "YYYY-MM-DD" in the zone. */
  day: string;
  /** First instant of the local day (ms). */
  start: number;
  /** First instant of the next local day (ms). 23 or 25 hours after `start` on a change day. */
  end: number;
}

export class Zone {
  private readonly format: Intl.DateTimeFormat;
  private readonly offsets = new Map<number, number>();

  constructor(readonly name: string) {
    // Throws a RangeError for an unknown zone, which is what we want.
    this.format = new Intl.DateTimeFormat("en-GB", {
      timeZone: name,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  /** Local time minus UTC at this instant, in ms (Athens: +2h in winter, +3h in summer). */
  offsetAt(ms: number): number {
    const bucket = Math.floor(ms / BUCKET);
    const cached = this.offsets.get(bucket);
    if (cached !== undefined) return cached;
    const at = bucket * BUCKET;
    const parts: Record<string, number> = {};
    for (const p of this.format.formatToParts(at)) {
      if (p.type !== "literal") parts[p.type] = Number(p.value);
    }
    const asUtc = Date.UTC(
      parts.year ?? 1970,
      (parts.month ?? 1) - 1,
      parts.day ?? 1,
      parts.hour ?? 0,
      parts.minute ?? 0,
      parts.second ?? 0,
    );
    const offset = asUtc - at;
    this.offsets.set(bucket, offset);
    return offset;
  }

  // Local wall time as a number: ms since the epoch as if the wall clock were UTC. Plain integer
  // maths on it gives the day and the hour without building a Date for every event.
  private wall(ms: number): number {
    return ms + this.offsetAt(ms);
  }

  private readonly dayNames = new Map<number, string>();

  /** "YYYY-MM-DD" of the local day this instant falls on. */
  dayOf(ms: number): string {
    const index = Math.floor(this.wall(ms) / DAY);
    let name = this.dayNames.get(index);
    if (name === undefined) {
      name = new Date(index * DAY).toISOString().slice(0, 10);
      this.dayNames.set(index, name);
    }
    return name;
  }

  /** Local hour of day, 0 to 23. */
  hourOf(ms: number): number {
    return Math.floor(this.minuteOfDay(ms) / 60);
  }

  /** Local minutes since midnight by the wall clock, 0 to 1439. */
  minuteOfDay(ms: number): number {
    const wall = this.wall(ms);
    return Math.floor((wall - Math.floor(wall / DAY) * DAY) / MINUTE);
  }

  /** "HH:MM" local wall time. */
  clock(ms: number): string {
    return new Date(this.wall(ms)).toISOString().slice(11, 16);
  }

  /**
   * The instant at which the local wall clock reads `minutes` after midnight on `day`. Minutes may
   * pass 1440 to reach into the next day (25:30 = 01:30 tomorrow). A wall time that happens twice
   * (autumn) resolves to the first. One that does not exist (the hour skipped in spring) resolves
   * as if the clock had not jumped yet, so 03:30 becomes 04:30.
   */
  at(day: string, minutes = 0): number {
    const [y, m, d] = day.split("-").map(Number);
    const target = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + minutes * MINUTE;
    // The offset just before and just after any change near the target. Trying both, earliest
    // first, picks the first instant whose wall time is the target.
    const before = this.offsetAt(target - DAY);
    const after = this.offsetAt(target + DAY);
    const candidates = [target - Math.max(before, after), target - Math.min(before, after)];
    for (const c of candidates) {
      if (c + this.offsetAt(c) === target) return c;
    }
    // Skipped wall time: both candidates miss. The later one reads the old offset.
    return candidates[1] ?? target;
  }

  private readonly dayStarts = new Map<string, number>();

  startOfDay(day: string): number {
    let start = this.dayStarts.get(day);
    if (start === undefined) {
      start = this.at(day, 0);
      this.dayStarts.set(day, start);
    }
    return start;
  }

  nextDay(day: string, step = 1): string {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + step)).toISOString().slice(0, 10);
  }

  /** Every local day that overlaps [from, to), in order. */
  days(from: number, to: number): LocalDaySpan[] {
    const out: LocalDaySpan[] = [];
    if (!(to > from)) return out;
    let day = this.dayOf(from);
    let start = this.startOfDay(day);
    while (start < to) {
      const next = this.nextDay(day);
      const end = this.startOfDay(next);
      out.push({ day, start, end });
      day = next;
      start = end;
    }
    return out;
  }

  /** Cut [start, end) at local midnights. A span inside one day comes back as one piece. */
  splitByDay(start: number, end: number): { day: string; start: number; end: number }[] {
    if (!(end > start)) return [];
    // Nearly every span sits inside one day: answer that without looking up any midnight.
    const day = this.dayOf(start);
    if (this.dayOf(end - 1) === day) return [{ day, start, end }];
    const out: { day: string; start: number; end: number }[] = [];
    let cursor = start;
    while (cursor < end) {
      const day = this.dayOf(cursor);
      const dayEnd = this.startOfDay(this.nextDay(day));
      const stop = Math.min(end, dayEnd);
      out.push({ day, start: cursor, end: stop });
      cursor = stop;
    }
    return out;
  }
}
