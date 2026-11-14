// Service worker: records how long the active tab of the focused window stays on each site and
// posts the ended stretches to Michael's API.
//
// Chrome stops this worker after about 30 seconds without events and starts it again for the next
// one. So: every listener is registered at the top level, nothing is remembered in variables
// (see lib/store.js), and time is driven by chrome.alarms, never by setInterval.

import { explainFailure, isRejected, postEvents, testEvent } from "./lib/api.js";
import { BATCH_MAX, IDLE_SECONDS, QUEUE_MAX, TICK_MINUTES } from "./lib/config.js";
import { hostFromUrl, isExcluded } from "./lib/hosts.js";
import { addToTally, currentStats, loadSettings } from "./lib/store.js";
import { cleanTitle, reconcile, stretchSeconds, toEvent } from "./lib/stretch.js";

const TICK = "tick";

// Events arrive in bursts (a tab switch fires three or four) and each one reads, changes and
// writes storage. This chain runs those steps one after another so they cannot overwrite each
// other. It is only an ordering aid for the worker's current life, not state.
let chain = Promise.resolve();
function serial(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

/**
 * What should be recorded right now: { tabId, host, title }, or null.
 * Null means: off the record, screen locked, no focused browser window, incognito, a page that is
 * not a web page, an excluded site, or the user is idle and the tab is silent.
 */
async function observe(settings) {
  if (settings.paused) return null;

  const idle = await chrome.idle.queryState(IDLE_SECONDS);
  if (idle === "locked") return null;

  let win;
  try {
    win = await chrome.windows.getLastFocused();
  } catch {
    return null; // no browser window at all
  }
  if (!win?.focused || win.incognito) return null;

  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab || tab.incognito) return null;

  const host = hostFromUrl(tab.url);
  if (!host || isExcluded(host, settings.excluded)) return null;

  // Idle means no keyboard or mouse for a minute. Someone watching a video or sitting in a call
  // is still there, so an audible tab keeps its stretch.
  if (idle === "idle" && !tab.audible) return null;

  return { tabId: tab.id, host, title: cleanTitle(tab.title, host) };
}

/** Brings the stored stretch in line with the browser. Called for every event and every tick. */
function sync() {
  return serial(async () => {
    const settings = await loadSettings();
    const stored = await chrome.storage.local.get(["stretch", "queue", "tally"]);
    const seen = await observe(settings);
    const now = Date.now();

    // Off the record, or a site that has just been added to the list: the open stretch is thrown
    // away, not recorded.
    let open = stored.stretch ?? null;
    if (open && (settings.paused || isExcluded(open.host, settings.excluded))) open = null;

    const { stretch, closed } = reconcile(open, seen, now);

    const update = {};
    const events = closed.map((ended) => ({ ended, event: toEvent(ended) })).filter(({ event }) => event);
    if (events.length > 0) {
      // Past the cap the oldest waiting events are dropped.
      update.queue = [...(stored.queue ?? []), ...events.map(({ event }) => event)].slice(-QUEUE_MAX);
      update.tally = events.reduce(
        (tally, { ended }) => addToTally(tally, ended, stretchSeconds(ended)),
        stored.tally,
      );
    }

    if (stretch) update.stretch = stretch;
    await chrome.storage.local.set(update);
    if (!stretch && stored.stretch) await chrome.storage.local.remove("stretch");

    await chrome.action.setBadgeBackgroundColor({ color: "#6B675E" });
    await chrome.action.setBadgeText({ text: settings.paused ? "off" : "" });
  });
}

/** After the list of excluded sites changes, removes those sites from what is stored locally. */
function scrub() {
  return serial(async () => {
    const settings = await loadSettings();
    const { queue = [], tally = {} } = await chrome.storage.local.get(["queue", "tally"]);
    const keptQueue = queue.filter(
      (event) => !event.data?.host || !isExcluded(event.data.host, settings.excluded),
    );
    const keptTally = Object.fromEntries(
      Object.entries(tally).map(([day, hosts]) => [
        day,
        Object.fromEntries(Object.entries(hosts).filter(([host]) => !isExcluded(host, settings.excluded))),
      ]),
    );
    await chrome.storage.local.set({ queue: keptQueue, tally: keptTally });
  });
}

