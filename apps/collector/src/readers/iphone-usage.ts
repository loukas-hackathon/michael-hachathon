import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EventInput } from "@michael/shared";
import { appName } from "../app-names";
import { decodeProto, isSegb2, protoDouble, protoInt, protoString, readSegb2 } from "../segb";
import { APPLE_EPOCH_OFFSET, appleSecondsToIso, openCopy } from "../sqlite";
import type { Reader } from "../types";

// When Screen Time has "Share Across Devices" on, the iPhone's app focus events sync to the Mac
// and land in Apple's Biome store, one folder per device. The Mac's copy runs up to about a day
// behind the phone, so this is history for patterns, not a live feed. Private format, so treat it
// as best effort.
const BIOME = join(homedir(), "Library/Biome");
const REMOTE_DIR = join(BIOME, "streams/restricted/App.InFocus/remote");
const SYNC_DB = join(BIOME, "sync/sync.db");

const NO_DATA = "No iPhone data on this Mac. Turn on Share Across Devices in Screen Time on both devices.";

// The sync can deliver late, so every run re-reads a generous window before the newest event it
// has seen for that device. Events are idempotent on external_id, so the overlap costs nothing.
const OVERLAP_SECONDS = 3 * 86_400;

// An app whose "lost focus" record never arrived is closed at the next event, but never later
// than this. Seen about once in three thousand intervals.
const MAX_UNCLOSED_SECONDS = 2 * 3600;

// Shorter than this is an app flashing past during a switch, not use. About one interval in eleven.
const MIN_SECONDS = 1;

export type Device = "iphone" | "watch";
export type OpenedFrom = "home_screen" | "app_switcher" | "notification" | "other";

/**
 * One App.InFocus record. Protobuf fields as observed on iOS 18 and later, watchOS and macOS 26:
 *
 *    1  string   transition reason, only on "gained focus" records and not on all of them
 *    2  varint   kind: 1 = an app, 3 = one of SpringBoard's own surfaces (see isSystemSurface)
 *    3  varint   1 = gained focus, 0 = lost focus
 *    4  double   event time, seconds since 2001-01-01 (equal to the SEGB trailer time)
 *    6  string   bundle id
 *    9  string   app version, 10 string app build (not read)
 *   11, 12 varint, only in the Mac's own stream; 13 varint, 1 in synced streams (not read)
 */
export type FocusEvent = {
  /** Seconds since 2001-01-01. */
  at: number;
  bundleId: string;
  starting: boolean;
  kind: number | undefined;
  reason: string | undefined;
};

export function decodeFocusEvent(payload: Buffer): FocusEvent | null {
  try {
    const message = decodeProto(payload);
    const at = protoDouble(message, 4);
    const bundleId = protoString(message, 6);
    const starting = protoInt(message, 3);
    if (at === undefined || !Number.isFinite(at) || !bundleId || starting === undefined) return null;
    return {
      at,
      bundleId,
      starting: starting === 1,
      kind: protoInt(message, 2),
      reason: protoString(message, 1) || undefined,
    };
  } catch {
    return null;
  }
}

// Bundle ids that take focus without being app use. They are left out of app_usage, but they
// still end whatever was in front, exactly like a real app would.
//
// - kind 3: SpringBoard's own surfaces (an open home screen folder, Today view, Control Centre,
//   StandBy). The plain home screen and the locked phone write no record at all: the app in front
//   simply loses focus and nothing gains it.
// - com.apple.carousel.*: the watch face, the watch's home screen and its launcher.
// - Apple's overlay services (names ending in Service, UIService, ShieldUI, Angel): SIM setup,
//   the screenshot editor, software update prompts, AirPods pairing cards, passcode sheets, alarm
//   alerts, the lock screen editor.
// Two overlays are kept because they are something the person does: the call screen
// (InCallService) and the Apple Pay sheet (PassbookUIService).
const SYSTEM_PREFIXES = ["com.apple.springboard", "com.apple.control-center", "com.apple.carousel"];
const SYSTEM_IDS = new Set(["com.apple.posterboard"]);
const KEPT_SERVICES = new Set(["com.apple.incallservice", "com.apple.passbookuiservice"]);

