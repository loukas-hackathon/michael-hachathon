import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { EventInput } from "@michael/shared";
import { startDndKeeper } from "./dnd";
import { startFocusGuardian } from "./focus-guard";
import { readers } from "./readers/index";

// Michael's collector: runs on the user's own Mac or Windows PC, reads what the computer already
// knows about the day and posts it to Michael's timeline. It only reads; it never changes the files
// it looks at. On Windows it reads ActivityWatch and Claude Code (readersFor in readers/index.ts).
// While watching it also enforces focus guards (focus-guard.ts): muted apps are closed when they
// come to the front. --no-guard turns that off.

const { values } = parseArgs({
  // pnpm passes a bare "--" through; drop it so both `pnpm collect --list` and `-- --list` work.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    sources: { type: "string" },
    "backfill-days": { type: "string", default: "30" },
    once: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    interval: { type: "string", default: "60" },
    list: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    "no-guard": { type: "boolean", default: false },
    "no-dnd": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const API_URL = (process.env.MICHAEL_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const API_KEY = process.env.MICHAEL_API_KEY ?? "dev-key";
const STATE_FILE = process.env.MICHAEL_STATE_FILE ?? join(homedir(), ".michael", "collector-state.json");
const BATCH = 500;

type State = { cursors: Record<string, string | null> };

const loadState = (): State => {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return { cursors: {} };
  }
};

const saveState = (state: State) => {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

type Totals = { inserted: number; duplicates: number; ignored: number };

/** One body to a source's own ingest route (ActivityWatch's webhook). Same answer as the batch. */
async function postTo(path: string, body: unknown, totals: Totals) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`API answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const r = (await response.json()) as { inserted: number; duplicates: number; ignored?: number };
  totals.inserted += r.inserted;
  totals.duplicates += r.duplicates;
  totals.ignored += r.ignored ?? 0;
}

async function post(events: EventInput[]) {
  const totals = { inserted: 0, duplicates: 0, ignored: 0 };
  for (let i = 0; i < events.length; i += BATCH) {
    const response = await fetch(`${API_URL}/v1/events/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ events: events.slice(i, i + BATCH) }),
    });
    if (!response.ok) {
      throw new Error(`API answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = (await response.json()) as { inserted: number; duplicates: number; ignored?: number };
    totals.inserted += body.inserted;
    totals.duplicates += body.duplicates;
    totals.ignored += body.ignored ?? 0;
  }
  return totals;
}

async function runOnce(selected: typeof readers, dryRun: boolean, backfillDays: number) {
  const state = loadState();
  const tmpDir = mkdtempSync(join(tmpdir(), "michael-collector-"));
  try {
    for (const reader of selected) {
      const log = (message: string) => console.log(`[${reader.name}] ${message}`);
      try {
        const result = await reader.read({
          cursor: state.cursors[reader.name] ?? null,
          backfillDays,
          tmpDir,
          log,
        });
        const posts = result.posts ?? [];
        if (dryRun && posts.length > 0) {
          const read = posts.reduce((n, p) => n + p.count, 0);
          log(`dry run: ${read} events in ${posts.length} posts to ${posts[0]?.path}`);
          continue;
        }
        if (dryRun) {
          const byType = new Map<string, number>();
          for (const e of result.events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
          const first = result.events[0]?.start_at ?? "none";
          const last = result.events.at(-1)?.start_at ?? "none";
          log(`dry run: ${JSON.stringify(Object.fromEntries(byType))} from ${first} to ${last}`);
          continue;
        }
        if (posts.length > 0) {
          const totals: Totals = { inserted: 0, duplicates: 0, ignored: 0 };
          for (const p of posts) await postTo(p.path, p.body, totals);
          log(
            `posted: ${totals.inserted} new, ${totals.duplicates} already there, ${totals.ignored} ignored`,
          );
        }
        if (result.events.length > 0) {
          const totals = await post(result.events);
          log(
            `posted: ${totals.inserted} new, ${totals.duplicates} already there, ${totals.ignored} ignored`,
          );
        }
        state.cursors[reader.name] = result.cursor;
        saveState(state);
      } catch (error) {
        // One broken source must not stop the others.
        log(`failed: ${(error as Error).message}`);
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  if (values.help) {
    console.log(`Michael collector

  pnpm --filter @michael/collector start [options]

  --list               show the sources this computer can read
  --sources a,b        only these sources (default: all)
  --backfill-days N    how far back the first run reads (default 30)
  --once               run one pass and exit (default: repeat every --interval seconds)
  --interval N         seconds between passes (default 60)
  --dry-run            read and count, post nothing, keep cursors unchanged
  --reset              forget saved positions, so the next run backfills again
  --no-guard           do not close muted apps during focus guards (on by default while watching)
  --no-dnd             never switch on Do Not Disturb, even when you ask for it in a nudge

  MICHAEL_API_URL      where to post (default http://localhost:8787)
  MICHAEL_API_KEY      bearer key for the API (default dev-key)
  MICHAEL_AW_URL       ActivityWatch's local server (default http://localhost:5600)`);
    return;
  }
  if (values.list) {
    for (const reader of readers) console.log(`${reader.name.padEnd(14)} ${reader.describe}`);
    return;
  }
  if (values.reset) {
    saveState({ cursors: {} });
    console.log("Saved positions cleared.");
    return;
  }

  const wanted = values.sources?.split(",").map((s) => s.trim());
  const selected = wanted ? readers.filter((r) => wanted.includes(r.name)) : readers;
  if (selected.length === 0) throw new Error(`No such source. Try --list.`);
  const backfillDays = Number(values["backfill-days"]);
  const dryRun = values["dry-run"];

  console.log(`Posting to ${API_URL}${dryRun ? " (dry run: nothing is sent)" : ""}`);
  await runOnce(selected, dryRun, backfillDays);
  if (values.once || dryRun) return;

  const seconds = Math.max(10, Number(values.interval));
  console.log(`Watching. Next pass every ${seconds} seconds. Stop with Ctrl+C.`);
  if (process.platform === "darwin" && !values["no-guard"]) {
    console.log("Focus guards on: muted apps close when they come to the front.");
    startFocusGuardian({ apiUrl: API_URL, apiKey: API_KEY });
  }
  if (process.platform === "darwin" && !values["no-dnd"]) {
    console.log(
      "Do Not Disturb on request: switched on when you tap it in a nudge (Michael Focus shortcut).",
    );
    startDndKeeper({ apiUrl: API_URL, apiKey: API_KEY });
  }
  setInterval(() => void runOnce(selected, false, backfillDays), seconds * 1000);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
