// Tunables for the tracker. One place, so the rules in the README and the code cannot drift.

export const DEFAULT_API_URL = "http://localhost:8787";

/** No keyboard or mouse input for this long counts as idle (chrome.idle). */
export const IDLE_SECONDS = 60;

/** Stretches shorter than this are dropped: a tab passed on the way to another one. */
export const MIN_STRETCH_SECONDS = 2;

/** A stretch is cut and restarted at this length, so no single event can cover half a day. */
export const MAX_STRETCH_MS = 2 * 60 * 60 * 1000;

/**
 * The alarm touches the open stretch every 30 seconds. If nothing touched it for this long, the
 * browser was closed, crashed or the machine slept, and the stretch ended when it was last seen.
 */
export const SILENCE_MS = 2 * 60 * 1000;

/** Alarm period in minutes. 30 seconds is the minimum Chrome allows for a packed extension. */
export const TICK_MINUTES = 0.5;

/** The API accepts at most 1000 events per call. */
export const BATCH_MAX = 1000;

/** Events kept while the API cannot be reached. The oldest are dropped past this. */
export const QUEUE_MAX = 5000;

/** Days of the local tally (hosts and seconds) kept for the popup. */
export const TALLY_DAYS = 14;

export const TITLE_MAX = 200;

export const SEND_TIMEOUT_MS = 15_000;
