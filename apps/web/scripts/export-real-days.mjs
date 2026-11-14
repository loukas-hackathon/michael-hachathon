// Exports real days of the owner's own data as JSON fixtures for designing the web interface.
//
// What it does, end to end, on the Mac whose data you want:
//   1. starts apps/api locally on a free port with the IN-MEMORY store (Supabase and Gemini env
//      vars are removed from its environment, and the script stops if /health reports anything
//      other than "memory"), unless --api-url points at an API you already run on localhost;
//   2. runs the collector once against it (all readers, --backfill-days back) with a throwaway
//      cursor file, so the real collector's saved positions in ~/.michael are never touched;
//   3. for each Athens day: GET /v1/timeline for that day, drops the in-memory store's mock day,
//      ANONYMISES every event (see `anonymise`: no page titles, site hosts, search terms, prompt
//      text or project folders, because those carry other people's names and the repo is public),
//      masks anything that looks like a key, token, email or phone number, validates every event
//      against the `Event` schema from @michael/shared and writes <day>.json;
//   4. writes <day>.patterns.json: the pattern report GET /v1/patterns would return, built with the
//      same pure function the route calls (buildPatternReport) but fed only the ANONYMISED real
//      events, so no summary or evidence line can carry a page title or a site name. (The in-memory
//      store's mock day is dropped too.)
//
// Run from the repository root (tsx is needed because @michael/shared ships TypeScript source):
//
//   pnpm -C apps/api exec tsx ../web/scripts/export-real-days.mjs
//   pnpm -C apps/api exec tsx ../web/scripts/export-real-days.mjs --days "2026-11-12=Workday,2026-11-14=Today"
//
// Options:
//   --days "YYYY-MM-DD=label,..."  days to export (default: the list in DEFAULT_DAYS below)
//   --week YYYY-MM-DD..YYYY-MM-DD  also write a multi day pattern report (default: DEFAULT_WEEK)
//   --port N                       port for the local API it starts (default 8790)
//   --api-url URL                  use an API already running on localhost instead of starting one
//   --skip-collect                 do not run the collector (the API already holds the data)
//   --backfill-days N              how far back the collector reads (default 30)
//   --max-bytes N                  size cap per day file (default 1500000)
//   --out DIR                      output folder (default apps/web/lib/sample/real)

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Event, mockEvents, scrubSecrets } from "@michael/shared";
import { buildPatternReport } from "../../api/src/patterns/index.ts";

const TIMEZONE = "Europe/Athens";
const DEFAULT_DAYS = [
  ["2026-11-12", "Thursday 12 Nov: most recent full workday with every source synced"],
  ["2026-10-29", "Thursday 29 Oct: heaviest phone day of the month, focus broken up all day"],
  ["2026-11-01", "Sunday 1 Nov: light weekend day, Mac barely opened"],
  ["2026-11-14", "Saturday 14 Nov: today so far (hackathon day one), iPhone not synced yet"],
];
const DEFAULT_WEEK = "2026-11-06..2026-11-12";
// The pattern route reads 18 hours past the range for sleep and recovery the morning after.
const LOOKAHEAD_MS = 18 * 3600_000;

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    days: { type: "string" },
    week: { type: "string", default: DEFAULT_WEEK },
    port: { type: "string", default: "8790" },
    "api-url": { type: "string" },
    "skip-collect": { type: "boolean", default: false },
    "backfill-days": { type: "string", default: "30" },
    "max-bytes": { type: "string", default: "1500000" },
    out: { type: "string", default: join(repo, "apps/web/lib/sample/real") },
  },
});

const days = args.days
  ? args.days.split(",").map((pair) => {
      const [date, ...label] = pair.split("=");
      return [date.trim(), label.join("=").trim() || date.trim()];
    })
  : DEFAULT_DAYS;
const maxBytes = Number(args["max-bytes"]);
const apiKey = `export-${Math.random().toString(36).slice(2)}`;
const mockIds = new Set(mockEvents.map((e) => e.id));
const children = [];

// ---------- time ----------

/** The instant local midnight starts `date` in Athens, as ISO with its offset. */
function athensMidnight(date) {
  for (const offset of ["+02:00", "+03:00"]) {
    const iso = `${date}T00:00:00${offset}`;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso));
    const get = (t) => parts.find((p) => p.type === t)?.value;
    if (`${get("year")}-${get("month")}-${get("day")}` === date && get("hour") === "00") return iso;
  }
  throw new Error(`Cannot place midnight of ${date} in ${TIMEZONE}`);
}