export function isSystemSurface(bundleId: string, kind?: number): boolean {
  if (kind === 3) return true;
  const id = bundleId.toLowerCase();
  if (KEPT_SERVICES.has(id)) return false;
  if (SYSTEM_IDS.has(id) || SYSTEM_PREFIXES.some((prefix) => id.startsWith(prefix))) return true;
  return id.startsWith("com.apple.") && /(service|shieldui|angel)$/.test(id);
}

// The transition reason is a comma separated trail of whatever SpringBoard did to bring the app
// forward, oldest first. Only records that gain focus carry one. Every token observed (iOS 18 and
// later, watchOS), with ids replaced by <...>:
//
//   com.apple.SpringBoard.transitionReason.homescreen          -> home_screen (icon tapped)
//   com.apple.SpringBoard.transitionReason.widget              -> home_screen (widget tapped)
//   com.apple.SpringBoard.transitionReason.appLibrarySearch    -> home_screen
//   iconTap (watch)                                            -> home_screen
//   com.apple.SpringBoard.transitionReason.appswitcher         -> app_switcher
//   com.apple.SpringBoard.transitionReason.systemgesture       -> app_switcher (swipe along the
//                                                                 home bar to the next app)
//   com.apple.SpringBoard.transitionReason.notification        -> notification
//   com.apple.SpringBoard.backlight.transitionReason.notification -> notification
//   com.apple.SpringBoard.transitionReason.externalrequest     -> other (another app, a link, Siri)
//   SBSourceApplication:<bundle id>                            -> other (comes with externalrequest)
//   com.apple.SpringBoard.transitionReason.controlcenter, .breadcrumb, .destroysceneaction -> other
//   com.apple.SpringBoard.backlight.transitionReason.prox, .fullScreenAlert, .liftToWake, .touch,
//     .lockButton, .acPowerChange, .bumpToWake                 -> other (the screen woke with the
//                                                                 app already in front)
//   com.apple.springboard.lock-screen.scroll, _SBDashBoardHostedAppEntityViewController,
//     SBDashBoardHostedAppViewController, CSCoverSheetViewController, CSPasscodeViewController,
//     CSActivityFullScreenViewController                       -> other (opened over the lock screen)
//   SBSceneLayoutWorkspaceTransaction:<uuid>, SBWorkspace, SBTransientOverlayPresentWorkspaceTransaction,
//     SBFullScreenSwitcherSceneLiveContentOverlay, SBInCallTransientOverlayViewController,
//     SBRemoteTransientOverlayViewController, SBAmbientTransientOverlayViewController,
//     SBPIPContainerViewController, BLSBacklight               -> other (plumbing, says nothing
//                                                                 about where the person came from)
//   backwardScroll, idle-navigation, crown tap, forceClock, Update alert layout (watch) -> other
//
// A trail can hold several SpringBoard reasons ("...systemgesture, ..., ...homescreen": swipe up,
// then tap an icon). The last one is what opened the app, except that a notification anywhere in
// the trail wins, because that is the signal the patterns care about most. No reason at all
// (mostly the same app coming back after the phone was locked) gives no opened_from.
const REASON_MAP: Record<string, OpenedFrom> = {
  homescreen: "home_screen",
  widget: "home_screen",
  applibrarysearch: "home_screen",
  appswitcher: "app_switcher",
  systemgesture: "app_switcher",
};

export function openedFrom(reason: string | undefined): OpenedFrom | undefined {
  if (!reason) return undefined;
  let result: OpenedFrom = "other";
  for (const raw of reason.split(",")) {
    const token = raw.trim().toLowerCase();
    if (token === "icontap") result = "home_screen";
    if (!token.includes(".transitionreason.")) continue;
    const name = token.split(".").pop() ?? "";
    if (name === "notification") return "notification";
    // Backlight reasons say why the screen lit, not where the person came from.
    if (!token.includes(".backlight.")) result = REASON_MAP[name] ?? "other";
  }
  return result;
}

export type Interval = {
  bundleId: string;
  start: number;
  end: number;
  kind: number | undefined;
  reason: string | undefined;
};

