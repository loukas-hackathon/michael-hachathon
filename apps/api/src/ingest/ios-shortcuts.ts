import { type Event, EventInput, type IngestResponse } from "@michael/shared";
import { z } from "zod";
import { currentUserId } from "../context";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
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
/** The title of an open whose app the automation did not name (data.app_unknown: true). */
export const UNKNOWN_APP = "An app";
// What an input with no real name can read as: an empty variable's name, never an app.
const PLACEHOLDER_NAMES = new Set(["text", "shortcut input", "app", "apps"]);
// Two unnamed opens closer than this are one automation run twice, not two opens.
const UNKNOWN_DUPLICATE_MS = 60_000;
// An open with no close after this long is a missed automation, not a session.
export const MAX_SESSION_MS = 2 * 3600_000;

// Other fields a hand made or future shortcut may carry the app in; `app` wins when it has a value.
const APP_FIELDS = ["app", "app_name", "appName", "name", "input", "text"] as const;
const appFrom = (raw: unknown) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const body = raw as Record<string, unknown>;
  const found = APP_FIELDS.map((f) => body[f]).find((v) => typeof v === "string" && v.trim() !== "");
  return found === undefined ? body : { ...body, app: found };
};

export const ShortcutsPayload = z.preprocess(
  appFrom,
  z.object({
    // Empty or missing: no app as the shortcut's input. The key's first such call is the hand run test
    // (#466): answered, never stored, never a 400. Later ones are App automations, which on current
    // iOS pass no input (production, 15 Nov): stored as an open of an unnamed app. A Text action
    // before Run Shortcut in the automation names the app; that text arrives here as it is.
    app: z
      .string()
      .trim()
      .max(200)
      .default("")
      .transform((a) => (PLACEHOLDER_NAMES.has(a.toLowerCase()) ? "" : a)),
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
  }),
);
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
  assumed = false,
): z.output<typeof EventInput> {
  const startAt = new Date(start).toISOString();
  return EventInput.parse({
    source: SOURCE,
    type: "app_usage",
    start_at: startAt,
    end_at: new Date(end).toISOString(),
    title: app || UNKNOWN_APP,
    data: {
      app: app || UNKNOWN_APP,
      device: "iphone",
      seconds: Math.max(1, Math.round((end - start) / 1000)),
      ...(app ? {} : { app_unknown: true }),
      ...(app && assumed ? { app_assumed: true } : {}),
      ...(bundleId ? { bundle_id: bundleId } : {}),
      ...(open ? { open: true } : {}),
    },
    external_id: externalId ?? `sc:${app ? key(app) : "unknown"}:${startAt.slice(0, 19)}`,
  });
}

/** The app's name, or "" for an open whose app the automation did not name. */
const appOf = (e: Event) =>
  e.data?.app_unknown === true ? "" : typeof e.data?.app === "string" ? e.data.app : e.title;

/** The open that event `e` still stands for, ended at `end` (its real length now). */
function ended(e: Event, end: number) {
  const bundleId = typeof e.data?.bundle_id === "string" ? e.data.bundle_id : undefined;
  const assumed = e.data?.app_assumed === true;
  return usage(appOf(e), bundleId, Date.parse(e.start_at), end, false, e.external_id ?? undefined, assumed);
}

/**
 * The user named the app their automation is for (profile.default_app): their own unnamed opens
 * from today (Athens) take that name, with data.app_assumed. Same external_id, so each is rewritten
 * in place. Returns how many were renamed.
 */
export async function assumeUnknownApps(app: string, now = Date.now(), s: ShortcutsStore = store) {
  const zone = new Zone(DEFAULT_TIMEZONE);
  const events = await s.listEvents({
    from: new Date(zone.startOfDay(zone.dayOf(now))).toISOString(),
    to: new Date(now + MAX_SESSION_MS).toISOString(),
    source: [SOURCE],
    type: ["app_usage"],
  });
  const writes = events
    .filter((e) => e.data?.app_unknown === true)
    .map((e) => {
      const { app_unknown: _unknown, ...data } = e.data ?? {};
      return EventInput.parse({
        source: SOURCE,
        type: "app_usage",
        start_at: e.start_at,
        end_at: e.end_at,
        title: app,
        data: { ...data, app, app_assumed: true },
        external_id: e.external_id,
      });
    });
  if (writes.length) await s.upsertEvents(writes);
  return writes.length;
}

/**
 * Turns Shortcuts signals into stored `app_usage` events, one user at a time. The database holds
 * every open, so nothing lives only in memory and a restart loses nothing (#488).
 */
export class ShortcutsPairer {
  private chains = new Map<string, Promise<unknown>>();

  constructor(private readonly s: ShortcutsStore = store) {}

  /** Stores what one signal means, at once. Returns the events inserted and the ones it ended. */
  /** `assumed`: p.app is the user's default app, standing in for a name the automation did not send. */
  handle(p: ShortcutsPayload, arrivedAt: number, assumed = false): Promise<IngestResponse> {
    // One signal at a time per user, so two opens a second apart never both start a session.
    const userId = currentUserId();
    const run = (this.chains.get(userId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.apply(p, arrivedAt, assumed));
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

  private async apply(p: ShortcutsPayload, arrivedAt: number, assumed: boolean): Promise<IngestResponse> {
    const parsed = p.at ? Date.parse(p.at) : Number.NaN;
    const at = Number.isFinite(parsed) ? parsed : arrivedAt;
    const writes: z.output<typeof EventInput>[] = [];

    if (p.action === "open") {
      const current = await this.lastOpen(at);
      // The same app opened twice keeps the first open (a duplicate automation run). Two unnamed
      // opens (or two assumed ones, all the default app) are one only within a minute: after that, most likely another open.
      if (
        current &&
        key(appOf(current)) === key(p.app) &&
        ((p.app !== "" && !assumed) || at - Date.parse(current.start_at) < UNKNOWN_DUPLICATE_MS)
      ) {
        return written(null);
      }
      // Another app in front means the one before was left, even if its close never came.
      if (current && at > Date.parse(current.start_at)) writes.push(ended(current, at));
      writes.push(usage(p.app, p.bundle_id, at, at + PROVISIONAL_MS, true, undefined, assumed));
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
