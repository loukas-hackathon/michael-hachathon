import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createChromeReader } from "../readers/chrome";
import { siteCategory } from "../site-categories";
import { hostFromUrl, isExcludedHost, parseExcludeList } from "../site-privacy";

// A check for the Chrome reader that needs no real history: it builds a made up history file,
// reads it, and asserts the privacy rules. Run: pnpm --filter @michael/collector check:chrome
// Every address, title and search term below is invented.

const CHROME_EPOCH_OFFSET = 11_644_473_600n;
const root = mkdtempSync(join(tmpdir(), "michael-chrome-check-"));
const chromeDir = join(root, "chrome");
const excludeFile = join(root, "exclude-hosts.txt");
const dayAgo = BigInt(Math.floor(Date.now() / 1000) - 86_400);

type Visit = {
  at: number; // seconds after the start of the made up day
  url: string;
  title?: string;
  open?: number; // seconds the page stayed open
  foreground?: number; // seconds in front, when Chrome measured it
  transition?: number;
  term?: string;
};

function writeHistory(profile: string, visits: Visit[]) {
  mkdirSync(join(chromeDir, profile), { recursive: true });
  const db = new DatabaseSync(join(chromeDir, profile, "History"));
  db.exec(`
    create table urls (id integer primary key, url longvarchar, title longvarchar);
    create table visits (id integer primary key, url integer not null, visit_time integer not null,
      transition integer default 0 not null, visit_duration integer default 0 not null);
    create table keyword_search_terms (keyword_id integer not null, url_id integer not null,
      term longvarchar not null, normalized_term longvarchar not null);
    create table content_annotations (visit_id integer primary key, categories varchar, search_terms longvarchar);
    create table context_annotations (visit_id integer primary key, total_foreground_duration integer);
  `);
  visits.forEach((visit, index) => {
    const id = index + 1;
    db.prepare("insert into urls values (?, ?, ?)").run(id, visit.url, visit.title ?? "");
    db.prepare("insert into visits values (?, ?, ?, ?, ?)").run(
      id,
      id,
      (dayAgo + BigInt(visit.at) + CHROME_EPOCH_OFFSET) * 1_000_000n,
      // 0x30000000 marks a complete navigation; the low byte is the kind (0 link, 3 subframe).
      0x30000000 | (visit.transition ?? 0),
      BigInt(visit.open ?? 0) * 1_000_000n,
    );
    // Chrome writes minus one second when it did not measure foreground time.
    db.prepare("insert into context_annotations values (?, ?)").run(
      id,
      visit.foreground === undefined ? -1_000_000n : BigInt(visit.foreground) * 1_000_000n,
    );
    if (visit.term)
      db.prepare("insert into keyword_search_terms values (1, ?, ?, ?)").run(id, visit.term, visit.term);
  });
  db.close();
}

writeHistory("Default", [
  { at: 0, url: "https://www.example.com/orders/42?token=SECRET#frag", title: "Order  42 ", open: 30 },
  {
    at: 100,
    url: "https://docs.google.com/document/d/SECRET/edit",
    title: "Plan",
    open: 300,
    foreground: 12,
  },
  { at: 200, url: "https://shop.example.org/", title: "Left open", open: 36_000 },
  { at: 300, url: "https://example.com/redirect?to=SECRET", title: "Hop", open: 0 },
  { at: 400, url: "https://ads.example.net/frame?id=SECRET", title: "Frame", open: 40, transition: 3 },
  {
    at: 500,
    url: "https://www.mybank.example/accounts?id=SECRET",
    title: "SECRET balance",
    open: 60,
    term: "SECRET",
  },
  { at: 600, url: "http://localhost:3000/admin", title: "SECRET local", open: 60 },
  { at: 700, url: "https://diary.example.org/today", title: "SECRET diary", open: 60 },
  { at: 800, url: "file:///Users/someone/SECRET.pdf", title: "SECRET file", open: 60 },
  { at: 900, url: "https://untitled.example.com/page?q=SECRET", open: 5 },
  {
    at: 1000,
    url: "https://plain.example.com/a?b=SECRET",
    title: "https://plain.example.com/a?b=SECRET",
    open: 5,
  },
  // One search, paged through three times, then a new one, then the first again two hours later.
  { at: 4000, url: "https://www.google.com/search?q=one", title: "one", open: 20, term: "cheap flights" },
  {
    at: 4030,
    url: "https://www.google.com/search?q=one&start=10",
    title: "one",
    open: 0,
    term: "cheap flights",
  },
  {
    at: 4060,
    url: "https://www.google.com/search?q=one&start=20",
    title: "one",
    open: 9,
    term: "Cheap  Flights",
  },
  { at: 4100, url: "https://www.google.com/search?q=two", title: "two", open: 0, term: "train times" },
  {
    at: 11_500,
    url: "https://www.google.com/search?q=one&again=1",
    title: "one",
    open: 4,
    term: "cheap flights",
  },
  {
    at: 11_600,
    url: "https://search.example.com/find?q=three",
    title: "three",
    open: 4,
    term: "site search",
  },
]);
writeHistory("Profile 1", [
  { at: 50, url: "https://github.com/someone/repo/pull/7", title: "Pull request", open: 90 },
]);
writeFileSync(excludeFile, "# my own list\n\n*.diary.example.org\n");

