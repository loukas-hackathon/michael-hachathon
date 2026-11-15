// Your week (#376): small date words for the review, from local days (YYYY-MM-DD, Athens).

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/** "Thursday" for 2026-11-12. */
export const weekdayName = (day: string) => WEEKDAY.format(noon(day));

/** "9 to 15 November", or "30 November to 6 December" across a month. */
export function weekRange(from: string, to: string): string {
  const a = noon(from);
  const b = noon(to);
  const am = MONTH.format(a);
  const bm = MONTH.format(b);
  return am === bm
    ? `${a.getUTCDate()} to ${b.getUTCDate()} ${bm}`
    : `${a.getUTCDate()} ${am} to ${b.getUTCDate()} ${bm}`;
}

/** True on a Sunday in Athens: the review's own evening. */
export function isSundayIn(iso: string | Date): boolean {
  return (
    new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/Athens" }).format(new Date(iso)) ===
    "Sunday"
  );
}
