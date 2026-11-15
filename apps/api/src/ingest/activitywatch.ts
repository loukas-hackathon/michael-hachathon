import { bundleIdForAppName, categoriseApp, categoryRole, isBrowser } from "@michael/shared";
import { z } from "zod";
import { formatMinutes, type MappedEvent } from "./common";

// ActivityWatch (Mac, local server on localhost:5600) -> `app_usage` and `focus_session`.
// Events are AW bucket events exactly as `GET /api/0/buckets/<id>/events` returns them:
//   { id, timestamp: ISO, duration: seconds, data: { app, title } }        (aw-watcher-window)
//   { id, timestamp: ISO, duration: seconds, data: { status: "afk" | "not-afk" } } (aw-watcher-afk)
// Docs: https://docs.activitywatch.net/en/latest/buckets-and-events.html
// A small forwarder on the Mac posts either `{ window: [...], afk?: [...] }` or the body of
// `GET /api/0/export` (`{ buckets: { "<id>": { type, events } } }`).
//
// Window titles are never stored (they carry document names, chats, addresses); only app names.
// Apple's own activity store (apps/collector, #60) is the main Mac source; this one is optional.

const SOURCE = "activitywatch" as const;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
// Same app again within this gap is one run.
const MERGE_GAP_MS = 10 * SECOND;
// A run or focus stretch that ended this recently may still grow: wait for the next post.
const SETTLE_MS = 2 * MINUTE;

// Focus rule (documented in docs/api.md): a stretch of work app runs, where any gap or non work
// run between them is at most 3 minutes, that lasts at least 25 minutes from the first work run to
// the last, and in which work apps fill at least 70% of the time. Browsers are neutral: they do
// not break a stretch but do not count as work.
export const FOCUS_MIN_MS = 25 * MINUTE;
const FOCUS_BREAK_MS = 3 * MINUTE;
const FOCUS_WORK_SHARE = 0.7;

// Which apps are work comes from the one categoriser (packages/shared/src/categories.ts): an app
// whose category has the work role (work, ai) is work, a browser is neutral, the rest is other.
type Kind = "work" | "neutral" | "other";
export const appKind = (app: string): Kind => {
  const bundle = bundleIdForAppName(app);
  if (!bundle) return "other";
  if (isBrowser(bundle)) return "neutral";
  return categoryRole(categoriseApp(bundle)) === "work" ? "work" : "other";
};

const AwEvent = z.object({
  timestamp: z.string(),
  duration: z.coerce.number().nonnegative(),
  data: z.object({ app: z.string().optional(), status: z.string().optional() }).catch({}),
});
const events = z.array(z.unknown()).optional().catch(undefined);

export const AwPayload = z.union([
  z.object({ window: z.array(z.unknown()), afk: events }),
  z.object({
    buckets: z.record(
      z.string(),
      z.object({ type: z.string().optional(), events: z.array(z.unknown()).catch([]) }),
    ),
  }),
]);

interface Span {
  start: number;
  end: number;
}
interface Run extends Span {
  app: string;
}

function spans(raw: unknown[] | undefined): (Span & { app?: string; status?: string })[] {
  const out: (Span & { app?: string; status?: string })[] = [];
  for (const r of raw ?? []) {
    const e = AwEvent.safeParse(r);
    if (!e.success) continue;
    const start = Date.parse(e.data.timestamp);
    if (!Number.isFinite(start) || e.data.duration <= 0) continue;
    out.push({
      start,
      end: start + e.data.duration * SECOND,
      app: e.data.data.app,
      status: e.data.data.status,
    });
  }
  return out;
}

