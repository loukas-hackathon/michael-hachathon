// Pure logic: stretch bookkeeping, exclusion matching and the event payload. No browser needed.
//   node --test apps/extension/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { isRejected, originPattern, parseApiUrl } from "../lib/api.js";
import { categoryFor } from "../lib/categories.js";
import { MAX_STRETCH_MS, SILENCE_MS } from "../lib/config.js";
import { duration, shortDuration, statusLine } from "../lib/format.js";
import { hostFromUrl, isExcluded, normaliseEntry } from "../lib/hosts.js";
import { addToTally, todaySummary } from "../lib/store.js";
import { cleanTitle, reconcile, toEvent } from "../lib/stretch.js";

const T0 = Date.parse("2026-11-14T10:00:00Z");
const id = () => "00000000-0000-4000-8000-000000000001";
const seen = (host, tabId = 1, title = host) => ({ tabId, host, title });

test("a stretch starts when a recordable page is in front", () => {
  const { stretch, closed } = reconcile(null, seen("example.com"), T0, id);
  assert.equal(closed.length, 0);
  assert.deepEqual(stretch, {
    id: id(),
    tabId: 1,
    host: "example.com",
    title: "example.com",
    start: T0,
    lastSeen: T0,
  });
});

test("same tab and host continues the stretch and follows the title", () => {
  const first = reconcile(null, seen("example.com"), T0, id).stretch;
  const { stretch, closed } = reconcile(first, seen("example.com", 1, "Second page"), T0 + 20_000, id);
  assert.equal(closed.length, 0);
  assert.equal(stretch.start, T0);
  assert.equal(stretch.title, "Second page");
  assert.equal(stretch.lastSeen, T0 + 20_000);
});

test("a host change ends the stretch and starts the next", () => {
  const first = reconcile(null, seen("example.com"), T0, id).stretch;
  const { stretch, closed } = reconcile(first, seen("wikipedia.org"), T0 + 9_000, id);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].end, T0 + 9_000);
  assert.equal(stretch.host, "wikipedia.org");
  assert.equal(stretch.start, T0 + 9_000);
});

test("a tab change on the same host ends the stretch", () => {
  const first = reconcile(null, seen("example.com", 1), T0, id).stretch;
  const { closed, stretch } = reconcile(first, seen("example.com", 2), T0 + 5_000, id);
  assert.equal(closed.length, 1);
  assert.equal(stretch.tabId, 2);
});

test("nothing in front (focus lost, idle, locked, paused) ends the stretch", () => {
  const first = reconcile(null, seen("example.com"), T0, id).stretch;
  const { closed, stretch } = reconcile(first, null, T0 + 7_000, id);
  assert.equal(stretch, null);
  assert.equal(closed[0].end, T0 + 7_000);
});

test("a stretch left open while the worker was gone ends when it was last seen", () => {
  const first = reconcile(null, seen("example.com"), T0, id).stretch;
  const touched = reconcile(first, seen("example.com"), T0 + 30_000, id).stretch;
  const nineHours = T0 + 9 * 3600_000;
  const { closed, stretch } = reconcile(touched, seen("example.com"), nineHours, id);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].end, T0 + 30_000);
  assert.equal(toEvent(closed[0]).data.seconds, 30);
  assert.equal(stretch.start, nineHours);
});

test("silence just under the limit does not cut the stretch", () => {
  const first = reconcile(null, seen("example.com"), T0, id).stretch;
  const { closed } = reconcile(first, seen("example.com"), T0 + SILENCE_MS, id);
  assert.equal(closed.length, 0);
});

test("a very long stretch is cut at the maximum and carries on", () => {
  let stretch = reconcile(null, seen("example.com"), T0, id).stretch;
  let closed = [];
  for (let t = T0 + 30_000; t <= T0 + MAX_STRETCH_MS; t += 30_000) {
    ({ stretch, closed } = reconcile(stretch, seen("example.com"), t, id));
    if (closed.length > 0) break;
  }
  assert.equal(closed.length, 1);
  assert.equal(closed[0].end - closed[0].start, MAX_STRETCH_MS);
  assert.equal(stretch.start, T0 + MAX_STRETCH_MS);
});

test("a clock that moved backwards drops the stretch", () => {
  const first = reconcile(null, seen("example.com"), T0, id).stretch;
  const { closed, stretch } = reconcile(first, null, T0 - 60_000, id);
  assert.equal(closed.length, 0);
  assert.equal(stretch, null);
});

test("the event has the API's EventInput shape", () => {
  const event = toEvent({
    id: id(),
    tabId: 1,
    host: "skyscanner.net",
    title: "Flights",
    start: T0,
    end: T0 + 61_400,
  });
  assert.deepEqual(event, {
    source: "chrome",
    type: "web_visit",
    start_at: "2026-11-14T10:00:00.000Z",
    end_at: "2026-11-14T10:01:01.400Z",
    title: "Flights",
    data: { host: "skyscanner.net", seconds: 61, category: "travel", origin: "extension" },
    external_id: `ext:${id()}`,
  });
});

test("no category key when the host is unknown, and short stretches are dropped", () => {
  const event = toEvent({ id: id(), host: "example.com", title: "", start: T0, end: T0 + 2_000 });
  assert.equal("category" in event.data, false);
  assert.equal(event.title, "example.com");
  assert.equal(toEvent({ id: id(), host: "example.com", title: "x", start: T0, end: T0 + 1_400 }), null);
});

