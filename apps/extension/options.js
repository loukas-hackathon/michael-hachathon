// The settings page: where to send, the Off the record switch, the sites never to record, and a
// status line.

import { explainFailure, isGrantedAtInstall, originPattern, parseApiUrl } from "./lib/api.js";
import { clock, statusLine } from "./lib/format.js";
import { normaliseEntry } from "./lib/hosts.js";
import { currentStats, loadSettings, saveSettings } from "./lib/store.js";

const $ = (id) => document.getElementById(id);

function say(target, text, trouble = false) {
  target.textContent = text;
  target.classList.toggle("trouble", trouble);
}

// "Back on." shows once, straight after the switch is released.
let justResumed = false;

function renderRecord(settings) {
  $("paused").checked = settings.paused;
  if (settings.paused) {
    $("record-title").textContent = "Off the record.";
    $("record-detail").textContent = "Nothing is being collected and nothing is sent.";
  } else {
    $("record-title").textContent = justResumed ? "Back on." : "Recording time on sites.";
    $("record-detail").textContent = "The site name, the page title and how long. Never the full address.";
  }
}

function renderExcluded(settings) {
  const list = $("excluded");
  list.replaceChildren(
    ...settings.excluded.map((host) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = host;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${host}`);
      remove.addEventListener("click", async () => {
        const current = await loadSettings();
        await saveSettings({ excluded: current.excluded.filter((entry) => entry !== host) });
        say($("site-result"), `${host} can be recorded again.`);
      });
      item.append(name, remove);
      return item;
    }),
  );
}

async function renderStatus() {
  const { stats: stored, queue = [] } = await chrome.storage.local.get(["stats", "queue"]);
  const stats = currentStats(stored);
  $("status").textContent = statusLine({
    sentToday: stats.sentToday,
    waiting: queue.length,
    lastSentAt: stats.lastSentAt,
  });

  const trouble = $("status-trouble");
  trouble.hidden = !stats.lastError;
  trouble.textContent = stats.lastError
    ? `Last try at ${clock(stats.lastError.at)} failed. ${stats.lastError.text}`
    : "";

  const note = $("status-note");
  note.hidden = !stats.note;
  note.textContent = stats.note ?? "";
}

/** Checks the address, asks Chrome for access to it if needed, and stores address and key. */
async function saveConnection() {
  const result = $("connection-result");
  const parsed = parseApiUrl($("api-url").value);
  if (!parsed.ok) {
    say(result, "That address is not valid. It should look like https://api.example.com.", true);
    return null;
  }

  // Chrome only shows its permission question straight after a click, so this must be the first
  // thing that waits. It answers at once when the access is already there.
  if (!isGrantedAtInstall(parsed.url)) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [originPattern(parsed.url)] });
    } catch {
      granted = false;
    }
    if (!granted) {
      say(result, `Chrome was not allowed to reach ${parsed.origin}, so nothing can be sent there.`, true);
      return null;
    }
  }

  const before = await loadSettings();
  const settings = await saveSettings({ apiUrl: parsed.url, apiKey: $("api-key").value.trim() });
  $("api-url").value = settings.apiUrl;

  // Give back the access to the previous address: the extension keeps only what it uses.
  const previous = parseApiUrl(before.apiUrl);
  if (
    previous.ok &&
    !isGrantedAtInstall(previous.url) &&
    originPattern(previous.url) !== originPattern(settings.apiUrl)
  ) {
    chrome.permissions.remove({ origins: [originPattern(previous.url)] }).catch(() => {});
  }
  return settings;
}

async function busy(work) {
  $("save").disabled = true;
  $("test").disabled = true;
  try {
    await work();
  } finally {
    $("save").disabled = false;
    $("test").disabled = false;
  }
}

$("connection").addEventListener("submit", (event) => {
  event.preventDefault();
  busy(async () => {
    const settings = await saveConnection();
    if (settings)
      say($("connection-result"), settings.apiKey ? "Saved." : "Saved. Add the API key to start sending.");
  });
});

$("test").addEventListener("click", () => {
  busy(async () => {
    const result = $("connection-result");
    const settings = await saveConnection();
    if (!settings) return;
    say(result, "Sending.");
    // The worker sends it, so the status line below counts it like any other event.
    let outcome;
    try {
      outcome = await chrome.runtime.sendMessage({ type: "test" });
    } catch {
      outcome = null;
    }
    if (!outcome?.ok) {
      say(result, explainFailure(outcome ?? { kind: "unknown" }, settings.apiUrl), true);
      return;
    }
    if (outcome.ignored > 0) {
      say(
        result,
        "The API answered but ignored the event. Chrome is switched off in Michael, or you are off the record there.",
        true,
      );
      return;
    }
    say(result, "Sent. The API accepted the test event.");
    // The connection works, so send whatever was waiting.
    chrome.runtime.sendMessage({ type: "flush" }).catch(() => {});
  });
});

$("paused").addEventListener("change", async (event) => {
  const paused = event.target.checked;
  justResumed = !paused;
  await saveSettings({ paused });
});

$("add-site").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = $("site-result");
  const host = normaliseEntry($("site").value);
  if (!host) {
    say(result, "That does not look like a site name. Try example.com.", true);
    return;
  }
  const settings = await loadSettings();
  if (settings.excluded.includes(host)) {
    say(result, `${host} is already on the list.`);
    return;
  }
  await saveSettings({ excluded: [...settings.excluded, host].sort() });
  $("site").value = "";
  say(result, `${host} will not be recorded. Anything waiting from it was removed.`);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    const settings = await loadSettings();
    renderRecord(settings);
    renderExcluded(settings);
    justResumed = false;
  }
  renderStatus();
});

const settings = await loadSettings();
$("api-url").value = settings.apiUrl;
$("api-key").value = settings.apiKey;
renderRecord(settings);
renderExcluded(settings);
renderStatus();
