// Athens calendar helpers for the demo week. The API stores instants; the week is laid out in
// Europe/Athens local time, so a day is Athens midnight to Athens midnight.

export const DEMO_TZ = "Europe/Athens";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEMO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: DEMO_TZ, timeZoneName: "longOffset" });

/** Athens local date ("2026-11-14") of an instant. */
export const localDate = (ms: number): string => dateFmt.format(ms);

/** Minutes Athens is ahead of UTC at an instant (120 in winter, 180 in summer). */
function offsetMinutes(ms: number): number {
  const name = offsetFmt.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

/** The instant of Athens midnight at the start of a local date. */
export function athensMidnight(date: string): number {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const guess = utc - offsetMinutes(utc) * 60_000;
  return utc - offsetMinutes(guess) * 60_000;
}

/** A local date `days` after (or before) another. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 0 Sunday to 6 Saturday, for a local date. */
export const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

/** The instant of a local "HH:MM" on a local date ("24:30" is half past midnight the next day). */
export function at(date: string, time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return athensMidnight(date) + (h * 60 + m) * 60_000;
}

export const iso = (ms: number): string => new Date(ms).toISOString();