test("only web pages have a host", () => {
  assert.equal(hostFromUrl("https://Example.com/a/b?c=d#e"), "example.com");
  assert.equal(hostFromUrl("http://example.com:8080/"), "example.com");
  assert.equal(hostFromUrl("https://www.wikipedia.org/wiki/Athens"), "wikipedia.org");
  for (const url of [
    "chrome://extensions",
    "chrome-extension://abc/options.html",
    "about:blank",
    "file:///tmp/a.html",
    "view-source:https://example.com",
    "data:text/html,hi",
    "",
    undefined,
  ]) {
    assert.equal(hostFromUrl(url), null, String(url));
  }
});

test("a title that is really an address is replaced by the host", () => {
  assert.equal(cleanTitle("https://example.com/private/path?token=1", "example.com"), "example.com");
  assert.equal(cleanTitle("example.com/private/path?token=1", "example.com"), "example.com");
  assert.equal(cleanTitle("", "example.com"), "example.com");
  assert.equal(cleanTitle("Example Domain", "example.com"), "Example Domain");
  assert.equal(cleanTitle("x".repeat(500), "example.com").length, 200);
});

test("built in exclusions", () => {
  const out = [
    "localhost",
    "dev.localhost",
    "printer.local",
    "router",
    "127.0.0.1",
    "10.0.0.8",
    "192.168.1.1",
    "172.20.3.4",
    "169.254.1.1",
    "100.100.1.1",
    "[::1]",
    "paypal.com",
    "www.paypal.com",
    "online.examplebank.com",
    "nbg.gr",
    "www.mayoclinic.org",
    "portal.examplehealth.org",
    "my.1password.com",
    "vault.bitwarden.com",
    "pornhub.com",
    "example.xxx",
  ];
  for (const host of out) assert.equal(isExcluded(host, []), true, host);
  const kept = ["example.com", "www.wikipedia.org", "github.com", "172.32.0.1", "8.8.8.8", "essex.ac.uk"];
  for (const host of kept) assert.equal(isExcluded(host, []), false, host);
});

test("the user's list covers a host and its subdomains, however it was typed", () => {
  assert.equal(normaliseEntry(" https://www.Example.org/some/page "), "example.org");
  assert.equal(normaliseEntry("*.example.org"), "example.org");
  assert.equal(normaliseEntry("example.org:8080"), "example.org");
  assert.equal(normaliseEntry("not a site"), null);
  assert.equal(normaliseEntry(""), null);
  assert.equal(isExcluded("example.org", ["example.org"]), true);
  assert.equal(isExcluded("www.example.org", ["example.org"]), true);
  assert.equal(isExcluded("notexample.org", ["example.org"]), false);
});

test("categories: the shared vocabulary, the most specific host wins", () => {
  assert.equal(categoryFor("mail.google.com"), "communication");
  assert.equal(categoryFor("docs.google.com"), "work");
  assert.equal(categoryFor("music.youtube.com"), "music");
  assert.equal(categoryFor("www.youtube.com"), "video");
  assert.equal(categoryFor("github.com"), "work");
  assert.equal(categoryFor("amazon.co.uk"), "shopping");
  // A search page could be anything: no category, as in the API.
  assert.equal(categoryFor("www.google.com"), undefined);
  assert.equal(categoryFor("example.com"), undefined);
  assert.equal(categoryFor("constructor.com"), undefined);
});

test("API address parsing and the permission pattern", () => {
  assert.deepEqual(parseApiUrl("localhost:8787"), {
    ok: true,
    url: "http://localhost:8787",
    origin: "http://localhost:8787",
  });
  assert.equal(parseApiUrl("api.example.com/").url, "https://api.example.com");
  assert.equal(parseApiUrl("https://api.example.com/base/").url, "https://api.example.com/base");
  assert.equal(parseApiUrl("ftp://example.com").ok, false);
  assert.equal(parseApiUrl("").ok, false);
  assert.equal(originPattern("https://api.example.com:8443/base"), "https://api.example.com/*");
  assert.equal(isRejected({ ok: false, kind: "http", status: 400 }), true);
  assert.equal(isRejected({ ok: false, kind: "http", status: 401 }), false);
  assert.equal(isRejected({ ok: false, kind: "network" }), false);
});

test("tally and copy", () => {
  let tally = addToTally(undefined, { host: "www.example.com", start: T0 }, 120);
  tally = addToTally(tally, { host: "example.com", start: T0 }, 60);
  tally = addToTally(tally, { host: "wikipedia.org", start: T0 }, 2700);
  const open = { host: "github.com", start: T0 + 1000, lastSeen: T0 + 31_000 };
  const summary = todaySummary(tally, open, T0 + 31_000);
  assert.deepEqual(summary.rows, [
    { host: "wikipedia.org", seconds: 2700 },
    { host: "example.com", seconds: 180 },
    { host: "github.com", seconds: 30 },
  ]);
  assert.equal(duration(summary.totalSeconds), "49 minutes");
  assert.equal(duration(38), "38 seconds");
  assert.equal(duration(3900), "1 hour 5 minutes");
  assert.equal(shortDuration(3900), "1 h 05 min");
  const now = new Date(2026, 10, 14, 15, 0).getTime();
  const at = new Date(2026, 10, 14, 14, 32).getTime();
  assert.equal(
    statusLine({ sentToday: 12, waiting: 3, lastSentAt: at }, now),
    "12 events sent today. 3 waiting. Last sent at 14:32.",
  );
  assert.equal(
    statusLine({ sentToday: 1, waiting: 0, lastSentAt: null }, now),
    "1 event sent today. 0 waiting. Nothing sent yet.",
  );
});