/**
 * Turns one device's focus events into intervals. The stream is single focus: one thing in front
 * at a time, and a gap between a "lost" and the next "gained" means home screen or locked phone.
 *
 * - Events are sorted by time first, because segment files can arrive out of order. Ties keep
 *   their file order, which matters when one app loses focus in the same instant the next gains it.
 * - Whatever is in front ends at the next event. If that event is its own "lost focus" the end is
 *   exact. If not (the record is missing, or the same app "gains" twice), the next event is the
 *   best boundary we have, capped at MAX_UNCLOSED_SECONDS.
 * - A "lost focus" with nothing in front (the start fell before the window) is ignored.
 * - The last "gained focus" has no end yet. It is left out and picked up by a later run, so an
 *   interval never gets posted with a guessed end.
 * System surfaces come back too; the caller drops them after they have done their job as boundaries.
 */
export function buildIntervals(events: FocusEvent[]): Interval[] {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const intervals: Interval[] = [];
  let open: FocusEvent | null = null;
  for (const event of sorted) {
    if (open) {
      const ownEnd = !event.starting && event.bundleId === open.bundleId;
      const end = ownEnd ? event.at : Math.min(event.at, open.at + MAX_UNCLOSED_SECONDS);
      intervals.push({ bundleId: open.bundleId, start: open.at, end, kind: open.kind, reason: open.reason });
      open = null;
    }
    if (event.starting) open = event;
  }
  return intervals;
}

/**
 * Which kind of device a folder belongs to. sync.db's DevicePeer.platform is 2 for iOS and 3 for a
 * Mac; that is all we could confirm, and a watch may have no row at all. So the events decide:
 * only a watch has Carousel (its SpringBoard), everything else counts as an iPhone. An iPad cannot
 * be told apart from an iPhone this way and is reported as "iphone" for now.
 */
export function deviceOf(events: FocusEvent[]): Device {
  return events.some((event) => event.bundleId.toLowerCase().startsWith("com.apple.carousel"))
    ? "watch"
    : "iphone";
}

const PLATFORM_MAC = 3;

type DeviceState = { platform: number | null; newest: number };
type Cursor = { devices: Record<string, DeviceState> };

function parseCursor(raw: string | null): Cursor {
  try {
    const parsed = JSON.parse(raw ?? "") as Cursor;
    if (parsed && typeof parsed.devices === "object" && parsed.devices !== null) return parsed;
  } catch {
    // First run, or a cursor from another version: start again. Re-reading is harmless.
  }
  return { devices: {} };
}

/** Segment files of one device, oldest first. Their names are creation times, so text order works. */
function segmentFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .map((name) => join(folder, name));
}

