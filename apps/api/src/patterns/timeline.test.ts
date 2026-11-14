import assert from "node:assert/strict";
import { test } from "node:test";
import { APPS, mac, phone, screenOff, T, web } from "./testkit";
import { buildTimeline, flatten, parseWebVisits, preferExtension } from "./timeline";

const range = (events: Parameters<typeof buildTimeline>[0]) =>
  buildTimeline(events, Date.parse(T("2026-11-10 00:00")), Date.parse(T("2026-11-11 00:00")));
const minutes = (segs: { start: number; end: number }[]) =>
  segs.reduce((t, s) => t + (s.end - s.start), 0) / 60000;
const shape = (segs: { name: string; start: number; end: number }[]) =>
  segs.map((s) => `${s.name} ${(s.end - s.start) / 60000}`);

test("flatten: one winner per instant, the later start wins, nothing is counted twice", () => {
  const a = { start: 0, end: 100, name: "a" };
  const b = { start: 10, end: 20, name: "b" };
  const out = flatten([
    { seg: a, prio: 0 },
    { seg: b, prio: 0 },
  ]);
  assert.deepEqual(
    out.map((s) => [s.name, s.start, s.end]),
    [
      ["a", 0, 10],
      ["b", 10, 20],
      ["a", 20, 100],
    ],
  );
});

test("flatten: a higher priority wins even when it started earlier", () => {
  const out = flatten([
    { seg: { start: 0, end: 50, name: "high" }, prio: 1 },
    { seg: { start: 10, end: 80, name: "low" }, prio: 0 },
  ]);
  assert.deepEqual(
    out.map((s) => [s.name, s.start, s.end]),
    [
      ["high", 0, 50],
      ["low", 50, 80],
    ],
  );
});

test("two overlapping Mac intervals: 15 minutes of use, not 20", () => {
  const tl = range([
    mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:10")),
    mac(APPS.terminal, T("2026-11-10 09:05"), T("2026-11-10 09:15")),
  ]);
  assert.deepEqual(shape(tl.mac), ["VS Code 5", "Terminal 10"]);
  assert.equal(minutes(tl.attention), 15);
});

test("phone and Mac at the same minute: counted once, and the phone has the attention", () => {
  const tl = range([
    mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 10:00")),
    phone(APPS.social, T("2026-11-10 09:30"), T("2026-11-10 09:33")),
  ]);
  assert.deepEqual(shape(tl.attention), ["VS Code 30", "Instagram 3", "VS Code 27"]);
  assert.equal(minutes(tl.attention), 60);
  assert.equal(minutes(tl.mac), 60); // the Mac alone still shows the full hour
  assert.equal(tl.overlapMs, 3 * 60000);
});

test("screen off time is not Mac use", () => {
  const tl = range([
    mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 10:00")),
    screenOff(T("2026-11-10 09:20"), T("2026-11-10 09:40")),
  ]);
  assert.deepEqual(shape(tl.mac), ["VS Code 20", "VS Code 20"]);
});

test("usage is clipped to the range", () => {
  const tl = range([mac(APPS.editor, T("2026-11-09 23:00"), T("2026-11-10 01:00"))]);
  assert.equal(minutes(tl.mac), 60);
});

test("a web visit refines the browser, but never overrides another app in front", () => {
  const tl = range([
    mac(APPS.browser, T("2026-11-10 09:00"), T("2026-11-10 09:10")),
    mac(APPS.editor, T("2026-11-10 09:10"), T("2026-11-10 09:20")),
    // The history file says the page was open from 09:02 to 09:14; the editor took over at 09:10.
    web("www.youtube.com", T("2026-11-10 09:02"), T("2026-11-10 09:14")),
  ]);
  assert.deepEqual(shape(tl.mac), ["Chrome 2", "youtube.com 8", "VS Code 10"]);
  assert.equal(tl.mac[1]?.category, "video");
  assert.equal(minutes(tl.mac), 20);
});

test("where the Mac log is alive, a web visit never adds Mac time of its own", () => {
  const tl = range([
    mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:30")),
    // History says a page was in front from 10:00 to 10:20, but the Mac had nothing in front then
    // (lid closed, or the page was measured on another machine). The Mac's own log wins.
    web("youtube.com", T("2026-11-10 10:00"), T("2026-11-10 10:20"), "history", { foreground: true }),
  ]);
  assert.deepEqual(shape(tl.mac), ["VS Code 30"]);

  // The same visit a week before the Mac log starts stands by itself.
  const old = buildTimeline(
    [
      mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:30")),
      web("youtube.com", T("2026-11-03 10:00"), T("2026-11-03 10:20"), "history", { foreground: true }),
    ],
    Date.parse(T("2026-11-01 00:00")),
    Date.parse(T("2026-11-11 00:00")),
  );
  assert.deepEqual(shape(old.mac), ["youtube.com 20", "VS Code 30"]);
});

