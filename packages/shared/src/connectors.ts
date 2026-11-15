// Which connections are proven end to end in production (#295). The demo must work perfectly, so
// anything not proven on production shows a calm "Coming soon" everywhere (Connections, You,
// onboarding, the Get started card, the setup pages): no button, no error path, nothing to tap.
// To switch one on, change its line to "live" and note the proof on the Build Hub findings.

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
  "apple-watch": "soon",
  // Mac collector: no real Mac has sent data to production yet.
  mac: "soon",
  // iPhone Shortcuts: keys made, no real app opens have arrived yet.
  iphone: "soon",
  // Places save, but travel times need Google Maps, which production does not have yet.
  travel: "soon",
};

export const isLive = (id: ConnectorId): boolean => CONNECTOR_STATUS[id] === "live";
