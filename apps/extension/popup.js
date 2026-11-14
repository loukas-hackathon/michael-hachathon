// The popup: today's time by site, from the local tally (hosts and seconds only), and the
// Off the record switch.

import { duration, plural, shortDuration } from "./lib/format.js";
import { loadSettings, saveSettings, todaySummary } from "./lib/store.js";

const TOP = 5;
const $ = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// "Back on." shows for a moment after the switch is released, then the numbers return.
let justResumed = false;

async function render() {
  const settings = await loadSettings();
  const { tally, stretch, queue = [] } = await chrome.storage.local.get(["tally", "stretch", "queue"]);
  const { rows, totalSeconds, siteCount } = todaySummary(tally, stretch);

  $("paused").checked = settings.paused;
  document.body.classList.toggle("is-paused", settings.paused);

  if (settings.paused) {
    $("number").textContent = "Off the record.";
    $("rest").textContent = "Nothing is being collected.";
  } else if (justResumed) {
    $("number").textContent = "Back on.";
    $("rest").textContent = "Recording time on sites.";
  } else if (siteCount === 0) {
    $("number").textContent = "Nothing yet today.";
    $("rest").textContent = "Time appears here as you browse.";
  } else {
    $("number").textContent = duration(totalSeconds);
    $("rest").textContent = `on ${plural(siteCount, "site", "sites")} today.`;
  }

  const top = rows.slice(0, TOP);
  const others = rows.slice(TOP).reduce((sum, row) => sum + row.seconds, 0);

  const dayline = $("dayline");
  dayline.replaceChildren();
  top.forEach((row, index) => {
    const part = element("span", `dayline-part shade-${index}`);
    part.style.flexGrow = String(row.seconds);
    dayline.append(part);
  });
  if (others > 0) {
    const part = element("span", "dayline-part dayline-rest");
    part.style.flexGrow = String(others);
    dayline.append(part);
  }
  dayline.hidden = rows.length === 0;

  const sites = $("sites");
  sites.replaceChildren(
    ...top.map((row, index) => {
      const item = element("li");
      item.append(
        element("span", `swatch shade-${index}`),
        element("span", "host", row.host),
        element("span", "time", shortDuration(row.seconds)),
      );
      return item;
    }),
  );

  const note = $("note");
  note.hidden = Boolean(settings.apiKey);
  note.textContent = settings.apiKey ? "" : "No API key yet. Nothing is sent until you add one in Settings.";

  $("waiting").textContent = queue.length > 0 ? `${queue.length} waiting` : "";
}

$("paused").addEventListener("change", async (event) => {
  const paused = event.target.checked;
  justResumed = !paused;
  await saveSettings({ paused });
  await render();
  if (justResumed) {
    setTimeout(() => {
      justResumed = false;
      render();
    }, 1600);
  }
});

$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") render();
});

// Ask the worker for a fresh look at the tabs, then draw. Drawing does not wait for the answer.
chrome.runtime.sendMessage({ type: "sync" }).catch(() => {});
render();
