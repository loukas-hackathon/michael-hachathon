// Everything the extension remembers lives in chrome.storage.local, because the service worker is
// stopped after about 30 seconds without events and loses its variables every time.
//
//   settings  { apiUrl, apiKey, paused, excluded: string[] }
//   stretch   the open stretch, or absent (see stretch.js)
//   queue     events waiting to be sent (EventInput[])
//   tally     { "2026-11-14": { "example.com": seconds } }  hosts and seconds only
//   stats     { day, sentToday, lastSentAt, lastError: { at, text } | null, note: string | null }

import { DEFAULT_API_URL, TALLY_DAYS } from "./config.js";
import { dayKey } from "./format.js";
import { displayHost } from "./hosts.js";

export const DEFAULT_SETTINGS = { apiUrl: DEFAULT_API_URL, apiKey: "", paused: false, excluded: [] };

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

/** Merges `patch` into the stored settings and returns the result. */
export async function saveSettings(patch) {
  const settings = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

export const emptyStats = (day = dayKey()) => ({
  day,
  sentToday: 0,
  lastSentAt: null,
  lastError: null,
  note: null,
});

/** Stats with the "sent today" counter reset when the day has changed. */
export function currentStats(stats, now = Date.now()) {
  const day = dayKey(now);
  const base = { ...emptyStats(day), ...(stats ?? {}) };
  return base.day === day ? base : { ...base, day, sentToday: 0 };
}

/** Adds an ended stretch to the local tally and forgets days older than the retention. */
export function addToTally(tally, closed, seconds) {
  const next = { ...(tally ?? {}) };
  const day = dayKey(closed.start);
  const host = displayHost(closed.host);
  next[day] = { ...(next[day] ?? {}), [host]: (next[day]?.[host] ?? 0) + seconds };
  const keep = Object.keys(next).sort().slice(-TALLY_DAYS);
  return Object.fromEntries(keep.map((key) => [key, next[key]]));
}

/**
 * Today's sites, longest first, with the open stretch counted up to now so the popup is live.
 * Returns { rows: [{ host, seconds }], totalSeconds, siteCount }.
 */
export function todaySummary(tally, stretch, now = Date.now()) {
  const day = dayKey(now);
  const totals = { ...(tally?.[day] ?? {}) };
  if (stretch && dayKey(stretch.start) === day) {
    const host = displayHost(stretch.host);
    const live = Math.max(0, Math.round((Math.min(now, stretch.lastSeen + 60_000) - stretch.start) / 1000));
    if (live > 0) totals[host] = (totals[host] ?? 0) + live;
  }
  const rows = Object.entries(totals)
    .map(([host, seconds]) => ({ host, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
  return { rows, totalSeconds: rows.reduce((sum, row) => sum + row.seconds, 0), siteCount: rows.length };
}
