// Time and duration formatting in Michael's voice: 24 hour clock, Athens time, numbers first.
// Voice sheet: under 2 hours say minutes ("47 minutes"), above that "2h 15".

const TZ = "Europe/Athens";

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: TZ });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: TZ });

/** "14:30" */
export function formatTime(iso: string | Date) {
  return timeFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "Wednesday 11 November" */
export function formatDay(iso: string | Date) {
  return dayFmt.format(typeof iso === "string" ? new Date(iso) : iso).replace(",", "");
}

export function formatWeekday(iso: string | Date) {
  return weekdayFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatMonth(iso: string | Date) {
  return monthFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** In a sentence: "47 minutes", "1 minute", "2h 15", "3h". */
export function minutesPhrase(minutes: number) {
  const m = Math.round(minutes);
  if (m < 120) return `${m} ${m === 1 ? "minute" : "minutes"}`;
  return hm(m);
}

/** Compact, for keys, budgets and labels: "47 min", "1h 20", "6h". */
export function hm(minutes: number) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${String(r).padStart(2, "0")}`;
}