const nextDate = (date) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const dayRange = (from, toInclusive) => ({
  from: athensMidnight(from),
  to: athensMidnight(nextDate(toInclusive)),
});

// ---------- api ----------

let apiUrl = args["api-url"]?.replace(/\/$/, "");

async function api(path) {
  const res = await fetch(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`GET ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function run(cmd, cmdArgs, opts) {
  const child = spawn(cmd, cmdArgs, { stdio: ["ignore", process.stderr, process.stderr], ...opts });
  children.push(child);
  return child;
}

async function startApi() {
  const env = { ...process.env, PORT: args.port, API_KEY: apiKey, NODE_ENV: "development" };
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"]) delete env[k];
  apiUrl = `http://localhost:${args.port}`;
  run(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: join(repo, "apps/api"), env });
  for (let i = 0; i < 60; i++) {
    try {
      const health = await (await fetch(`${apiUrl}/health`)).json();
      return health;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Local API did not start");
}

function collect() {
  const stateDir = mkdtempSync(join(tmpdir(), "michael-export-"));
  const env = {
    ...process.env,
    MICHAEL_API_URL: apiUrl,
    MICHAEL_API_KEY: apiKey,
    MICHAEL_STATE_FILE: join(stateDir, "collector-state.json"),
  };
  const child = run(
    process.execPath,
    ["--import", "tsx", "src/index.ts", "--once", "--backfill-days", args["backfill-days"]],
    { cwd: join(repo, "apps/collector"), env },
  );
  return new Promise((ok, fail) =>
    child.on("exit", (code) => {
      rmSync(stateDir, { recursive: true, force: true });
      code === 0 ? ok() : fail(new Error(`collector exited with ${code}`));
    }),
  );
}

// ---------- cleaning ----------

// Ids and timestamps pass through untouched.
const UUID_OR_TIME =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))$/i;
// Contact details of other people turn up in mail tab titles and typed prompts; the fixtures are
// public, so every email address and phone number is masked too (the collectors keep them).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE =
  /(?<![\w-])(?:\+\d{1,3}[ .]?)?(?:69\d|2\d\d)[ .]?\d{3}[ .]?\d{4}(?![\w-])|(?<![\w-])\+\d{1,3}(?:[ .]?\d){8,12}(?![\w-])/g;

/** Masks secrets ([secret]) and contact details ([email], [phone]) in every string of a JSON value. */
function scrub(value) {
  if (typeof value === "string") {
    if (UUID_OR_TIME.test(value)) return value;
    return scrubSecrets(value).replace(EMAIL, "[email]").replace(PHONE, "[phone]");
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}

// Sites are titled by category only. Hosts of uncategorised sites are dropped: a host can be a
// client's or a friend's own domain.
const CATEGORY_TITLE = {
  travel: "Travel site",
  shopping: "Shopping site",
  social: "Social site",
  news: "News site",
  video: "Video site",
  messaging: "Messaging site",
  mail: "Mail",
  dev: "Developer site",
  ai: "AI tool",
  docs: "Docs",
  finance: "Finance site",
  search: "Search engine",
  // The shared vocabulary (packages/shared/src/categories.ts), which newer events carry.
  communication: "Messaging site",
  work: "Work site",
  music: "Music site",
};

const pick = (data, keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));

/**
 * Keeps the shape of the day (what kind of thing, when, how long, which app) and drops every free
 * text field that can name someone: page titles, hosts, search terms, prompt text, project folders.
 * App names stay ("WhatsApp", "VS Code"); they name software, not people.
 */
