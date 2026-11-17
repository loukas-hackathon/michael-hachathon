import { hostname as osHostname } from "node:os";
import type { Reader, ReaderContext, ReaderResult } from "../types";

// ActivityWatch (https://docs.activitywatch.net) runs on Windows, Mac and Linux and keeps a local
// server on localhost:5600. Its window watcher records which app is in front, its afk watcher when
// the person was away. This reader asks that server for this computer's two buckets, from where the
// last pass stopped, and forwards the events to POST /v1/webhooks/activitywatch, which turns them
// into `app_usage` runs and `focus_session` stretches (apps/api/src/ingest/activitywatch.ts).
//
// PRIVACY: window titles carry document names, chats and addresses. They are dropped here, before
// anything leaves the computer: only the app name, the time and the length are sent.
//
// API used (all GET, read only): /api/0/buckets/ and /api/0/buckets/<id>/events?start=&end=&limit=-1
// (https://docs.activitywatch.net/en/latest/api/rest.html).

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
// Each pass sends the last stretch again, so a run or focus stretch still open last time is sent
// whole once it ends (the API skips what ended in the last two minutes and stores each run once).
export const LOOKBACK_MS = 3 * 60 * MINUTE;
// The API merges the same app within this gap into one run: never start a pass inside such a run.
const MERGE_GAP_MS = 10 * SECOND;
// A backfill is sent a day at a time.
const CHUNK_MS = DAY;

type Bucket = { id?: string; type?: string; hostname?: string; client?: string };
type AwEvent = { timestamp: string; duration: number; data: Record<string, unknown> };
type Sent = { timestamp: string; duration: number; data: { app?: string; status?: string } };
export type AwDevice = "mac" | "windows" | "linux";

export const deviceOf = (platform: NodeJS.Platform): AwDevice =>
  platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux";

/** The window and afk buckets of this computer; another computer's synced buckets are left out. */
export function pickBuckets(
  buckets: Record<string, Bucket>,
  host: string,
): { window: string[]; afk: string[] } {
  const short = (h: string) => h.toLowerCase().split(".")[0] ?? "";
  const mine = (b: Bucket) => Boolean(b.hostname) && short(b.hostname as string) === short(host);
  const pick = (type: string) => {
    const all = Object.entries(buckets).filter(([, b]) => b.type === type);
    const own = all.filter(([, b]) => mine(b));
    // A host name ActivityWatch spells differently: with one bucket of the kind, it is this one.
    const chosen = own.length > 0 ? own : all.length === 1 ? all : [];
    return chosen.map(([id]) => id);
  };
  return { window: pick("currentwindow"), afk: pick("afkstatus") };
}

/** Only what the API reads: app (window) or status (afk). Titles never leave the computer. */
function strip(e: AwEvent, kind: "window" | "afk"): Sent | null {
  if (typeof e?.timestamp !== "string" || typeof e.duration !== "number") return null;
  const value = kind === "window" ? e.data?.app : e.data?.status;
  if (typeof value !== "string" || !value.trim()) return null;
  return {
    timestamp: e.timestamp,
    duration: e.duration,
    data: kind === "window" ? { app: value } : { status: value },
  };
}

const startOf = (e: Sent) => Date.parse(e.timestamp);
const endOf = (e: Sent) => startOf(e) + e.duration * SECOND;

/**
 * Where the next pass starts: the start of the first run that ended inside the look back, walked
 * back over the same app with gaps of up to 10 seconds, so no run is ever cut in two. Window
 * events never overlap, so nothing straddles that moment.
 */
export function nextStart(windowEvents: Sent[], now: number): number {
  const sorted = [...windowEvents].sort((a, b) => startOf(a) - startOf(b));
  const edge = now - LOOKBACK_MS;
  let i = sorted.findIndex((e) => endOf(e) > edge);
  if (i < 0) return edge;
  while (i > 0) {
    const prev = sorted[i - 1] as Sent;
    const cur = sorted[i] as Sent;
    if (prev.data.app !== cur.data.app || startOf(cur) - endOf(prev) > MERGE_GAP_MS) break;
    i--;
  }
  return Math.min(startOf(sorted[i] as Sent), edge);
}

type Options = {
  baseUrl?: string;
  hostname?: string;
  platform?: NodeJS.Platform;
  now?: () => number;
  fetch?: typeof fetch;
};

export function makeActivityWatch(opts: Options = {}): Reader {
  const base = (opts.baseUrl ?? process.env.MICHAEL_AW_URL ?? "http://localhost:5600").replace(/\/$/, "");
  const device = deviceOf(opts.platform ?? process.platform);
  const get = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let warned = false;

  async function json<T>(path: string): Promise<T> {
    const res = await get(`${base}${path}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`ActivityWatch answered ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  async function events(ids: string[], kind: "window" | "afk", from: number, to: number) {
    const out: Sent[] = [];
    const range = `start=${encodeURIComponent(new Date(from).toISOString())}&end=${encodeURIComponent(new Date(to).toISOString())}&limit=-1`;
    for (const id of ids) {
      const list = await json<AwEvent[]>(`/api/0/buckets/${encodeURIComponent(id)}/events?${range}`);
      for (const e of Array.isArray(list) ? list : []) {
        const s = strip(e, kind);
        if (s) out.push(s);
      }
    }
    return out.sort((a, b) => startOf(a) - startOf(b));
  }

  async function read(ctx: ReaderContext): Promise<ReaderResult> {
    let buckets: Record<string, Bucket>;
    try {
      buckets = await json<Record<string, Bucket>>("/api/0/buckets/");
    } catch {
      // Not installed or not running: say it once, then wait quietly. The position stays.
      if (!warned) ctx.log(`ActivityWatch is not running at ${base}. I will read it once it starts.`);
      warned = true;
      return { events: [], cursor: ctx.cursor };
    }
    warned = false;
    const ids = pickBuckets(buckets, opts.hostname ?? osHostname());
    if (ids.window.length === 0) {
      ctx.log("ActivityWatch has no window watcher for this computer yet.");
      return { events: [], cursor: ctx.cursor };
    }

    const to = now();
    const parsed = ctx.cursor ? Date.parse(ctx.cursor) : Number.NaN;
    const from = Number.isFinite(parsed) ? parsed : to - ctx.backfillDays * DAY;
    const posts: NonNullable<ReaderResult["posts"]> = [];
    const recent: Sent[] = [];
    for (let start = from; start < to; start += CHUNK_MS) {
      const end = Math.min(start + CHUNK_MS, to);
      const window = await events(ids.window, "window", start, end);
      if (window.length === 0) continue;
      const afk = await events(ids.afk, "afk", start, end);
      posts.push({ path: "/v1/webhooks/activitywatch", body: { device, window, afk }, count: window.length });
      if (end > to - LOOKBACK_MS - CHUNK_MS) recent.push(...window);
    }
    return { events: [], posts, cursor: new Date(Math.max(from, nextStart(recent, to))).toISOString() };
  }

  return {
    name: "activitywatch",
    source: "activitywatch",
    describe:
      "Which app was in front, from ActivityWatch (Windows, Mac, Linux). App names only, never window titles",
    read,
  };
}

export const activityWatch = makeActivityWatch();
