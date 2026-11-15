import { z } from "zod";
import type { MappedEvent } from "./common";

// iPhone Shortcuts personal automations ("App is opened" / "App is closed") -> `app_usage`.
// Each automation runs "Get Contents of URL" with a tiny JSON body (our own format, see
// docs/sources/ios-shortcuts.md):
//   { "app": "Instagram", "action": "open" | "close", "at"?: ISO 8601, "bundle_id"?: string }
// `at` defaults to the arrival time (Shortcuts posts within a second or two).
//
// An open is held until its close arrives, then the pair becomes one event with a duration.
// The iPhone has one app in front, so opening another app also closes the one held.
// Opens are held in memory: a restart in the middle of a session loses that one session, which
// is acceptable for a live signal (the Biome backfill in apps/collector covers history).

const SOURCE = "ios_shortcuts" as const;
// An open with no close after this long is a missed automation, not a session.
export const MAX_SESSION_MS = 2 * 3600_000;

export const ShortcutsPayload = z.object({
  app: z.string().trim().min(1).max(200),
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

interface Held {
  app: string;
  bundle_id?: string;
  at: number;
}

const key = (app: string) => app.toLowerCase();

function session(open: Held, end: number): MappedEvent | null {
  const seconds = Math.round((end - open.at) / 1000);
  if (seconds < 1 || end - open.at > MAX_SESSION_MS) return null;
  const start = new Date(open.at).toISOString();
  return {
    source: SOURCE,
    type: "app_usage",
    start_at: start,
    end_at: new Date(end).toISOString(),
    title: open.app,
    data: {
      app: open.app,
      device: "iphone",
      seconds,
      ...(open.bundle_id ? { bundle_id: open.bundle_id } : {}),
    },
    external_id: `sc:${key(open.app)}:${start.slice(0, 19)}`,
  };
}

/** Pairs opens and closes per user. One instance lives for the life of the API process. */
export class ShortcutsPairer {
  private held = new Map<string, Held>();

  handle(userId: string, p: ShortcutsPayload, arrivedAt: number): MappedEvent[] {
    const parsed = p.at ? Date.parse(p.at) : Number.NaN;
    const at = Number.isFinite(parsed) ? parsed : arrivedAt;
    const current = this.held.get(userId);
    const out: MappedEvent[] = [];

    if (p.action === "open") {
      // Another app in front means the held one was left, even if its close never came.
      if (current && key(current.app) !== key(p.app)) {
        const e = session(current, at);
        if (e) out.push(e);
      }
      // The same app opened twice keeps the first open (a duplicate automation run).
      if (!current || key(current.app) !== key(p.app) || at - current.at > MAX_SESSION_MS) {
        this.held.set(userId, { app: p.app, bundle_id: p.bundle_id, at });
      }
      return out;
    }

    if (current && key(current.app) === key(p.app)) {
      this.held.delete(userId);
      const e = session(current, at);
      if (e) out.push(e);
    }
    return out;
  }
}
