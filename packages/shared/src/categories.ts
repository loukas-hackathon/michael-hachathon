import type { AppCategory } from "./schemas";

// One place that says what an app or a site is. Pure data and pure functions, so the API, the
// collector and the web app all agree. The lists hold widely used products only. Anything not
// listed is "other": we never guess from a name.

const APPS: Record<Exclude<AppCategory, "other">, string[]> = {
  work: [
    // editors and IDEs
    "com.microsoft.VSCode",
    "com.microsoft.VSCodeInsiders",
    "com.vscodium",
    "com.todesktop.230313mzl4w4u92", // Cursor
    "com.exafunction.windsurf",
    "dev.zed.Zed",
    "com.sublimetext.3",
    "com.sublimetext.4",
    "com.apple.dt.Xcode",
    "com.apple.iphonesimulator",
    "org.vim.MacVim",
    "com.panic.Nova",
    // terminals
    "com.apple.Terminal",
    "com.googlecode.iterm2",
    "dev.warp.Warp-Stable",
    "com.mitchellh.ghostty",
    "net.kovidgoyal.kitty",
    "org.alacritty",
    "com.github.wez.wezterm",
    "co.zeit.hyper",
    // developer tools
    "com.github.GitHubClient",
    "com.torusknot.SourceTreeNotMAS",
    "com.fournova.Tower3",
    "com.postmanlabs.mac",
    "com.docker.docker",
    "com.tinyapp.TablePlus",
    "com.github.stormbreaker.prod", // GitHub on iPhone
    // documents and notes
    "com.microsoft.Word",
    "com.microsoft.Excel",
    "com.microsoft.Powerpoint",
    "com.microsoft.Office.Word",
    "com.microsoft.Office.Excel",
    "com.microsoft.Office.Powerpoint",
    "com.apple.iWork.Pages",
    "com.apple.iWork.Numbers",
    "com.apple.iWork.Keynote",
    "com.apple.Pages",
    "com.apple.Numbers",
    "com.apple.Keynote",
    "com.google.Docs",
    "com.google.Sheets",
    "com.google.Slides",
    "notion.id",
    "md.obsidian",
    "com.apple.Notes",
    "com.apple.mobilenotes",
    "com.evernote.Evernote",
    "net.shinyfrog.bear",
    "com.lukilabs.lukiapp", // Craft
    // planning
    "com.linear",
    "com.culturedcode.ThingsMac",
    "com.todoist.mac.Todoist",
    "com.atlassian.trello",
    // design and editing
    "com.figma.Desktop",
    "com.bohemiancoding.sketch3",
    "com.canva.CanvaDesktop",
    "com.apple.FinalCut",
    "com.apple.logic10",
    "com.blackmagic-design.DaVinciResolve",
    "com.blackmagic-design.DaVinciResolveLite",
    "com.seriflabs.affinitydesigner2",
    "com.seriflabs.affinityphoto2",
    "com.seriflabs.affinitypublisher2",
    "com.pixelmatorteam.pixelmator.x",
    "com.lemon.lvoverseas", // CapCut
    "org.blenderfoundation.blender",
  ],
  ai: [
    "com.anthropic.claudefordesktop",
    "com.anthropic.claude",
    "com.openai.chat",
    "com.openai.codex",
    "com.google.GeminiMacOS",
    "com.google.gemini",
    "ai.perplexity.mac",
    "ai.perplexity.app",
    "com.microsoft.copilot",
  ],
  communication: [
    "net.whatsapp.WhatsApp",
    "net.whatsapp.WhatsAppSMB",
    "com.apple.MobileSMS",
    "com.apple.iChat",
    "ru.keepcoder.Telegram",
    "ph.telegra.Telegraph",
    "org.telegram.desktop",
    "com.tinyspeck.slackmacgap",
    "com.tinyspeck.chatlyio",
    "com.hnc.Discord",
    "com.microsoft.teams",
    "com.microsoft.teams2",
    "com.microsoft.skype.teams",
    "com.skype.skype",
    "us.zoom.xos",
    "us.zoom.videomeetings",
    "com.google.meetings",
    "com.apple.mail",
    "com.apple.mobilemail",
    "com.microsoft.Outlook",
    "com.microsoft.Office.Outlook",
    "com.google.Gmail",
    "com.readdle.smartemail-Mac",
    "com.readdle.smartemail",
    "com.superhuman.electron",
    "com.facebook.Messenger",
    "com.facebook.archon",
    "com.viber",
    "com.viber.osx",
    "org.whispersystems.signal-desktop",
    "org.whispersystems.signal",
    "com.apple.FaceTime",
    "com.apple.facetime",
    "com.apple.mobilephone",
    "com.apple.InCallService",
  ],
  social: [
    "com.burbn.instagram",
    "com.zhiliaoapp.musically",
    "com.atebits.Tweetie2",
    "com.facebook.Facebook",
    "com.linkedin.LinkedIn",
    "com.reddit.Reddit",
    "com.toyopagroup.picaboo", // Snapchat
    "com.burbn.barcelona", // Threads
    "pinterest",
    "com.tumblr.tumblr",
    "xyz.blueskyweb.app",
    "org.joinmastodon.app",
    "AlexisBarreyat.BeReal",
  ],
  video: [
    "com.google.ios.youtube",
    "com.netflix.Netflix",
    "tv.twitch",
    "com.apple.TV",
    "com.apple.tv",
    "com.disney.disneyplus",
    "com.amazon.aiv.AIVApp",
    "org.videolan.vlc",
    "org.videolan.vlc-ios",
    "com.colliderli.iina",
    "com.apple.QuickTimePlayerX",
  ],
  news: ["com.apple.news", "com.nytimes.NYTimes", "uk.co.bbc.news", "com.flipboard.flipboard-ipad"],
  shopping: ["com.amazon.Amazon", "com.ebay.iphone", "com.etsy.etsyforios", "com.contextlogic.Wish"],
  travel: [
    "com.airbnb.app",
    "com.booking.BookingApp",
    "com.ubercab.UberClient",
    "com.tripadvisor.LocalPicks",
  ],
  music: [
    "com.spotify.client",
    "com.apple.Music",
    "com.apple.podcasts",
    "com.soundcloud.TouchApp",
    "com.google.ios.youtubemusic",
    "com.shazam.Shazam",
  ],
  system: [
    "com.apple.finder",
    "com.apple.systempreferences",
    "com.apple.Preferences",
    "com.apple.loginwindow",
    "com.apple.springboard",
    "com.apple.dock",
    "com.apple.Spotlight",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.ScreenSaver.Engine",
    "com.apple.ActivityMonitor",
    "com.apple.SecurityAgent",
    "com.apple.screencaptureui",
    "com.apple.Siri",
    "com.apple.siri",
    "com.apple.SoftwareUpdate",
    "com.apple.AppStore",
    "com.apple.launchpad.launcher",
    "com.apple.archiveutility",
    "com.apple.Console",
    "com.apple.DiskUtility",
    "com.apple.keychainaccess",
    "com.apple.Passwords",
    "com.apple.exposelauncher",
    "com.apple.UserNotificationCenter",
  ],
};

