// The zod free entry: the chat client imports this.
import { type ConnectorId, isLive } from "@michael/shared/connectors";

// "Connect my calendar" in chat gets the one tap button under Michael's answer (#307). Read from
// the person's own words, so it never depends on the model; only live connections (#295) get a
// button, and each goes where one tap connects it.

// The verb must come right before the name ("connect my calendar"), so "add a block to my
// calendar" stays a question for Michael.
const VERB = String.raw`\b(?:connect|reconnect|link|hook up|set up|setup|turn on|enable)\s+(?:(?:my|the|up|google|apple)\s+){0,2}`;

const NAMES: [ConnectorId, string][] = [
  ["google-calendar", String.raw`(?:calendar|gcal)\b`],
  ["telegram", String.raw`telegram\b`],
  ["claude", String.raw`claude\b`],
  ["nudges", String.raw`(?:nudges?|notifications?|push)\b`],
  ["apple-watch", String.raw`(?:watch|health)\b`],
  ["windows", String.raw`(?:windows|windows pc|pc)\b`],
  ["mac", String.raw`(?:mac|macbook|laptop)\b`],
  ["iphone", String.raw`(?:iphone|phone|screen time)\b`],
  ["travel", String.raw`(?:location|places|traffic|travel)\b`],
];
const PATTERNS = NAMES.map(([id, name]) => [id, new RegExp(VERB + name, "i")] as const);

/** The connection a message asks to connect, if it is live; otherwise null. */
export function connectIntent(text: string): ConnectorId | null {
  for (const [id, re] of PATTERNS) if (re.test(text)) return isLive(id) ? id : null;
  return null;
}

/** Where one tap connects it, and what the button says. */
export const CONNECT_TARGET: Record<ConnectorId, { label: string; href: string; external: boolean }> = {
  "google-calendar": {
    label: "Connect Google Calendar",
    href: `/integrations/google/connect?return_to=${encodeURIComponent("/chat")}`,
    external: true,
  },
  telegram: { label: "Connect Telegram", href: "/integrations/telegram/connect", external: true },
  claude: { label: "Connect Claude", href: "/you/connections/claude", external: false },
  nudges: { label: "Turn on nudges", href: "/you/connections/nudges", external: false },
  "apple-watch": { label: "Connect Apple Watch", href: "/you/connections/apple-watch", external: false },
  mac: { label: "Connect your Mac", href: "/you/connections/mac", external: false },
  windows: { label: "Connect your Windows PC", href: "/you/connections/windows", external: false },
  iphone: { label: "Connect your iPhone", href: "/you/connections/iphone", external: false },
  travel: { label: "Add your places", href: "/you/connections/travel", external: false },
};
