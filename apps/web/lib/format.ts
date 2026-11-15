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

const athensDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const shortDateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ });

/**
 * When something last happened, as Messages lists it: "14:02" today, "Yesterday", the weekday
 * within the week, then "9 Nov".
 */
export function formatWhen(iso: string | Date, now: Date = new Date()) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const days = Math.round((Date.parse(athensDay.format(now)) - Date.parse(athensDay.format(d))) / 86_400_000);
  if (days <= 0) return formatTime(d);
  if (days === 1) return "Yesterday";
  if (days < 7) return formatWeekday(d);
  return shortDateFmt.format(d);
}

/**
 * An undo deadline after "until": "15:00" today, "tomorrow 06:43" the next day, else the weekday.
 * A logged entry can be undone for 24 hours, so a bare clock read as already over.
 */
export function formatUntil(iso: string | Date, now: Date = new Date()) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const days = Math.round((Date.parse(athensDay.format(d)) - Date.parse(athensDay.format(now))) / 86_400_000);
  if (days <= 0) return formatTime(d);
  if (days === 1) return `tomorrow ${formatTime(d)}`;
  return `${formatWeekday(d)} ${formatTime(d)}`;
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

/** For screen readers, where "3h 33" reads badly: "3 hours 33 minutes", "47 minutes", "1 hour". */
export function spokenDuration(minutes: number) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  const mins = `${r} ${r === 1 ? "minute" : "minutes"}`;
  if (h === 0) return mins;
  const hours = `${h} ${h === 1 ? "hour" : "hours"}`;
  return r === 0 ? hours : `${hours} ${mins}`;
}