// Whole families whose every product sits in one category.
const APP_PREFIXES: [prefix: string, category: AppCategory][] = [
  ["com.jetbrains.", "work"],
  ["com.adobe.", "work"],
];

// A browser is a container: the page decides the category, so the browser itself is "other".
const BROWSERS = [
  "com.google.Chrome",
  "com.google.Chrome.canary",
  "com.google.chrome.ios",
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  "com.apple.mobilesafari",
  "company.thebrowser.Browser",
  "company.thebrowser.dia",
  "com.brave.Browser",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "org.mozilla.ios.Firefox",
  "com.operasoftware.Opera",
  "com.vivaldi.Vivaldi",
  "com.duckduckgo.macos.browser",
  "com.duckduckgo.mobile.ios",
  "app.zen-browser.zen",
  "com.openai.atlas",
  "ai.perplexity.comet",
];

const HOSTS: Record<Exclude<AppCategory, "other" | "system">, string[]> = {
  work: [
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "stackoverflow.com",
    "stackexchange.com",
    "docs.google.com",
    "drive.google.com",
    "calendar.google.com",
    "console.cloud.google.com",
    "notion.so",
    "figma.com",
    "linear.app",
    "atlassian.net",
    "atlassian.com",
    "trello.com",
    "asana.com",
    "airtable.com",
    "miro.com",
    "canva.com",
    "vercel.com",
    "supabase.com",
    "railway.com",
    "railway.app",
    "cloudflare.com",
    "aws.amazon.com",
    "npmjs.com",
    "developer.mozilla.org",
    "developer.apple.com",
    "overleaf.com",
    "office.com",
    "sharepoint.com",
    "localhost",
    "127.0.0.1",
  ],
  ai: [
    "claude.ai",
    "claude.com",
    "anthropic.com",
    "chatgpt.com",
    "chat.openai.com",
    "platform.openai.com",
    "gemini.google.com",
    "aistudio.google.com",
    "perplexity.ai",
    "copilot.microsoft.com",
  ],
  communication: [
    "mail.google.com",
    "meet.google.com",
    "web.whatsapp.com",
    "outlook.live.com",
    "outlook.office.com",
    "teams.microsoft.com",
    "slack.com",
    "discord.com",
    "web.telegram.org",
    "messenger.com",
    "zoom.us",
    "mail.proton.me",
    "mail.yahoo.com",
  ],
  social: [
    "instagram.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "tiktok.com",
    "linkedin.com",
    "reddit.com",
    "threads.net",
    "threads.com",
    "pinterest.com",
    "snapchat.com",
    "tumblr.com",
    "bsky.app",
  ],
  video: [
    "youtube.com",
    "youtu.be",
    "netflix.com",
    "twitch.tv",
    "vimeo.com",
    "disneyplus.com",
    "primevideo.com",
    "max.com",
    "dailymotion.com",
  ],
  news: [
    "news.google.com",
    "news.ycombinator.com",
    "bbc.com",
    "bbc.co.uk",
    "nytimes.com",
    "theguardian.com",
    "cnn.com",
    "reuters.com",
    "bloomberg.com",
    "ft.com",
    "economist.com",
    "techcrunch.com",
    "theverge.com",
    "kathimerini.gr",
    "protothema.gr",
    "naftemporiki.gr",
    "in.gr",
  ],
  shopping: [
    "amazon.com",
    "ebay.com",
    "aliexpress.com",
    "etsy.com",
    "temu.com",
    "shein.com",
    "ikea.com",
    "zalando.com",
    "skroutz.gr",
    "public.gr",
    "kotsovolos.gr",
    "plaisio.gr",
  ],
  travel: [
    "skyscanner.net",
    "skyscanner.com",
    "booking.com",
    "airbnb.com",
    "expedia.com",
    "kayak.com",
    "momondo.com",
    "tripadvisor.com",
    "trip.com",
    "hotels.com",
    "ryanair.com",
    "aegeanair.com",
    "ferryhopper.com",
  ],
  music: ["open.spotify.com", "music.youtube.com", "music.apple.com", "soundcloud.com"],
};