/** Every readable focus event in a device folder, without exact repeats. */
function readDevice(folder: string): { events: FocusEvent[]; skipped: number } {
  const events: FocusEvent[] = [];
  const seen = new Set<string>();
  // Later than a day from now is a damaged record, not a real event.
  const latest = Date.now() / 1000 - APPLE_EPOCH_OFFSET + 86_400;
  let skipped = 0;
  for (const path of segmentFiles(folder)) {
    const file = readFileSync(path);
    if (!isSegb2(file)) continue;
    const segment = readSegb2(file);
    skipped += segment.skipped;
    for (const record of segment.records) {
      const event = decodeFocusEvent(record.payload);
      if (!event || event.at <= 0 || event.at > latest) {
        skipped++;
        continue;
      }
      const key = `${event.at}|${event.bundleId}|${event.starting}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return { events, skipped };
}

/** device id (upper case) to DevicePeer.platform, or null if the database cannot be read. */
function readPlatforms(tmpDir: string, log: (message: string) => void): Map<string, number> | null {
  if (!existsSync(SYNC_DB)) return null;
  try {
    const db = openCopy(SYNC_DB, tmpDir);
    try {
      const rows = db
        .prepare("select device_identifier as id, platform from DevicePeer")
        .all() as unknown as {
        id: string | null;
        platform: number | null;
      }[];
      const platforms = new Map<string, number>();
      for (const row of rows) {
        if (row.id && typeof row.platform === "number")
          platforms.set(String(row.id).toUpperCase(), row.platform);
      }
      return platforms;
    } finally {
      db.close();
    }
  } catch (error) {
    log(
      `Could not read the device list, so every device counts as an iPhone or a watch: ${(error as Error).message}`,
    );
    return null;
  }
}

function listDeviceFolders(): string[] {
  try {
    return readdirSync(REMOTE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    if (code === "EPERM" || code === "EACCES") {
      throw new Error(
        `No permission to read ${REMOTE_DIR}. Give Full Disk Access to the app that runs the collector ` +
          "(System Settings, Privacy and Security, Full Disk Access), then run it again.",
      );
    }
    throw error;
  }
}

export const iphoneUsage: Reader = {
  name: "iphone-usage",
  source: "iphone_usage",
  describe:
    "iPhone app usage synced to this Mac by Screen Time, about a day behind (needs Full Disk Access and Share Across Devices)",
  platforms: ["darwin"],
  async read(ctx) {
    const folders = listDeviceFolders();
    if (folders.length === 0) {
      ctx.log(NO_DATA);
      return { events: [], cursor: ctx.cursor };
    }

    const previous = parseCursor(ctx.cursor);
    const next: Cursor = { devices: {} };
    // sync.db is large, so it is only copied when a device folder shows up that we have not seen.
    const platforms = folders.some((id) => !previous.devices[id]) ? readPlatforms(ctx.tmpDir, ctx.log) : null;

    const nowApple = Date.now() / 1000 - APPLE_EPOCH_OFFSET;
    const events: EventInput[] = [];
    const counts: Record<string, number> = {};
    let records = 0;
    let skipped = 0;
    let newestOverall = 0;

    for (const id of folders) {
      const known = previous.devices[id];
      const platform = known ? known.platform : (platforms?.get(id.toUpperCase()) ?? null);
      // Another Mac signed in to the same account: its own collector covers it.
      if (platform === PLATFORM_MAC) {
        next.devices[id] = { platform, newest: 0 };
        continue;
      }

      const device = readDevice(join(REMOTE_DIR, id));
      skipped += device.skipped;
      records += device.events.length;
      const newest = device.events.reduce((max, event) => Math.max(max, event.at), known?.newest ?? 0);
      next.devices[id] = { platform, newest };
      if (device.events.length === 0) continue;
      newestOverall = Math.max(newestOverall, newest);

      const kind = deviceOf(device.events);
      const since = known?.newest ? known.newest - OVERLAP_SECONDS : nowApple - ctx.backfillDays * 86_400;
      // A short tag instead of the whole device id: enough to keep two phones apart, and the full
      // identifier never leaves the Mac.
      const tag = id
        .replace(/[^0-9a-z]/gi, "")
        .slice(0, 8)
        .toLowerCase();

      for (const interval of buildIntervals(device.events.filter((event) => event.at > since))) {
        const length = interval.end - interval.start;
        if (length < MIN_SECONDS || isSystemSurface(interval.bundleId, interval.kind)) continue;
        const from = openedFrom(interval.reason);
        events.push({
          source: "iphone_usage",
          type: "app_usage",
          external_id: `biome:${tag}:${Math.round((interval.start + APPLE_EPOCH_OFFSET) * 1000)}:${interval.bundleId}`,
          start_at: appleSecondsToIso(interval.start),
          end_at: appleSecondsToIso(interval.end),
          title: appName(interval.bundleId),
          data: {
            bundle_id: interval.bundleId,
            device: kind,
            seconds: Math.round(length),
            ...(from ? { opened_from: from } : {}),
          },
        });
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }

    if (records === 0) {
      ctx.log(NO_DATA);
      return { events: [], cursor: JSON.stringify(next) };
    }

    events.sort((a, b) => a.start_at.localeCompare(b.start_at));
    const perDevice = Object.entries(counts)
      .map(([kind, count]) => `${count} ${kind}`)
      .join(", ");
    const hoursBehind = Math.round((nowApple - newestOverall) / 3600);
    ctx.log(
      `${records} focus records read (${skipped} deleted or unreadable), ${events.length} app intervals` +
        `${perDevice ? ` (${perDevice})` : ""}. Newest record is ${hoursBehind} hours old.`,
    );
    return { events, cursor: JSON.stringify(next) };
  },
};
