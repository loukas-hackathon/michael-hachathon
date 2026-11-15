import { SETUP_KEY_NAMES, type Source } from "@michael/shared";
import { MAC_FRESH_MS } from "./focus/session";
import { DEFAULT_TIMEZONE } from "./patterns";
import { Zone } from "./patterns/time";
import { store } from "./store";
import { listPersonalTokens } from "./tokens";

// What Michael knows about each connection, from the same data as the Connections rows on You
// (apps/web/lib/connections-status.ts reads /v1/sources/status, /v1/integrations and /v1/tokens):
// read fresh every chat turn, so he never offers a Mac action with no Mac, or calls a connected
// iPhone "not connected" (#483).

/** A device source with nothing for this long needs attention (the rows' QUIET_MS). */
const QUIET_MS = 24 * 3600_000;

const MAC_SOURCES: Source[] = ["macos_usage", "activitywatch"];
const WATCH_SOURCES: Source[] = ["health_auto_export"];
const IPHONE_SOURCES: Source[] = ["iphone_usage", "ios_shortcuts"];

/**
 * What Michael says to any question about the user's data while off the record (15 Nov: he
 * promised to see Instagram opens "once the App automation runs" while nothing was being kept).
 */
export function offTheRecordAnswer(sinceClock: string | null): string {
  const since = sinceClock ? ` since ${sinceClock}` : "";
  return `You're off the record${since}, so I'm not collecting anything. Turn it off on You > Privacy and I'll see your opens.`;
}

export interface ConnectionsNow {
  /** Mac data in the last 48 hours and on the record: a Mac app guard will be applied. */
  macLive: boolean;
  /** Off the record: the line Michael gives to any question about the user's data; null on the record. */
  offTheRecord: string | null;
  /** One line per connection for the chat context. */
  lines: string[];
}

const latest = (last: Partial<Record<Source, string>>, sources: Source[]) =>
  sources
    .map((s) => last[s])
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);

/** Mac app guards need a Mac that sent data in the last 48 hours, the rule Focus now uses. */
export async function macIsLive(now = Date.now()): Promise<boolean> {
  const [rules, last] = await Promise.all([store.privacyRules(), store.lastEventAtBySource()]);
  if (rules.offTheRecord) return false;
  const at = latest(last, MAC_SOURCES);
  return Boolean(at && now - Date.parse(at) <= MAC_FRESH_MS);
}

/** Every connection Michael can act through or read from, as it stands now. */
export async function connectionsNow(now = Date.now()): Promise<ConnectionsNow> {
  const zone = new Zone(DEFAULT_TIMEZONE);
  const at = (iso: string) => {
    const ms = Date.parse(iso);
    return zone.dayOf(ms) === zone.dayOf(now) ? zone.clock(ms) : `${zone.dayOf(ms)} ${zone.clock(ms)}`;
  };
  const [rules, last, calendar, tokens] = await Promise.all([
    store.privacyRules(),
    store.lastEventAtBySource(),
    store.getIntegration("google_calendar").catch(() => null),
    listPersonalTokens().catch(() => []),
  ]);
  const otr = rules.offTheRecord;
  const since = otr && rules.since ? at(rules.since) : null;
  const answer = otr ? offTheRecordAnswer(since) : null;
  // Off the record nothing arrives from any device, so no line promises data "once" something runs.
  const quiet = otr ? " Nothing arrives while off the record." : "";
  const device = (name: string, sources: Source[], waiting?: string) => {
    const t = latest(last, sources);
    if (t && now - Date.parse(t) <= QUIET_MS) return `- ${name}: connected, last data ${at(t)}.${quiet}`;
    if (t) return `- ${name}: connected but quiet, last data ${at(t)}.${quiet}`;
    if (otr && waiting) return `${waiting.replace(/ Say ".*"$/, "")}${quiet}`;
    return waiting ?? `- ${name}: not connected. Say "Connect your ${name} on You."`;
  };

  // First, so it frames every line below (#490 had it last, and the model missed it).
  const lines: string[] = answer
    ? [
        `- OFF THE RECORD${since ? ` since ${since}` : ""}: nothing is collected from any connection right now. To any question about their data, an app open or what you can see, answer first, word for word: "${answer}"`,
      ]
    : [];
  lines.push(
    calendar?.status === "connected"
      ? `- Google Calendar: connected${calendar.last_sync_at ? `, last sync ${at(calendar.last_sync_at)}` : ""}.`
      : '- Google Calendar: not connected. Say "Connect your calendar on You."',
  );
  lines.push(device("Apple Watch", WATCH_SOURCES));

  const macLive = !otr && (await macIsLive(now));
  lines.push(
    macLive
      ? `${device("Mac", MAC_SOURCES)} Closing Mac apps (block_mac_app) works.`
      : `${device("Mac", MAC_SOURCES)} Closing Mac apps is not available: never offer it. Offer a calendar block for the time instead.`,
  );

  // The iPhone shortcut's key was used (a hand run is the test, #466): connected before any open.
  const key = tokens
    .filter((t) => t.name === SETUP_KEY_NAMES.iphone)
    .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""))[0];
  lines.push(
    device(
      "iPhone",
      IPHONE_SOURCES,
      key?.last_used_at
        ? `- iPhone: connected (shortcut test received ${at(key.last_used_at)}), no app opens yet. Say "Your iPhone is connected. I see opens once the App automation runs."`
        : undefined,
    ),
  );
  // Opens the automation did not name (an App automation passes the shortcut no input): Michael
  // says when, and how to see which app.
  const phone = await store
    .listEvents({
      from: new Date(now - QUIET_MS).toISOString(),
      to: new Date(now).toISOString(),
      source: ["ios_shortcuts"],
      type: ["app_usage"],
    })
    .catch(() => []);
  const lastPhone = phone.sort((a, b) => a.start_at.localeCompare(b.start_at)).at(-1);
  if (lastPhone?.data?.app_unknown === true) {
    lines.push(
      `- iPhone app opens: the automation does not name the app (shown as "An app"). Say "An app opened at ${at(lastPhone.start_at)}; name the app in the automation to see which."`,
    );
  }
  return { macLive, offTheRecord: answer, lines };
}
