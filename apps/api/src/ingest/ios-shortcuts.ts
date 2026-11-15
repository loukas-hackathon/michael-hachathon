import { type Event, EventInput, type IngestResponse } from "@michael/shared";
import { z } from "zod";
import { currentUserId } from "../context";
import { type Store, store, type UpsertResult } from "../store";

// iPhone Shortcuts personal automations ("App is opened" / "App is closed") -> `app_usage`.
// Each automation runs "Get Contents of URL" with a tiny JSON body (our own format, see
// docs/sources/ios-shortcuts.md):
//   { "app": "Instagram", "action": "open" | "close", "at"?: ISO 8601, "bundle_id"?: string }
// `at` defaults to the arrival time (Shortcuts posts within a second or two).
//
// An open is stored at once (#488): an `app_usage` event from the open, one minute long for now,
// with `data.open: true`. Its close, or the next app's open (the iPhone has one app in front),
// rewrites that same event (same external_id) with the real end and seconds. An open never ended
// keeps its minute. Production, 15 Nov: opens were held in memory until the next signal, so one
// open stored nothing, chat had no data and every deploy dropped the open held at the time.

const SOURCE = "ios_shortcuts" as const;
// An open with no close after this long is a missed automation, not a session.
export const MAX_SESSION_MS = 2 * 3600_000;

export const ShortcutsPayload = z.object({
  // Empty or missing: the shortcut was run by hand in the Shortcuts app (no automation, so no app
  // as its input). That is the test run (#466): answered, never stored, never a 400. Production,
  // 15 Nov: a hand run was refused here, so the row stayed Not connected after a working setup.
  app: z.string().trim().max(200).default(""),
  // Missing means open: one "Is Opened" automation with only the app is enough, since opening the
  // next app closes the one before.
  action: z
    .string()
    .default("open")
    .transform((a) => {
      const v = a.trim().toLowerCase();
      return v === "" || v.startsWith("open") ? "open" : v.startsWith("clos") ? "close" : v;
    })
    .pipe(z.enum(["open", "close"])),
  // Lenient: anything Date.parse cannot read falls back to the arrival time.
  at: z.string().optional().catch(undefined),
  bundle_id: z.string().trim().min(1).max(200).optional().catch(undefined),
});
export type ShortcutsPayload = z.infer<typeof ShortcutsPayload>;

/** What the pairer needs from the store (scoped to the current user, like every store call). */
export type ShortcutsStore = Pick<Store, "listEvents" | "upsertEvents">;

// An open is stored at once with this length, until its close or the next app's open says more.
export const PROVISIONAL_MS = 60_000;

const key = (app: string) => app.toLowerCase();

function usage(
  app: string,
  bundleId: string | undefined,
  start: number,
  end: number,
  open: boolean,
  externalId?: string,
): z.output<typeof EventInput> {
  const startAt = new Date(start).toISOString();
  return EventInput.parse({
    source: SOURCE,
    type: "app_usage",
    start_at: startAt,
    end_at: new Date(end).toISOString(),
    title: app,
    data: {
      app,
      device: "iphone",
      seconds: Math.max(1, Math.round((end - start) / 1000)),
      ...(bundleId ? { bundle_id: bundleId } : {}),
      ...(open ? { open: true } : {}),
    },
    external_id: externalId ?? `sc:${key(app)}:${startAt.slice(0, 19)}`,
  });
}

const appOf = (e: Event) => (typeof e.data?.app === "string" ? e.data.app : e.title);

/** The open that event `e` still stands for, ended at `end` (its real length now). */
function ended(e: Event, end: number) {
  const bundleId = typeof e.data?.bundle_id === "string" ? e.data.bundle_id : undefined;
  return usage(appOf(e), bundleId, Date.parse(e.start_at), end, false, e.external_id ?? undefined);
}

/**
 * Turns Shortcuts signals into stored `app_usage` events, one user at a time. The database holds
 * every open, so nothing lives only in memory and a restart loses nothing (#488).
 */
export class ShortcutsPairer {
  private chains = new Map<string, Promise<unknown>>();

  constructor(private readonly s: ShortcutsStore = store) {}

  /** Stores what one signal means, at once. Returns the events inserted and the ones it ended. */
  handle(p: ShortcutsPayload, arrivedAt: number): Promise<IngestResponse> {
    // One signal at a time per user, so two opens a second apart never both start a session.
    const userId = currentUserId();
    const run = (this.chains.get(userId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.apply(p, arrivedAt));
    this.chains.set(userId, run);
    void run
      .finally(() => {
        if (this.chains.get(userId) === run) this.chains.delete(userId);
      })
      .catch(() => {});
    return run;
  }

  /** The newest open still standing (no close, no next app yet), started at most two hours before `at`. */
  private async lastOpen(at: number, app?: string): Promise<Event | null> {
    const events = await this.s.listEvents({
      from: new Date(at - MAX_SESSION_MS).toISOString(),
      to: new Date(at).toISOString(),
      source: [SOURCE],
      type: ["app_usage"],
    });
    const open = events.filter((e) => {
      const start = Date.parse(e.start_at);
      return (
        e.data?.open === true &&
        start <= at &&
        at - start <= MAX_SESSION_MS &&
        (app === undefined || key(appOf(e)) === key(app))
      );
    });
    return open.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)).at(-1) ?? null;
  }

  private async apply(p: ShortcutsPayload, arrivedAt: number): Promise<IngestResponse> {
    const parsed = p.at ? Date.parse(p.at) : Number.NaN;
    const at = Number.isFinite(parsed) ? parsed : arrivedAt;
    const writes: z.output<typeof EventInput>[] = [];

    if (p.action === "open") {
      const current = await this.lastOpen(at);
      // The same app opened twice keeps the first open (a duplicate automation run).
      if (current && key(appOf(current)) === key(p.app)) return written(null);
      // Another app in front means the one before was left, even if its close never came.
      if (current && at > Date.parse(current.start_at)) writes.push(ended(current, at));
      writes.push(usage(p.app, p.bundle_id, at, at + PROVISIONAL_MS, true));
    } else {
      // A close with no open standing (an app never opened, or opened over two hours ago) is dropped.
      const current = await this.lastOpen(at, p.app);
      if (current && at > Date.parse(current.start_at)) writes.push(ended(current, at));
    }
    return written(writes.length ? await this.s.upsertEvents(writes) : null);
  }
}

function written(r: UpsertResult | null): IngestResponse {
  return {
    inserted: r?.inserted.length ?? 0,
    duplicates: r?.unchanged ?? 0,
    ignored: 0,
    events: [...(r?.updated ?? []), ...(r?.inserted ?? [])],
  };
}
