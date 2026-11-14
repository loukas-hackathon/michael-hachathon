// Words and numbers for the popup and the settings page. Michael's voice: numbers first, plain,
// British spelling, 24 hour time.

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "38 seconds", "47 minutes", "1 hour 5 minutes". */
export function duration(seconds) {
  if (seconds < 60) return plural(Math.round(seconds), "second", "seconds");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute", "minutes");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? plural(hours, "hour", "hours")
    : `${plural(hours, "hour", "hours")} ${plural(rest, "minute", "minutes")}`;
}

/** Compact form for a table row: "38 s", "47 min", "1 h 05 min". */
export function shortDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "14:32" today, "13 Nov, 22:10" for another day. */
export function clock(ms, now = Date.now()) {
  const time = new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (dayKey(ms) === dayKey(now)) return time;
  const day = new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${day}, ${time}`;
}

/** The settings page status line: "12 events sent today. 3 waiting. Last sent at 14:32." */
export function statusLine({ sentToday, waiting, lastSentAt }, now = Date.now()) {
  const sent = `${plural(sentToday, "event", "events")} sent today.`;
  const queue = `${waiting} waiting.`;
  const last = lastSentAt ? `Last sent at ${clock(lastSentAt, now)}.` : "Nothing sent yet.";
  return `${sent} ${queue} ${last}`;
}
