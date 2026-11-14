// The Mac apps Michael may close during a focus guard (action `block_mac_app`). An allowlist, not a
// blocklist: only apps people lose focus to (chat, social, music and video, games) can ever be
// named, so a guard can never touch Finder, the Dock, System Settings, a terminal, an editor or
// Michael himself. The API refuses anything else; the collector checks again before it acts.

export interface BlockableMacApp {
  /** The name Michael uses ("WhatsApp"); also what the person types. */
  name: string;
  /** Mac bundle ids of this app (the App Store and direct download builds can differ). */
  bundle_ids: string[];
  /** Other names people use for it, lower case. */
  aliases?: string[];
}

export const BLOCKABLE_MAC_APPS: readonly BlockableMacApp[] = [
  { name: "WhatsApp", bundle_ids: ["net.whatsapp.WhatsApp", "desktop.WhatsApp"] },
  { name: "Telegram", bundle_ids: ["ru.keepcoder.Telegram", "org.telegram.desktop"] },
  { name: "Messages", bundle_ids: ["com.apple.MobileSMS"], aliases: ["imessage", "sms"] },
  { name: "Messenger", bundle_ids: ["com.facebook.archon", "com.facebook.Messenger"] },
  { name: "Signal", bundle_ids: ["org.whispersystems.signal-desktop"] },
  { name: "Viber", bundle_ids: ["com.viber.osx"] },
  { name: "Discord", bundle_ids: ["com.hnc.Discord"] },
  { name: "Slack", bundle_ids: ["com.tinyspeck.slackmacgap"] },
  { name: "Mail", bundle_ids: ["com.apple.mail"], aliases: ["apple mail"] },
  { name: "Instagram", bundle_ids: ["com.burbn.instagram"] },
  {
    name: "X",
    bundle_ids: ["com.atebits.Tweetie2", "maccatalyst.com.atebits.Tweetie2"],
    aliases: ["twitter"],
  },
  { name: "Reddit", bundle_ids: ["com.reddit.Reddit"] },
  { name: "TikTok", bundle_ids: ["com.zhiliaoapp.musically"] },
  { name: "Spotify", bundle_ids: ["com.spotify.client"] },
  { name: "Music", bundle_ids: ["com.apple.Music"], aliases: ["apple music"] },
  { name: "Podcasts", bundle_ids: ["com.apple.podcasts"] },
  { name: "TV", bundle_ids: ["com.apple.TV"], aliases: ["apple tv"] },
  { name: "Netflix", bundle_ids: ["com.netflix.Netflix"] },
  { name: "News", bundle_ids: ["com.apple.news"], aliases: ["apple news"] },
  { name: "Steam", bundle_ids: ["com.valvesoftware.steam"] },
];

// Never closed, whatever a guard says: the system, the tools that run Michael, and Michael.
// The allowlist already leaves them out; this is the floor under it.
const NEVER_BLOCK_PREFIXES = [
  "com.apple.finder",
  "com.apple.dock",
  "com.apple.systemuiserver",
  "com.apple.loginwindow",
  "com.apple.systempreferences",
  "com.apple.systemsettings",
  "com.apple.terminal",
  "com.apple.activitymonitor",
  "com.apple.controlcenter",
  "com.apple.notificationcenterui",
  "com.apple.securityagent",
  "com.googlecode.iterm2",
  "com.anthropic.",
  "app.michael",
];

const norm = (s: string) => s.trim().toLowerCase();

/** True for bundle ids Michael must never close (system, terminals, Claude, Michael). */
export function isNeverBlocked(bundleId: string): boolean {
  const id = norm(bundleId);
  return NEVER_BLOCK_PREFIXES.some((p) => id === p || id.startsWith(p.endsWith(".") ? p : `${p}.`));
}

/** The allowlisted app for a name, alias or bundle id (any case), or null when it is not blockable. */
export function findBlockableMacApp(nameOrBundleId: string): BlockableMacApp | null {
  const q = norm(nameOrBundleId);
  if (!q || isNeverBlocked(q)) return null;
  return (
    BLOCKABLE_MAC_APPS.find(
      (a) => norm(a.name) === q || a.aliases?.includes(q) || a.bundle_ids.some((id) => norm(id) === q),
    ) ?? null
  );
}

/** True when a running app with this bundle id may be closed by a guard. */
export function isBlockableBundleId(bundleId: string): boolean {
  if (isNeverBlocked(bundleId)) return false;
  const id = norm(bundleId);
  return BLOCKABLE_MAC_APPS.some((a) => a.bundle_ids.some((b) => norm(b) === id));
}
