import "server-only";
import {
  AgentClient,
  type Integration,
  IntegrationsResponse,
  LocationStatus,
  PlacesResponse,
  PushConfig,
  SourcesStatusResponse,
  TelegramStatus,
} from "@michael/shared";
import { get } from "./api";
import { CONNECTIONS, type Connection, type ConnectionId } from "./connections";
import { formatTime } from "./format";
import { saidNoMac } from "./no-mac";

// Real status for every connection on You. Always asks the API (also with USE_MOCKS): a status we
// cannot read says so, it is never made up. Each call fails on its own, so one outage costs one row.

// on: connected and sending. paused: connected, but its privacy switch is off. none: not set up yet.
// optional: not set up, and not needed (the Mac for someone who said they have none, or whose
// iPhone already sends without one). Never the next step, never counted as missing.
// soon: not proven on production yet (#295), shown as Coming soon with nothing to tap.
export type ConnectionState =
  | "on"
  | "paused"
  | "none"
  | "optional"
  | "attention"
  | "unavailable"
  | "unknown"
  | "soon";

export type ConnectionAction =
  | { kind: "link"; label: string; href: string; external?: boolean }
  | { kind: "sync-calendar"; label: string }
  | { kind: "none" };

export type ConnectionStatus = Connection & {
  state: ConnectionState;
  line: string;
  action: ConnectionAction;
};

export type ConnectionsView = {
  rows: ConnectionStatus[];
  /** How many are live (proven on production): the summary counts out of these, not the soon ones. */
  live: number;
  connected: number;
  /** Connections that count: live ones, minus the optional ones. */
  total: number;
  /** The first connection still to set up, in the order of the list. */
  next: ConnectionStatus | null;
  sources: SourcesStatusResponse | null;
};

const GOOGLE_CONNECT = "/integrations/google/connect";

const safe = async <T>(path: string, schema: { parse: (v: unknown) => T }): Promise<T | null> => {
  try {
    return schema.parse(await get<unknown>(path));
  } catch {
    return null;
  }
};

/** "just now", "12 min ago", "3h ago", "yesterday", "4 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listPhrase(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

type Inputs = {
  sources: SourcesStatusResponse | null;
  calendar: Integration | null | undefined; // undefined: could not read
  push: PushConfig | null;
  telegram: TelegramStatus | null;
  agents: AgentClient[] | null;
  places: PlacesResponse | null;
  location?: LocationStatus | null;
  /** The person said "I don't use a Mac" (lib/no-mac.ts). */
  noMac?: boolean;
};

/** Live iPhone data, from the Shortcuts automation (Screen Time history needs a Mac). */
const iphoneSends = (src: SourcesStatusResponse | null) =>
  Boolean(src?.sources.some((s) => s.source === "ios_shortcuts" && s.last_event_at));

const unknown = (c: Connection): ConnectionStatus => ({
  ...c,
  state: "unknown",
  line: "I could not check this right now.",
  action: { kind: "link", label: "Manage", href: c.href },
});

export const SOON_LINE = "Coming soon. I will tell you when it is ready.";

/** A device source that has sent nothing for this long needs attention (#307). */
export const QUIET_MS = 24 * 60 * 60_000;

/** The exact fix when a device source has gone quiet: one line, the one thing to do. */
export const QUIET_FIX: Record<"apple-watch" | "mac" | "iphone", string> = {
  "apple-watch": "Open Health Auto Export and tap Export Now on Michael health.",
  mac: "Wake your Mac and open Michael there, or set it up again below.",
  iphone: "Open an app you picked. If nothing arrives, check its automation in Shortcuts.",
};