const reader = createChromeReader({ chromeDir, excludeFile });
const run = (cursor: string | null) => {
  const tmpDir = mkdtempSync(join(root, "tmp-"));
  return reader.read({ cursor, backfillDays: 30, tmpDir, log: () => {} });
};

try {
  const first = await run(null);
  const everything = JSON.stringify(first.events);
  const visits = first.events.filter((event) => event.type === "web_visit");
  const searches = first.events.filter((event) => event.type === "search");
  const byHost = (host: string) => visits.filter((event) => event.data?.host === host);

  // Privacy: nothing from an excluded visit, and never a path or a query string.
  assert.ok(!everything.includes("SECRET"), "a path, query string or excluded title leaked");
  assert.ok(!everything.includes("://"), "a full address leaked");
  assert.ok(
    !everything.includes("mybank") && !everything.includes("localhost") && !everything.includes("diary"),
  );
  assert.ok(first.events.every((event) => event.source === "chrome" && event.data?.origin === "history"));

  // Durations: foreground time wins, long tabs are capped, instant visits and frames are dropped.
  assert.deepEqual(byHost("example.com")[0]?.data, {
    host: "example.com",
    seconds: 30,
    foreground: false,
    origin: "history",
    profile: "Default",
  });
  assert.equal(byHost("example.com")[0]?.title, "Order 42");
  assert.equal(byHost("example.com").length, 1, "the zero second hop must be dropped");
  const doc = byHost("docs.google.com")[0]?.data;
  assert.deepEqual([doc?.seconds, doc?.foreground, doc?.category], [12, true, "work"]);
  assert.equal(byHost("shop.example.org")[0]?.data?.seconds, 7200);
  assert.equal(byHost("ads.example.net").length, 0);
  const order = byHost("example.com")[0];
  assert.equal(Date.parse(order?.end_at ?? "") - Date.parse(order?.start_at ?? ""), 30_000);

  // Titles: a missing title, or one that is an address, becomes the host.
  assert.equal(byHost("untitled.example.com")[0]?.title, "untitled.example.com");
  assert.equal(byHost("plain.example.com")[0]?.title, "plain.example.com");

  // Searches: repeats close together count once; the same term much later counts again.
  assert.deepEqual(
    searches.map((event) => [event.title, event.data?.engine, event.end_at]),
    [
      ["cheap flights", "google", null],
      ["train times", "google", null],
      ["cheap flights", "google", null],
      ["site search", "search.example.com", null],
    ],
  );
  assert.equal(byHost("google.com").length, 3, "search pages with time on them are visits too");
  assert.equal(byHost("google.com")[0]?.data?.category, undefined);

  // Profiles: ids are stable and never collide across profiles.
  const ids = first.events.map((event) => event.external_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("chrome:Default:1") && ids.includes("chrome:Profile 1:1"));
  assert.ok(ids.includes("chrome:Default:search:12"));
  assert.deepEqual(Object.keys(JSON.parse(first.cursor ?? "{}")), ["Default", "Profile 1"]);

  // A second run from the saved cursor finds nothing the first run did not.
  const second = await run(first.cursor);
  assert.ok(second.events.every((event) => ids.includes(event.external_id)));
  assert.equal(second.cursor, first.cursor);

  // The shared helpers.
  assert.equal(hostFromUrl("https://WWW.Example.com:8443/a?b=c"), "example.com");
  assert.equal(hostFromUrl("chrome://settings"), null);
  assert.equal(siteCategory("mail.google.com"), "communication");
  assert.equal(siteCategory("google.co.uk"), undefined);
  assert.equal(siteCategory("maps.google.com"), undefined);
  assert.equal(siteCategory("aws.amazon.com"), "work");
  assert.equal(siteCategory("amazon.de"), "shopping");
  assert.equal(siteCategory("unknown.example.com"), undefined);
  for (const host of [
    "192.168.1.1",
    "10.0.0.5",
    "printer",
    "nas.local",
    "[::1]",
    "paypal.com",
    "app.1password.com",
  ]) {
    assert.ok(isExcludedHost(host), `${host} should be excluded`);
  }
  for (const host of ["example.com", "8.8.8.8", "github.com"]) {
    assert.ok(!isExcludedHost(host), `${host} should be kept`);
  }
  assert.deepEqual(parseExcludeList("# note\nExample.com\n*.b.example.org\nhttps://www.c.example/x?y=1\n"), [
    "example.com",
    "b.example.org",
    "c.example",
  ]);

  console.log(`Chrome reader check passed: ${visits.length} visits, ${searches.length} searches.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
