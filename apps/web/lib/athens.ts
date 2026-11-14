// Local days in Athens, the user's time zone for the demo. Pure functions, no server imports, so the
// Timeline page, the week strip and a client refresh can all share them.

export const ZONE = "Europe/Athens";
const DAY = 86_400_000;

/** YYYY-MM-DD in Athens for an instant (default now). */
export const athensDay = (d: Date | number = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(d);

export const isLocalDay = (s: string | undefined): s is string =>
  !!s && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/** The calendar day `n` days after `date`. */
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Athens' offset from UTC at an instant, in ms (+2 h in winter, +3 h in summer). */
function offsetAt(ms: number): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: ZONE, timeZoneName: "longOffset" })
      .formatToParts(ms)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+02:00";
  const m = /GMT([+-])(\d\d):(\d\d)/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/** The instant Athens reaches 00:00 on `date`, right across the clock changes. */
export function athensMidnight(date: string): number {
  const wall = Date.parse(`${date}T00:00:00Z`);
  let t = wall - offsetAt(wall - 2 * 3_600_000);
  t = wall - offsetAt(t);
  return t;
}

/** Start and end of an Athens day as instants (23 or 25 hours on the days the clocks change). */
export const dayBounds = (date: string) => ({
  start: athensMidnight(date),
  end: athensMidnight(addDays(date, 1)),
});

/** Monday to Sunday around `date`. */
export function weekOf(date: string): string[] {
  const dow = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(date, i - dow));
}
