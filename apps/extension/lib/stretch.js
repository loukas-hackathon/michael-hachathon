// Stretch bookkeeping. Pure functions: no chrome.* calls, so the rules can be tested with node.
//
// A stretch is one unbroken spell on one host in one tab:
//   { id, tabId, host, title, start, lastSeen }   (times in epoch milliseconds)
// "seen" is what the browser shows right now: { tabId, host, title }, or null when nothing should
// be recorded (window not focused, idle, locked, off the record, excluded or non web page).

import { categoryFor } from "./categories.js";
import { MAX_STRETCH_MS, MIN_STRETCH_SECONDS, SILENCE_MS, TITLE_MAX } from "./config.js";

/** A stretch never ends before it started and never runs past the maximum length. */
const finish = (stretch, end) => ({
  ...stretch,
  end: Math.max(stretch.start, Math.min(end, stretch.start + MAX_STRETCH_MS)),
});

/**
 * Compares the stored open stretch with what the browser shows now.
 * Returns the stretch to keep open (or null) and the stretches that just ended.
 */
export function reconcile(open, seen, now, makeId = () => crypto.randomUUID()) {
  const closed = [];
  let stretch = open ?? null;

  if (stretch) {
    if (now < stretch.start) {
      // The clock moved backwards. The stretch cannot be measured, so it is dropped.
      stretch = null;
    } else if (now - stretch.lastSeen > SILENCE_MS) {
      // Nobody touched it for too long: the browser was closed or the machine slept. It ended
      // when it was last seen, not now.
      closed.push(finish(stretch, stretch.lastSeen));
      stretch = null;
    } else if (!seen || seen.tabId !== stretch.tabId || seen.host !== stretch.host) {
      closed.push(finish(stretch, now));
      stretch = null;
    } else if (now - stretch.start >= MAX_STRETCH_MS) {
      // Still on the same site: cut here and carry on in a fresh stretch.
      closed.push(finish(stretch, now));
      stretch = null;
    } else {
      // Same tab, same host: the stretch continues. Only the title follows the page.
      stretch = { ...stretch, title: seen.title, lastSeen: now };
    }
  }

  if (!stretch && seen) {
    stretch = {
      id: makeId(),
      tabId: seen.tabId,
      host: seen.host,
      title: seen.title,
      start: now,
      lastSeen: now,
    };
  }
  return { stretch, closed };
}

/**
 * A page without a title shows its address as the title. That would leak the full address, so
 * anything that looks like one is replaced by the host.
 */
export function cleanTitle(title, host) {
  const text = String(title ?? "").trim();
  if (!text || text.includes("://") || text.startsWith(`${host}/`) || /^[^\s/]+\.[^\s/]+\/\S*$/.test(text)) {
    return host;
  }
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

export const stretchSeconds = (closed) => Math.round((closed.end - closed.start) / 1000);

/** The API event (EventInput) for an ended stretch, or null when it was too short to count. */
export function toEvent(closed) {
  const seconds = stretchSeconds(closed);
  if (seconds < MIN_STRETCH_SECONDS) return null;
  const category = categoryFor(closed.host);
  return {
    source: "chrome",
    type: "web_visit",
    start_at: new Date(closed.start).toISOString(),
    end_at: new Date(closed.end).toISOString(),
    title: closed.title || closed.host,
    data: { host: closed.host, seconds, ...(category ? { category } : {}), origin: "extension" },
    external_id: `ext:${closed.id}`,
  };
}