/** Pure: the row for one connection from what the API said. Exported for tests. */
export function statusFor(c: Connection, x: Inputs, now = Date.now()): ConnectionStatus {
  if (!c.live) return { ...c, state: "soon", line: SOON_LINE, action: { kind: "none" } };
  const manage = { kind: "link" as const, label: "Manage", href: c.href };
  const setUp = (label = "Connect") => ({ kind: "link" as const, label, href: c.href });
  const src = x.sources;
  const sourceRows = src ? src.sources.filter((s) => c.sources.includes(s.source)) : [];
  // Paused by the user's own switch (off the record is said separately).
  const switchedOff = !src?.off_the_record && sourceRows.length > 0 && sourceRows.every((s) => !s.collecting);
  const last = sourceRows
    .map((s) => s.last_event_at)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1);
  const otr = src?.off_the_record ? "Off the record. " : "";

  switch (c.id) {
    case "google-calendar": {
      const cal = x.calendar;
      if (cal === undefined) return unknown(c);
      if (cal?.status === "connected") {
        if (switchedOff && last)
          return { ...c, state: "paused", line: "Switched off. I am not reading it.", action: manage };
        const who = cal.account ? `Connected as ${cal.account}` : "Connected";
        const sync = cal.last_sync_at ? `. Synced ${ago(cal.last_sync_at, now)}` : "";
        return cal.error
          ? {
              ...c,
              state: "attention",
              line: `${who}. Last sync failed.`,
              action: manage,
            }
          : { ...c, state: "on", line: `${otr}${who}${sync}.`, action: manage };
      }
      const connect = { kind: "link" as const, label: "Connect", href: GOOGLE_CONNECT, external: true };
      if (cal?.status === "error")
        return {
          ...c,
          state: "attention",
          line: cal.error ?? "I lost access. Connect again.",
          action: connect,
        };
      return { ...c, state: "none", line: "Not connected", action: connect };
    }
    case "apple-watch":
    case "mac":
    case "iphone": {
      if (!src) return unknown(c);
      if (last && switchedOff)
        return { ...c, state: "paused", line: `Switched off. Last data ${ago(last, now)}.`, action: manage };
      if (last && !otr && now - Date.parse(last) > QUIET_MS)
        return {
          ...c,
          state: "attention",
          line: `Last data ${ago(last, now)}. ${QUIET_FIX[c.id]}`,
          action: manage,
        };
      if (last) return { ...c, state: "on", line: `${otr}Last data ${ago(last, now)}.`, action: manage };
      if (c.id === "mac" && (x.noMac || iphoneSends(src)))
        return {
          ...c,
          state: "optional",
          line: "Optional. Everything else works without a Mac.",
          action: setUp(),
        };
      return {
        ...c,
        state: "none",
        line: "Not connected",
        action: setUp(),
      };
    }
    case "claude": {
      if (!x.agents) return unknown(c);
      const mine = x.agents.filter((a) => /claude/i.test(a.name));
      const approved = mine.find((a) => a.status === "approved");
      if (approved) {
        const line = approved.last_seen_at
          ? `Connected. Last asked at ${formatTime(approved.last_seen_at)}.`
          : "Connected.";
        return { ...c, state: "on", line, action: { kind: "link", label: "Manage", href: "/agents" } };
      }
      if (mine.some((a) => a.status === "pending"))
        return {
          ...c,
          state: "attention",
          line: "Waiting for your approval.",
          action: { kind: "link", label: "Manage", href: "/agents" },
        };
      return { ...c, state: "none", line: "Not connected", action: setUp() };
    }
    case "nudges": {
      const p = x.push;
      if (!p) return unknown(c);
      if (!p.enabled)
        return {
          ...c,
          state: "unavailable",
          line: "Not ready on our side yet.",
          action: manage,
        };
      if (p.devices > 0)
        return { ...c, state: "on", line: `On for ${plural(p.devices, "device")}.`, action: manage };
      return { ...c, state: "none", line: "Not connected", action: setUp() };
    }
    case "telegram": {
      const t = x.telegram;
      if (!t) return unknown(c);
      if (!t.enabled)
        return {
          ...c,
          state: "unavailable",
          line: "Not ready on our side yet. Push still works.",
          action: manage,
        };
      if (t.connected)
        return {
          ...c,
          state: "on",
          line: t.username ? `Connected as @${t.username}.` : "Connected.",
          action: manage,
        };
      return {
        ...c,
        state: "none",
        line: "Not connected",
        action: { kind: "link", label: "Connect", href: "/integrations/telegram/connect", external: true },
      };
    }
    case "travel": {
      const p = x.places;
      // Connected once a location signal (Mac Wi-Fi or this phone) arrived in the last day (#267).
      const loc = x.location;
      const fresh = loc?.last_signal_at && now - Date.parse(loc.last_signal_at) < 24 * 3600_000;
      if (fresh && loc?.collecting) {
        const where = loc.now ? `At ${loc.now.label} since ${formatTime(loc.now.since)}.` : "";
        return {
          ...c,
          state: "on",
          line: `${otr}${where || `Last seen ${ago(loc.last_signal_at as string, now)}.`}`,
          action: manage,
        };
      }
      if (!p) return unknown(c);
      const names = listPhrase(p.places.map((pl) => pl.label));
      if (p.places.length && !p.travel_enabled)
        return { ...c, state: "paused", line: "Switched off. I am not checking traffic.", action: manage };
      if (p.places.length)
        return {
          ...c,
          state: p.maps_available ? "on" : "unavailable",
          line: p.maps_available
            ? `${names} saved.`
            : `${names} saved. Traffic is not ready on our side yet.`,
          action: manage,
        };
      return { ...c, state: "none", line: "Not connected", action: setUp() };
    }
  }
}

/**
 * `preview`: one Coming soon connection shown as if live, for its setup page with ?preview=1, so a
 * person can prove it end to end on production before CONNECTOR_STATUS switches it on (#306).
 */
export async function getConnections(preview?: ConnectionId): Promise<ConnectionsView> {
  const [sources, integrations, push, agents, places, telegram, noMac, location] = await Promise.all([
    safe("/v1/sources/status", SourcesStatusResponse),
    safe("/v1/integrations", IntegrationsResponse),
    safe("/v1/push", PushConfig),
    safe("/v1/agents", {
      parse: (v) => ((v as { agents?: unknown[] }).agents ?? []).map((a) => AgentClient.parse(a)),
    }),
    safe("/v1/places", PlacesResponse),
    safe("/v1/telegram", TelegramStatus),
    saidNoMac(),
    safe("/v1/location", LocationStatus),
  ]);
  const inputs: Inputs = {
    sources,
    calendar: integrations
      ? (integrations.integrations.find((i) => i.provider === "google_calendar") ?? null)
      : undefined,
    push,
    telegram,
    agents,
    places,
    noMac,
    location,
  };
  const rows = CONNECTIONS.map((c) => statusFor(c.id === preview ? { ...c, live: true } : c, inputs));
  return {
    rows,
    live: rows.filter((r) => r.live).length,
    connected: rows.filter((r) => r.state === "on").length,
    total: rows.filter((r) => r.live && r.state !== "optional").length,
    next: rows.find((r) => r.state === "none") ?? null,
    sources,
  };
}

/** One connection's status, for its setup page. */
export async function getConnection(
  id: ConnectionId,
  { preview = false }: { preview?: boolean } = {},
): Promise<{ row: ConnectionStatus; view: ConnectionsView }> {
  const view = await getConnections(preview ? id : undefined);
  return { row: view.rows.find((r) => r.id === id) as ConnectionStatus, view };
}