async function sendQueue() {
  let sent = 0;
  // A few rounds at most per call, so a huge backlog cannot keep the worker busy for ever.
  for (let round = 0; round < 5; round++) {
    const settings = await loadSettings();
    // Off the record also means nothing leaves this browser. Waiting events go when it is back on.
    if (settings.paused) return { ok: true, sent, held: true };

    const { queue = [] } = await chrome.storage.local.get("queue");
    const batch = queue.slice(0, BATCH_MAX);
    if (batch.length === 0) return { ok: true, sent };
    if (!settings.apiKey)
      return { ok: false, sent, text: explainFailure({ kind: "no_key" }, settings.apiUrl) };

    const result = await postEvents(settings, batch);
    const done = result.ok || isRejected(result);
    const ids = new Set(batch.map((event) => event.external_id));

    await serial(async () => {
      const now = Date.now();
      const fresh = await chrome.storage.local.get(["queue", "stats"]);
      const stats = currentStats(fresh.stats, now);
      const update = {};
      if (done) update.queue = (fresh.queue ?? []).filter((event) => !ids.has(event.external_id));
      if (result.ok) {
        stats.sentToday += batch.length - result.ignored;
        stats.lastSentAt = now;
        stats.lastError = null;
        stats.note =
          result.ignored > 0
            ? `Michael ignored ${result.ignored} of the last ${batch.length}. Chrome is switched off there, or you are off the record.`
            : null;
      } else {
        const text = isRejected(result)
          ? `The API refused ${batch.length} events (${result.status}) and they were dropped.`
          : explainFailure(result, settings.apiUrl);
        stats.lastError = { at: now, text };
      }
      update.stats = stats;
      await chrome.storage.local.set(update);
    });

    if (!result.ok) return { ok: false, sent, text: explainFailure(result, settings.apiUrl) };
    sent += batch.length;
    if (batch.length < BATCH_MAX) return { ok: true, sent };
  }
  return { ok: true, sent };
}

// Only one send at a time: an alarm and a click must not post the same batch twice.
let sending = null;
function flush() {
  sending ??= sendQueue().finally(() => {
    sending = null;
  });
  return sending;
}

/** "Send a test event" on the settings page: one note, sent now, counted in the status line. */
async function sendTest() {
  const settings = await loadSettings();
  const result = await postEvents(settings, [testEvent()]);
  if (!result.ok) return { ...result, text: explainFailure(result, settings.apiUrl) };
  if (result.ignored === 0) {
    await serial(async () => {
      const now = Date.now();
      const { stats: stored } = await chrome.storage.local.get("stats");
      const stats = currentStats(stored, now);
      await chrome.storage.local.set({
        stats: { ...stats, sentToday: stats.sentToday + 1, lastSentAt: now, lastError: null },
      });
    });
  }
  return result;
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(TICK);
  if (!existing) await chrome.alarms.create(TICK, { periodInMinutes: TICK_MINUTES });
}

// Listeners. All at the top level, so Chrome knows to wake the worker for them.

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  sync();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  sync();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK) return;
  sync().then(flush);
});

chrome.tabs.onActivated.addListener(() => sync());
chrome.tabs.onRemoved.addListener(() => sync());
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url !== undefined || change.title !== undefined || change.status === "complete") sync();
});

// Page loads and single page app navigations (history.pushState) in the top frame.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) sync();
});
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) sync();
});
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) sync();
});

// Fires with WINDOW_ID_NONE when the browser loses focus to another app.
chrome.windows.onFocusChanged.addListener(() => sync());
chrome.windows.onRemoved.addListener(() => sync());

chrome.idle.setDetectionInterval(IDLE_SECONDS);
chrome.idle.onStateChanged.addListener(() => sync());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const before = changes.settings.oldValue ?? {};
  const after = changes.settings.newValue ?? {};
  if (JSON.stringify(before.excluded ?? []) !== JSON.stringify(after.excluded ?? [])) scrub();
  sync().then(() => {
    // Back on the record: send what was held.
    if (before.paused && !after.paused) flush();
  });
});

// The settings page and the popup ask for a send, a test event or a fresh look at the tabs.
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "flush") {
    sync()
      .then(flush)
      .then(respond, () => respond({ ok: false, sent: 0 }));
    return true;
  }
  if (message?.type === "test") {
    sendTest().then(respond, () => respond({ ok: false, kind: "unknown" }));
    return true;
  }
  if (message?.type === "sync") {
    sync().then(
      () => respond({ ok: true }),
      () => respond({ ok: false }),
    );
    return true;
  }
  return false;
});

// The worker has just started (first run or woken for an event): make sure the alarm exists.
ensureAlarm();
