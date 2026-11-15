// Which connections are offered (#295). Loukas decided (Sun 15 Nov) that every connection is shown and
// connectable: all eight rows with Connect, as before. "soon" remains available to hide one again
// (calm "Coming soon", no button), but nothing uses it today.

export type ConnectorId =
  | "google-calendar"
  | "apple-watch"
  | "mac"
  | "iphone"
  | "claude"
  | "nudges"
  | "telegram"
  | "travel";

export type ConnectorStatus = "live" | "soon";

export const CONNECTOR_STATUS: Record<ConnectorId, ConnectorStatus> = {
  // Two real accounts connected and syncing on production (Sat 14 Nov).
  "google-calendar": "live",
  // claude.ai connector over MCP OAuth.
  claude: "live",
  // Web push: VAPID set on production, nudges delivered to a real account (Sat 14 Nov 19:49 UTC).
  nudges: "live",
  // Bot set on production; real accounts linked their chat through the one tap link.
  telegram: "live",
  // Health Auto Export: a device key was made, but no real watch data has arrived yet.
  "apple-watch": "live",
  // Mac collector: no real Mac has sent data to production yet.
  mac: "live",
  // iPhone Shortcuts: keys made, no real app opens have arrived yet.
  iphone: "live",
  // Places save, but travel times need Google Maps, which production does not have yet.
  travel: "live",
};

export const isLive = (id: ConnectorId): boolean => CONNECTOR_STATUS[id] === "live";