function anonymise(e) {
  const d = e.data ?? {};
  switch (e.type) {
    case "app_usage":
    case "notification":
      return { ...e, data: pick(d, ["bundle_id", "device", "seconds", "opened_from"]) };
    case "screen":
      return { ...e, data: pick(d, ["state", "device"]) };
    case "web_visit":
      return {
        ...e,
        title: CATEGORY_TITLE[d.category] ?? "Website",
        // The host stays only for well known public sites (those the collector's built in list
        // categorises, such as instagram.com or mail.google.com), so focus findings stay right.
        data: pick(
          d,
          d.category
            ? ["host", "category", "seconds", "foreground", "origin"]
            : ["category", "seconds", "foreground", "origin"],
        ),
      };
    case "search":
      return { ...e, title: "Search", data: pick(d, ["engine", "origin"]) };
    case "ai_session":
      return {
        ...e,
        title: "Claude Code session",
        data: pick(d, [
          "tool",
          "session_id",
          "model",
          "turns",
          "waiting_seconds",
          "input_tokens",
          "cached_input_tokens",
          "output_tokens",
        ]),
      };
    case "ai_prompt":
      return { ...e, title: "Prompt", data: pick(d, ["tool", "session_id"]) };
    default:
      return { ...e, title: e.type.replace(/_/g, " "), data: {} };
  }
}

const realEvents = (events) => events.filter((e) => !mockIds.has(e.id)).map(anonymise);

const sizeOf = (obj) => Buffer.byteLength(`${JSON.stringify(obj, null, 2)}\n`);

/** Drops the shortest app sessions, then the shortest web visits, until the file fits. */
function fit(file) {
  const dropped = [];
  const steps = [
    ["app_usage under 5 seconds", (e) => e.type === "app_usage" && Number(e.data.seconds ?? 99) < 5],
    ["web_visit under 5 seconds", (e) => e.type === "web_visit" && Number(e.data.seconds ?? 99) < 5],
  ];
  for (const [what, test] of steps) {
    if (sizeOf(file) <= maxBytes) break;
    const before = file.events.length;
    file.events = file.events.filter((e) => !test(e));
    dropped.push(`${before - file.events.length} ${what}`);
  }
  return dropped;
}

// ---------- patterns ----------

async function patternsFor(range, goals, now) {
  const lookaheadTo = new Date(Date.parse(range.to) + LOOKAHEAD_MS).toISOString();
  const all = (await api(`/v1/timeline?${new URLSearchParams({ from: range.from, to: lookaheadTo })}`))
    .events;
  const real = realEvents(all);
  const report = buildPatternReport(real, { from: range.from, to: range.to, now, goals });
  return { report: scrub(report), check: "built from the anonymised real events" };
}

// ---------- main ----------

async function main() {
  if (apiUrl) {
    const host = new URL(apiUrl).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") throw new Error("--api-url must be a local API");
  } else {
    const health = await startApi();
    if (health.storage !== "memory") throw new Error(`Local API uses ${health.storage}, expected memory`);
  }
  if (!args["skip-collect"]) await collect();

  mkdirSync(args.out, { recursive: true });
  const { goals } = await api("/v1/goals");
  const now = new Date().toISOString();
  const summary = [];

  for (const [date, label] of days) {
    const range = dayRange(date, date);
    const timeline = await api(`/v1/timeline?${new URLSearchParams(range)}`);
    const events = realEvents(timeline.events).map((e) => Event.parse(scrub(e)));
    const file = { date, label, events };
    const dropped = fit(file);
    const { report, check } = await patternsFor(range, goals, now);

    writeFileSync(join(args.out, `${date}.json`), `${JSON.stringify(file, null, 2)}\n`);
    writeFileSync(join(args.out, `${date}.patterns.json`), `${JSON.stringify(report, null, 2)}\n`);

    const counts = {};
    for (const e of file.events) counts[`${e.source} ${e.type}`] = (counts[`${e.source} ${e.type}`] ?? 0) + 1;
    summary.push({
      date,
      events: file.events.length,
      bytes: sizeOf(file),
      pattern_bytes: sizeOf(report),
      counts,
      dropped,
      patterns: check,
      headlines: report.headlines,
    });
  }

  if (args.week) {
    const [from, to] = args.week.split("..");
    const { report, check } = await patternsFor(dayRange(from, to), goals, now);
    const name = `week-${from}_${to}.patterns.json`;
    writeFileSync(join(args.out, name), `${JSON.stringify(report, null, 2)}\n`);
    summary.push({ week: `${from}..${to}`, file: name, bytes: sizeOf(report), patterns: check });
  }

  // Biome keeps short arrays on one line; format now so `pnpm check` passes on the new files.
  spawnSync("pnpm", ["exec", "biome", "format", "--write", args.out], { cwd: repo, stdio: "ignore" });
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const child of children) child.kill();
  });
