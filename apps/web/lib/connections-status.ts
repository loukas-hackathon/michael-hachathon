import "server-only";
import {
  AgentClient,
  type Integration,
  IntegrationsResponse,
  PlacesResponse,
  PushConfig,
  SourcesStatusResponse,
  TelegramStatus,
} from "@michael/shared";
import { get } from "./api";
import { CONNECTIONS, type Connection, type ConnectionId } from "./connections";
import { devLatency } from "./dev-latency";
import { formatTime } from "./format";

// Real status for every connection on You. Always asks the API (also with USE_MOCKS): a status we
// cannot read says so, it is never made up. Each call fails on its own, so one outage costs one row.

// on: connected and sending. paused: connected, but its privacy switch is off. none: not set up yet.
export type ConnectionState = "on" | "paused" | "none" | "attention" | "unavailable" | "unknown";

export type ConnectionAction =
  | { kind: "link"; label: string; href: string; external?: boolean }
  | { kind: "sync-calendar"; label: string };

export type ConnectionStatus = Connection & {
  state: ConnectionState;
  line: string;
  action: ConnectionAction;
};

export type ConnectionsView = {
  rows: ConnectionStatus[];
  connected: number;
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
};

const unknown = (c: Connection): ConnectionStatus => ({
  ...c,
  state: "unknown",
  line: "I could not check this right now.",
  action: { kind: "link", label: "Manage", href: c.href },
});

/** Pure: the row for one connection from what the API said. Exported for tests. */
export function statusFor(c: Connection, x: Inputs, now = Date.now()): ConnectionStatus {
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
      if (last) return { ...c, state: "on", line: `${otr}Last data ${ago(last, now)}.`, action: manage };
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

export async function getConnections(): Promise<ConnectionsView> {
  await devLatency();
  const [sources, integrations, push, agents, places, telegram] = await Promise.all([
    safe("/v1/sources/status", SourcesStatusResponse),
    safe("/v1/integrations", IntegrationsResponse),
    safe("/v1/push", PushConfig),
    safe("/v1/agents", {
      parse: (v) => ((v as { agents?: unknown[] }).agents ?? []).map((a) => AgentClient.parse(a)),
    }),
    safe("/v1/places", PlacesResponse),
    safe("/v1/telegram", TelegramStatus),
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
  };
  const rows = CONNECTIONS.map((c) => statusFor(c, inputs));
  return {
    rows,
    connected: rows.filter((r) => r.state === "on").length,
    next: rows.find((r) => r.state === "none") ?? null,
    sources,
  };
}

/** One connection's status, for its setup page. */
export async function getConnection(
  id: ConnectionId,
): Promise<{ row: ConnectionStatus; view: ConnectionsView }> {
  const view = await getConnections();
  return { row: view.rows.find((r) => r.id === id) as ConnectionStatus, view };
}