/** Cuts the away (afk) spans out of a window span. */
function subtract(s: Run, away: Span[]): Run[] {
  let pieces: Run[] = [s];
  for (const a of away) {
    if (a.end <= s.start || a.start >= s.end) continue;
    pieces = pieces.flatMap((p) => {
      if (a.end <= p.start || a.start >= p.end) return [p];
      const keep: Run[] = [];
      if (a.start > p.start) keep.push({ ...p, end: a.start });
      if (a.end < p.end) keep.push({ ...p, start: a.end });
      return keep;
    });
  }
  return pieces;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function mapActivityWatch(payload: z.infer<typeof AwPayload>, now: number): MappedEvent[] {
  let windowRaw: unknown[] = [];
  let afkRaw: unknown[] = [];
  if ("window" in payload) {
    windowRaw = payload.window;
    afkRaw = payload.afk ?? [];
  } else {
    for (const [id, b] of Object.entries(payload.buckets)) {
      if (b.type === "currentwindow" || id.startsWith("aw-watcher-window"))
        windowRaw = windowRaw.concat(b.events);
      else if (b.type === "afkstatus" || id.startsWith("aw-watcher-afk")) afkRaw = afkRaw.concat(b.events);
    }
  }

  const away = spans(afkRaw).filter((s) => s.status === "afk");
  const pieces = spans(windowRaw)
    .filter((s): s is Run => Boolean(s.app?.trim()))
    .map((s) => ({ app: (s.app as string).trim(), start: s.start, end: s.end }))
    .flatMap((s) => subtract(s, away))
    .sort((a, b) => a.start - b.start);

  // Merge same app runs; a later piece that overlaps an earlier one is trimmed to start after it.
  const runs: Run[] = [];
  for (const p of pieces) {
    const last = runs.at(-1);
    const start = last ? Math.max(p.start, last.end) : p.start;
    if (p.end <= start) continue;
    if (last && last.app === p.app && start - last.end <= MERGE_GAP_MS) last.end = Math.max(last.end, p.end);
    else runs.push({ app: p.app, start, end: p.end });
  }
  const closed = runs.filter((r) => r.end <= now - SETTLE_MS && r.end - r.start >= SECOND);

  const out: MappedEvent[] = closed.map((r) => ({
    source: SOURCE,
    type: "app_usage",
    start_at: iso(r.start),
    end_at: iso(r.end),
    title: r.app,
    data: { app: r.app, device: "mac", seconds: Math.round((r.end - r.start) / SECOND) },
    external_id: `aw:${r.app.toLowerCase()}:${iso(r.start).slice(0, 19)}`,
  }));

  // Focus stretches.
  let block: Run[] = [];
  const flush = () => {
    const work = block.filter((r) => appKind(r.app) === "work");
    const first = work[0];
    const last = work.at(-1);
    block = [];
    if (!first || !last) return;
    const inside = runs.filter((r) => r.start >= first.start && r.end <= last.end);
    const span = last.end - first.start;
    const workMs = inside.filter((r) => appKind(r.app) === "work").reduce((a, r) => a + r.end - r.start, 0);
    if (span < FOCUS_MIN_MS || workMs / span < FOCUS_WORK_SHARE || last.end > now - SETTLE_MS) return;
    const apps: Record<string, number> = {};
    for (const r of inside)
      apps[r.app] = Math.round(((apps[r.app] ?? 0) + (r.end - r.start) / MINUTE) * 10) / 10;
    const top = Object.entries(apps)
      .filter(([a]) => appKind(a) === "work")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([a]) => a);
    out.push({
      source: SOURCE,
      type: "focus_session",
      start_at: iso(first.start),
      end_at: iso(last.end),
      title: `Deep work: ${top.join(" + ")} (${formatMinutes(span / MINUTE)})`,
      data: {
        apps,
        switches: Math.max(0, inside.length - 1),
        minutes: Math.round(span / MINUTE),
        work_share: Math.round((workMs / span) * 100) / 100,
      },
      external_id: `aw:focus:${iso(first.start).slice(0, 16)}`,
    });
  };
  // Time since the last work run, spent away or in other apps (browsers excluded).
  let breakMs = 0;
  let prevEnd = 0;
  for (const r of runs) {
    const kind = appKind(r.app);
    if (block.length) breakMs += Math.max(0, r.start - prevEnd);
    if (kind === "other") breakMs += r.end - r.start;
    if (block.length && breakMs > FOCUS_BREAK_MS) {
      flush();
      breakMs = kind === "other" ? r.end - r.start : 0;
    }
    if (kind === "work") {
      block.push(r);
      breakMs = 0;
    } else if (block.length) block.push(r);
    prevEnd = r.end;
  }
  flush();
  return out;
}