// Brands that use one name under many country endings (amazon.de, skyscanner.gr).
const HOST_BRANDS: Record<string, AppCategory> = {
  amazon: "shopping",
  ebay: "shopping",
  zalando: "shopping",
  ikea: "shopping",
  skyscanner: "travel",
  tripadvisor: "travel",
  expedia: "travel",
  kayak: "travel",
  airbnb: "travel",
};
const SECOND_LEVEL_ENDINGS = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);

const index = (lists: Record<string, string[]>) => {
  const map = new Map<string, AppCategory>();
  for (const [category, keys] of Object.entries(lists)) {
    for (const key of keys) map.set(key.toLowerCase(), category as AppCategory);
  }
  return map;
};
const APP_INDEX = index(APPS);
const HOST_INDEX = index(HOSTS);
const BROWSER_INDEX = new Set(BROWSERS.map((b) => b.toLowerCase()));

export function isBrowser(bundleId: string): boolean {
  return BROWSER_INDEX.has(bundleId.toLowerCase());
}

/** Category of an app by bundle id (Mac or iPhone). Unknown ids and browsers are "other". */
export function categoriseApp(bundleId: string): AppCategory {
  const id = bundleId.toLowerCase();
  const known = APP_INDEX.get(id);
  if (known) return known;
  for (const [prefix, category] of APP_PREFIXES) if (id.startsWith(prefix)) return category;
  return "other";
}

/** "www.Example.com:443" -> "example.com". Accepts a host or a full address, returns the host. */
export function normaliseHost(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#]/)[0] ?? "";
  host = host.split("@").pop() ?? "";
  if (!host.startsWith("[")) host = host.replace(/:\d+$/, "");
  return host.replace(/^www\./, "").replace(/\.$/, "");
}

/**
 * Category of a site by host. The longest listed ending wins ("music.youtube.com" is music,
 * "youtube.com" is video; "aws.amazon.com" is work, "amazon.com" is shopping). Unknown hosts are
 * "other".
 */
export function categoriseHost(input: string): AppCategory {
  const host = normaliseHost(input);
  if (!host) return "other";
  const labels = host.split(".");
  for (let i = 0; i < labels.length; i++) {
    const known = HOST_INDEX.get(labels.slice(i).join("."));
    if (known) return known;
  }
  // Country endings of a listed brand: the label just before the public ending.
  if (labels.length >= 2) {
    const last = labels.length - 1;
    const second = labels[last - 1] ?? "";
    const brand = labels.length >= 3 && SECOND_LEVEL_ENDINGS.has(second) ? labels[last - 2] : second;
    const known = brand ? HOST_BRANDS[brand] : undefined;
    if (known) return known;
  }
  return "other";
}
