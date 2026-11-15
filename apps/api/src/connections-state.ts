import { DEVICE_QUIET_MS, deviceState, pickIphoneKey, type Source } from "@michael/shared";
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
const QUIET_MS = DEVICE_QUIET_MS;

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
  /**
   * The iPhone is connected (as its row on You says): the one line Michael gives about it, so an
   * answer that calls it "not connected" is replaced (15 Nov). Null when it is not connected.
   */
  iphone: string | null;
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
  // The rows' own rule (deviceState in @michael/shared), so Michael and You never disagree.
  const device = (
    name: string,
    sources: Source[],
    waiting?: string,
    key?: ReturnType<typeof pickIphoneKey>,
  ) => {
    const d = deviceState(latest(last, sources), key, now);
    if (d.kind === "sending") return `- ${name}: connected, last data ${at(d.at)}.${quiet}`;
    if (d.kind === "quiet") return `- ${name}: connected but quiet, last data ${at(d.at)}.${quiet}`;
    if (d.kind === "tested" && waiting) return otr ? `${waiting.replace(/ Say ".*"$/, "")}${quiet}` : waiting;
    return `- ${name}: not connected. Say "Connect your ${name} on You."`;
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
  const key = pickIphoneKey(tokens);
  const iphoneState = deviceState(latest(last, IPHONE_SOURCES), key, now);
  const tested = iphoneState.kind === "tested" ? at(iphoneState.at) : null;
  lines.push(
    device(
      "iPhone",
      IPHONE_SOURCES,
      `- iPhone: connected (shortcut test received ${tested}), no app opens yet. Say "Your iPhone is connected. I see opens once the App automation runs."`,
      key,
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
  const unnamed =
    !otr && lastPhone?.data?.app_unknown === true ? unnamedOpenLine(at(lastPhone.start_at)) : null;
  if (unnamed) {
    lines.push(
      `- iPhone app opens: the latest open is not named by the automation (shown as "An app"). Asked about an app open, say "${unnamed}"`,
    );
  }
  let iphone: string | null = null;
  if (!otr && iphoneState.at) {
    iphone =
      unnamed ??
      (iphoneState.kind === "tested"
        ? "Your iPhone is connected. I see opens once the App automation runs."
        : `Your iPhone is connected, last data ${at(iphoneState.at)}.`);
  }
  return { macLive, offTheRecord: answer, lines, iphone };
}

/** What Michael says when the latest iPhone open came without an app name. */
export const unnamedOpenLine = (clock: string) =>
  `An app opened at ${clock}. Name the app in your automation and I'll say which.`;

/** An answer that calls the iPhone not connected, or says it cannot see phone apps at all. */
export const deniesIphone = (answer: string) =>
  /iphone[^.]*\b(not|isn't|aren't)\b[^.]*connected|can't see which apps/i.test(answer);