test("origin precedence: where the extension reported, history is ignored for that hour", () => {
  const visits = parseWebVisits([
    web("a.example", T("2026-11-10 10:00"), T("2026-11-10 10:10"), "history"),
    web("youtube.com", T("2026-11-10 10:02"), T("2026-11-10 10:06"), "extension"),
    web("b.example", T("2026-11-10 12:00"), T("2026-11-10 12:05"), "history"),
    web("c.example", T("2026-11-10 13:00"), T("2026-11-10 13:05")), // no origin = history
  ]);
  const { kept, superseded } = preferExtension(visits);
  assert.equal(superseded, 1);
  assert.deepEqual(
    kept.map((v) => v.key),
    ["youtube.com", "b.example", "c.example"],
  );

  // End to end: the hour holds 4 minutes of browsing, not 10 and not 14.
  const tl = range([
    web("a.example", T("2026-11-10 10:00"), T("2026-11-10 10:10"), "history"),
    web("youtube.com", T("2026-11-10 10:02"), T("2026-11-10 10:06"), "extension"),
  ]);
  assert.deepEqual(shape(tl.mac), ["youtube.com 4"]);
  assert.equal(tl.counts.webVisitsSuperseded, 1);
});

test("an extension visit that runs over the hour still wins the overlap with history", () => {
  const tl = range([
    web("a.example", T("2026-11-10 10:50"), T("2026-11-10 11:10"), "history"), // starts in an hour with no extension data
    web("youtube.com", T("2026-11-10 11:00"), T("2026-11-10 11:05"), "extension"),
  ]);
  // History starts at 10:50 in an uncovered hour, so it is kept, but 11:00 to 11:05 is counted once.
  assert.deepEqual(shape(tl.mac), ["a.example 10", "youtube.com 5", "a.example 5"]);
  assert.equal(minutes(tl.mac), 20);
});

test("events without a bundle id, an end or a positive length are skipped", () => {
  const broken = mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:00"));
  const noBundle = { ...mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:10")), data: {} };
  const tl = range([broken, noBundle]);
  assert.equal(tl.mac.length, 0);
});

test("a history visit that was only open is not believed: its browser time stays unknown", () => {
  // Chrome did not measure this page in front: it "stayed open" from 09:00 to 11:00.
  const stale = web("news.example", T("2026-11-10 09:00"), T("2026-11-10 11:00"), "history", {
    foreground: false,
    category: "news",
  });
  const tl = range([
    stale,
    mac(APPS.browser, T("2026-11-10 09:00"), T("2026-11-10 09:10")),
    mac(APPS.editor, T("2026-11-10 09:10"), T("2026-11-10 10:00")),
    mac(APPS.browser, T("2026-11-10 10:00"), T("2026-11-10 10:10")),
    // Chrome measured this one: 4 minutes in front.
    web("github.com", T("2026-11-10 10:02"), T("2026-11-10 10:06"), "history", { foreground: true }),
  ]);
  assert.deepEqual(shape(tl.mac), ["Chrome 10", "VS Code 50", "Chrome 2", "github.com 4", "Chrome 4"]);
  assert.equal(tl.counts.webVisits, 1);
  assert.equal(tl.counts.webVisitsUnmeasured, 1);
  // Alone, with no Mac data, it counts for nothing either.
  assert.equal(range([stale]).mac.length, 0);
});

test("the label a collector sends is used when the host is not on the shared list", () => {
  const tl = range([
    web("flights.example", T("2026-11-10 09:00"), T("2026-11-10 09:05"), "extension", { category: "travel" }),
    web("chat.example", T("2026-11-10 09:05"), T("2026-11-10 09:10"), "extension", { category: "messaging" }),
    web("code.example", T("2026-11-10 09:10"), T("2026-11-10 09:15"), "extension", { category: "dev" }),
    web("bank.example", T("2026-11-10 09:15"), T("2026-11-10 09:20"), "extension", { category: "finance" }),
    web("odd.example", T("2026-11-10 09:20"), T("2026-11-10 09:25"), "extension", { category: "made up" }),
    // The shared list wins over the label when it knows the host.
    web("youtube.com", T("2026-11-10 09:25"), T("2026-11-10 09:30"), "extension", { category: "dev" }),
  ]);
  assert.deepEqual(
    tl.mac.map((s) => s.category),
    ["travel", "communication", "work", "other", "other", "video"],
  );
});

test("Apple Watch intervals from the iPhone collector are not phone use", () => {
  const watch = phone(APPS.chat, T("2026-11-10 09:00"), T("2026-11-10 09:01"));
  watch.data.device = "watch";
  const tl = range([watch, phone(APPS.chat, T("2026-11-10 10:00"), T("2026-11-10 10:01"))]);
  assert.equal(tl.iphone.length, 1);
  assert.equal(tl.counts.iphoneAppUsage, 1);
});
