// Prints exactly what an analysis run would send to the model, and sends nothing: the system
// prompt (the coach instructions) and the user message (the brief). For reading the brief with a
// critical eye and for testing the coach instructions by hand.
//
// It reads one user's data from a RUNNING local API over HTTP and builds the brief with the same
// pure function the route uses. No model is called and nothing leaves the machine.
//
//   pnpm --filter @michael/api analysis:brief --from 2026-11-12T00:00:00+02:00 \
//     --to 2026-11-13T00:00:00+02:00 --trigger evening --api http://localhost:8817
//
// For real days, read from a local API on the in-memory store, started with DEMO_WEEK=off so the
// demo account holds only what you posted (check that GET /health says "storage":"memory"):
//
//   PORT=8817 DEMO_WEEK=off pnpm --filter @michael/api start
//
// Options:
//   --from, --to   the range, ISO with offset (default: today so far in Europe/Athens)
//   --trigger      manual | scheduled | mcp | morning | evening (default manual)
//   --api          base URL of the API to read from (default http://localhost:8787)
//   --key          its API key (default: API_KEY from the environment, else dev-key)
//   --now          write the brief as of this instant (default: the range end, or the clock if earlier)
//   --keep-mocks   keep the in-memory store's mock day, goals and recommendations (dropped by default)
//   --stats        print sizes to stderr

import { parseArgs } from "node:util";
import {
  type AnalysisRun,
  AnalysisTrigger,
  type Event,
  type Goal,
  mockAnalysisRun,
  mockEvents,
  mockGoals,
  mockRecommendations,
  type Recommendation,
} from "@michael/shared";
import { briefWindow, buildBrief, renderUserMessage } from "../src/analysis/brief";
import { COACH_INSTRUCTIONS } from "../src/analysis/coach";
import { DEFAULT_TIMEZONE } from "../src/patterns";
import { DAY, Zone } from "../src/patterns/time";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    from: { type: "string" },
    to: { type: "string" },
    trigger: { type: "string", default: "manual" },
    api: { type: "string", default: "http://localhost:8787" },
    key: { type: "string", default: process.env.API_KEY ?? "dev-key" },
    now: { type: "string" },
    "keep-mocks": { type: "boolean", default: false },
    stats: { type: "boolean", default: false },
  },
});

const api = args.api.replace(/\/$/, "");
const host = new URL(api).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(
    `--api must be a local API (got ${host}). This script is for reading real days on your own machine.`,
  );
  process.exit(1);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${args.key}` } });
  if (!res.ok) throw new Error(`GET ${path} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

const trigger = AnalysisTrigger.parse(args.trigger);
const zone = new Zone(DEFAULT_TIMEZONE);
const clock = new Date();
const to = args.to ?? clock.toISOString();
const from = args.from ?? new Date(zone.startOfDay(zone.dayOf(Date.parse(to) - 1))).toISOString();
const now = args.now ?? new Date(Math.min(clock.getTime(), Date.parse(to))).toISOString();

// The same window the route reads, a day at a time (see loadEvents in src/analysis/run.ts).
const window = briefWindow({ from, to, now });
const byId = new Map<string, Event>();
for (let t = Date.parse(window.from); t < Date.parse(window.to); t += DAY) {
  const a = new Date(t).toISOString();
  const b = new Date(Math.min(Date.parse(window.to), t + DAY)).toISOString();
  const page = await get<{ events: Event[] }>(
    `/v1/timeline?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}`,
  );
  for (const e of page.events) byId.set(e.id, e);
}
let events = [...byId.values()].sort((x, y) => Date.parse(x.start_at) - Date.parse(y.start_at));
let goals = (await get<{ goals: Goal[] }>("/v1/goals")).goals;
let recommendations = (await get<{ recommendations: Recommendation[] }>("/v1/recommendations"))
  .recommendations;

if (!args["keep-mocks"]) {
  // The in-memory store starts every user with a mock day. It is not this person's data.
  const mock = new Set([...mockEvents, ...mockGoals, ...mockRecommendations].map((x) => x.id));
  events = events.filter((e) => !mock.has(e.id));
  goals = goals.filter((g) => !mock.has(g.id));
  recommendations = recommendations.filter((r) => !mock.has(r.id));
}

// The API has no list of past runs: the latest one is what a local run can know about.
const latest = await fetch(`${api}/v1/analysis/latest`, { headers: { Authorization: `Bearer ${args.key}` } });
const run = latest.ok ? ((await latest.json()) as { run: AnalysisRun }).run : null;
const asked =
  run?.question && (args["keep-mocks"] || run.id !== mockAnalysisRun.id)
    ? [{ question: run.question, asked_at: run.started_at }]
    : [];

const { brief } = buildBrief({
  events,
  goals,
  recommendations,
  from,
  to,
  now,
  trigger,
  instructions: [],
  actionsAre: "offers",
  asked,
});
const user = renderUserMessage(brief);

console.log("===== SYSTEM PROMPT =====");
console.log(COACH_INSTRUCTIONS);
console.log("");
console.log("===== USER MESSAGE =====");
console.log(user);

if (args.stats) {
  console.error(
    `events read: ${events.length}, goals: ${goals.length}, system prompt: ${COACH_INSTRUCTIONS.length} characters, user message: ${user.length} characters`,
  );
}
