import type { Source } from "@michael/shared";
// The zod free entry: this map is imported by client components too.
import { type ConnectorId, isLive } from "@michael/shared/connectors";

// One word for everything the user plugs into Michael: a Connection. Not "sources", "devices" or
// "integrations" in copy. This file is the single map of connections and their routes, so Today's
// Get started checklist and the You hub link to the same places. Pure data: safe on server and client.

// The ids and whether each is proven on production live in @michael/shared (CONNECTOR_STATUS, #295).
export type ConnectionId = ConnectorId;

export type Connection = {
  id: ConnectionId;
  /** Plain name, as the row and the setup page title show it. */
  name: string;
  /** One line: what Michael gets from it. */
  what: string;
  /** The setup and manage page. */
  href: string;
  /** The privacy switches this connection owns (one place per source). */
  sources: Source[];
  /** Proven end to end on production. False: a calm "Coming soon", nothing to tap (#295). */
  live: boolean;
};

export const CONNECTIONS_HREF = "/you#connections";

const LIST: Omit<Connection, "live">[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    what: "Your plan for the day. I only move your own blocks.",
    href: "/you/connections/google-calendar",
    sources: ["google_calendar"],
  },
  {
    id: "apple-watch",
    name: "Apple Watch",
    what: "Sleep, workouts and heart rate, through Health Auto Export.",
    href: "/you/connections/apple-watch",
    sources: ["health_auto_export"],
  },
  {
    id: "mac",
    name: "Mac",
    what: "App time, Chrome and Claude Code, sent from your Mac.",
    href: "/you/connections/mac",
    sources: ["macos_usage", "chrome", "claude_code"],
  },
  {
    id: "windows",
    name: "Windows PC",
    what: "App time from your Windows PC, through ActivityWatch.",
    href: "/you/connections/windows",
    sources: ["activitywatch"],
  },
  {
    id: "iphone",
    name: "iPhone",
    what: "Which apps you open, and for how long.",
    href: "/you/connections/iphone",
    sources: ["iphone_usage", "ios_shortcuts"],
  },
  {
    id: "claude",
    name: "Claude",
    what: "Claude reads your day and adds to it, with your approval.",
    href: "/you/connections/claude",
    sources: [],
  },
  {
    id: "nudges",
    name: "Nudges",
    what: "At most five a day, never in quiet hours. Your watch buzzes too.",
    href: "/you/connections/nudges",
    sources: [],
  },
  {
    id: "telegram",
    name: "Telegram",
    what: "Nudges in a chat too, if push is not enough.",
    href: "/you/connections/telegram",
    sources: [],
  },
  {
    id: "travel",
    name: "Location",
    what: "Where you are on the timeline, and when to leave.",
    href: "/you/connections/travel",
    sources: ["maps", "location"],
  },
];

export const CONNECTIONS: readonly Connection[] = LIST.map((c) => ({ ...c, live: isLive(c.id) }));

/** Route per connection, for links from anywhere in the app (Today's checklist imports this). */
export const CONNECTION_ROUTES = Object.fromEntries(CONNECTIONS.map((c) => [c.id, c.href])) as Record<
  ConnectionId,
  string
>;

export function connection(id: ConnectionId): Connection {
  return CONNECTIONS.find((c) => c.id === id) as Connection;
}

/** What each source is called on the user's side, for the switches on the setup pages. */
export const SOURCE_LABEL: Partial<Record<Source, [name: string, what: string]>> = {
  google_calendar: ["Google Calendar", "Your plans and meetings"],
  health_auto_export: ["Apple Watch", "Sleep, workouts and heart rate"],
  macos_usage: ["Mac apps", "Which apps you use, and for how long"],
  chrome: ["Chrome", "Sites you spend time on, never what you type"],
  claude_code: ["Claude Code", "Work sessions and prompt titles"],
  activitywatch: ["Windows apps", "Which apps you use, from ActivityWatch. Never window titles"],
  iphone_usage: ["Screen Time", "iPhone apps by the day, synced through your Mac"],
  ios_shortcuts: ["Shortcuts", "Live app opens from your iPhone"],
  maps: ["Travel times", "Traffic between your saved places and plans"],
  whoop: ["WHOOP", "Sleep, strain and recovery"],
  omi: ["Omi", "Meeting summaries you started"],
  owntracks: ["OwnTracks", "Where you are, while it is on"],
};
