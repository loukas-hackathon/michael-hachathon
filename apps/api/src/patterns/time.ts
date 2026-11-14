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

  /** The instant shifted so that the UTC getters of a Date read local wall time. */
  private wall(ms: number): Date {
    return new Date(ms + this.offsetAt(ms));
  }

  /** "YYYY-MM-DD" of the local day this instant falls on. */
  dayOf(ms: number): string {
    return this.wall(ms).toISOString().slice(0, 10);
  }

  /** Local hour of day, 0 to 23. */
  hourOf(ms: number): number {
    return this.wall(ms).getUTCHours();
  }

  /** Local minutes since midnight by the wall clock, 0 to 1439. */
  minuteOfDay(ms: number): number {
    const w = this.wall(ms);
    return w.getUTCHours() * 60 + w.getUTCMinutes();
  }

  /** "HH:MM" local wall time. */
  clock(ms: number): string {
    return this.wall(ms).toISOString().slice(11, 16);
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

  startOfDay(day: string): number {
    return this.at(day, 0);
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
