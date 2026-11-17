import type { AppCategory } from "./schemas";

// One place that says what an app or a site is. Pure data and pure functions, so the API, the
// collector and the web app all agree. The lists hold widely used products only. Anything not
// listed is "other": we never guess from a name.

const APPS: Record<Exclude<AppCategory, "other">, string[]> = {
  work: [
    // editors and IDEs
    "com.microsoft.VSCode",
    "com.microsoft.VSCodeInsiders",
    "com.microsoft.visual-studio",
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
    "com.microsoft.WindowsTerminal",
    "com.microsoft.powershell",
    "com.microsoft.cmd",
    // developer tools
    "com.github.GitHubClient",
    "com.torusknot.SourceTreeNotMAS",
    "com.fournova.Tower3",
    "com.postmanlabs.mac",
    "com.docker.docker",
    "com.tinyapp.TablePlus",
    "at.eggerapps.Postico",
    "org.jkiss.dbeaver.core.product",
    "com.google.android.studio",
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
    "com.microsoft.explorer",
    "com.microsoft.taskmgr",
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
  // The iPhone's own surfaces: home screen, lock screen, app switcher.
  ["com.apple.springboard", "system"],
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
    "notion.site",
    "notion.com",
    "sheets.google.com",
    "slides.google.com",
    "dropbox.com",
    "onedrive.live.com",
    "coda.io",
    "evernote.com",
    "pypi.org",
    "crates.io",
    "docker.com",
    "netlify.com",
    "portal.azure.com",
    "sentry.io",
    "codepen.io",
    "codesandbox.io",
    "replit.com",
    "developer.chrome.com",
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
    "openai.com",
    "notebooklm.google.com",
    "mistral.ai",
    "grok.com",
    "deepseek.com",
    "poe.com",
    "huggingface.co",
    "openrouter.ai",
    "midjourney.com",
    "elevenlabs.io",
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
    "outlook.office365.com",
    "fastmail.com",
    "mail.zoho.com",
    "hey.com",
    "whatsapp.com",
    "telegram.org",
    "messages.google.com",
    "chat.google.com",
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
    "mastodon.social",
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
    "hbomax.com",
    "hulu.com",
    "tv.apple.com",
    "crunchyroll.com",
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
    "apnews.com",
    "wsj.com",
    "washingtonpost.com",
    "politico.com",
    "politico.eu",
    "euronews.com",
    "aljazeera.com",
    "wired.com",
    "arstechnica.com",
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
    "alibaba.com",
    "asos.com",
    "zara.com",
    "hm.com",
    "nike.com",
    "vinted.com",
    "walmart.com",
    "bestbuy.com",
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
    "agoda.com",
    "omio.com",
    "rome2rio.com",
    "thetrainline.com",
    "trainline.com",
    "trivago.com",
    "easyjet.com",
    "wizzair.com",
    "lufthansa.com",
    "flights.google.com",
  ],
  music: ["open.spotify.com", "music.youtube.com", "music.apple.com", "soundcloud.com"],
};

// Brands that use one name under many country endings (amazon.de, skyscanner.gr).
const HOST_BRANDS: Record<string, AppCategory> = {
  amazon: "shopping",
  ebay: "shopping",
  zalando: "shopping",
  ikea: "shopping",
  vinted: "shopping",
  pinterest: "social",
  skyscanner: "travel",
  tripadvisor: "travel",
  expedia: "travel",
  kayak: "travel",
  airbnb: "travel",
};
const SECOND_LEVEL_ENDINGS = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);

const CATEGORY_NAMES = new Set<string>([...Object.keys(APPS), ...Object.keys(HOSTS), "other"]);

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
    const known = brand && Object.hasOwn(HOST_BRANDS, brand) ? HOST_BRANDS[brand] : undefined;
    if (known) return known;
  }
  return "other";
}

// The collector and the browser extension label well known sites with their own short names
// (apps/collector/src/site-categories.ts). This is how those names read in our vocabulary.
// "finance" and "search" say nothing about work or distraction, so they stay "other".
const SITE_LABELS: Record<string, AppCategory> = {
  travel: "travel",
  shopping: "shopping",
  social: "social",
  news: "news",
  video: "video",
  messaging: "communication",
  mail: "communication",
  dev: "work",
  docs: "work",
  ai: "ai",
  finance: "other",
  search: "other",
};

/**
 * Category of a web visit: the shared host list first; when the host is not on it, the label the
 * collector sent (`data.category`), if it is one we know. Anything else is "other".
 */
export function categoriseVisit(host: string, label?: unknown): AppCategory {
  const known = categoriseHost(host);
  if (known !== "other" || typeof label !== "string") return known;
  const key = label.toLowerCase();
  if (Object.hasOwn(SITE_LABELS, key)) return SITE_LABELS[key] ?? "other";
  return CATEGORY_NAMES.has(key) ? (key as AppCategory) : "other";
}

// Some sources name an app instead of giving its bundle id: ActivityWatch sends the Mac app's name
// ("Google Chrome", "Code"), an iPhone Shortcuts automation the name the person picked
// ("Instagram"). This is how those names read as bundle ids, lower case. Only names that say
// exactly one product are here; anything else stays unknown.
const APP_NAMES: Record<string, string> = {
  // editors, terminals and developer tools
  code: "com.microsoft.VSCode",
  "visual studio code": "com.microsoft.VSCode",
  "vs code": "com.microsoft.VSCode",
  "visual studio": "com.microsoft.visual-studio",
  cursor: "com.todesktop.230313mzl4w4u92",
  windsurf: "com.exafunction.windsurf",
  zed: "dev.zed.Zed",
  xcode: "com.apple.dt.Xcode",
  simulator: "com.apple.iphonesimulator",
  "sublime text": "com.sublimetext.4",
  nova: "com.panic.Nova",
  terminal: "com.apple.Terminal",
  iterm: "com.googlecode.iterm2",
  iterm2: "com.googlecode.iterm2",
  warp: "dev.warp.Warp-Stable",
  ghostty: "com.mitchellh.ghostty",
  kitty: "net.kovidgoyal.kitty",
  alacritty: "org.alacritty",
  "windows terminal": "com.microsoft.WindowsTerminal",
  powershell: "com.microsoft.powershell",
  "command prompt": "com.microsoft.cmd",
  wezterm: "com.github.wez.wezterm",
  "intellij idea": "com.jetbrains.intellij",
  pycharm: "com.jetbrains.pycharm",
  webstorm: "com.jetbrains.WebStorm",
  goland: "com.jetbrains.goland",
  "android studio": "com.google.android.studio",
  "github desktop": "com.github.GitHubClient",
  postman: "com.postmanlabs.mac",
  "docker desktop": "com.docker.docker",
  tableplus: "com.tinyapp.TablePlus",
  postico: "at.eggerapps.Postico",
  dbeaver: "org.jkiss.dbeaver.core.product",
  // documents, notes and planning
  "microsoft word": "com.microsoft.Word",
  word: "com.microsoft.Word",
  "microsoft excel": "com.microsoft.Excel",
  excel: "com.microsoft.Excel",
  "microsoft powerpoint": "com.microsoft.Powerpoint",
  powerpoint: "com.microsoft.Powerpoint",
  pages: "com.apple.iWork.Pages",
  numbers: "com.apple.iWork.Numbers",
  keynote: "com.apple.iWork.Keynote",
  "google docs": "com.google.Docs",
  "google sheets": "com.google.Sheets",
  "google slides": "com.google.Slides",
  notion: "notion.id",
  obsidian: "md.obsidian",
  notes: "com.apple.Notes",
  evernote: "com.evernote.Evernote",
  bear: "net.shinyfrog.bear",
  craft: "com.lukilabs.lukiapp",
  linear: "com.linear",
  things: "com.culturedcode.ThingsMac",
  "things 3": "com.culturedcode.ThingsMac",
  todoist: "com.todoist.mac.Todoist",
  trello: "com.atlassian.trello",
  figma: "com.figma.Desktop",
  sketch: "com.bohemiancoding.sketch3",
  canva: "com.canva.CanvaDesktop",
  "final cut pro": "com.apple.FinalCut",
  "logic pro": "com.apple.logic10",
  "davinci resolve": "com.blackmagic-design.DaVinciResolve",
  capcut: "com.lemon.lvoverseas",
  blender: "org.blenderfoundation.blender",
  // AI
  claude: "com.anthropic.claudefordesktop",
  chatgpt: "com.openai.chat",
  codex: "com.openai.codex",
  gemini: "com.google.gemini",
  perplexity: "ai.perplexity.mac",
  copilot: "com.microsoft.copilot",
  // communication
  whatsapp: "net.whatsapp.WhatsApp",
  "whatsapp business": "net.whatsapp.WhatsAppSMB",
  messages: "com.apple.MobileSMS",
  telegram: "ru.keepcoder.Telegram",
  slack: "com.tinyspeck.slackmacgap",
  discord: "com.hnc.Discord",
  "microsoft teams": "com.microsoft.teams2",
  teams: "com.microsoft.teams2",
  skype: "com.skype.skype",
  zoom: "us.zoom.xos",
  "zoom.us": "us.zoom.xos",
  "google meet": "com.google.meetings",
  mail: "com.apple.mail",
  outlook: "com.microsoft.Outlook",
  "microsoft outlook": "com.microsoft.Outlook",
  gmail: "com.google.Gmail",
  spark: "com.readdle.smartemail-Mac",
  superhuman: "com.superhuman.electron",
  messenger: "com.facebook.Messenger",
  viber: "com.viber.osx",
  signal: "org.whispersystems.signal-desktop",
  facetime: "com.apple.FaceTime",
  phone: "com.apple.mobilephone",
  "phone call": "com.apple.InCallService",
  // social
  instagram: "com.burbn.instagram",
  tiktok: "com.zhiliaoapp.musically",
  x: "com.atebits.Tweetie2",
  twitter: "com.atebits.Tweetie2",
  facebook: "com.facebook.Facebook",
  linkedin: "com.linkedin.LinkedIn",
  reddit: "com.reddit.Reddit",
  snapchat: "com.toyopagroup.picaboo",
  threads: "com.burbn.barcelona",
  pinterest: "pinterest",
  tumblr: "com.tumblr.tumblr",
  bluesky: "xyz.blueskyweb.app",
  mastodon: "org.joinmastodon.app",
  bereal: "AlexisBarreyat.BeReal",
  // video, news, shopping, travel, music
  youtube: "com.google.ios.youtube",
  netflix: "com.netflix.Netflix",
  twitch: "tv.twitch",
  tv: "com.apple.TV",
  "apple tv": "com.apple.TV",
  "disney+": "com.disney.disneyplus",
  "prime video": "com.amazon.aiv.AIVApp",
  vlc: "org.videolan.vlc",
  iina: "com.colliderli.iina",
  "quicktime player": "com.apple.QuickTimePlayerX",
  news: "com.apple.news",
  "apple news": "com.apple.news",
  amazon: "com.amazon.Amazon",
  ebay: "com.ebay.iphone",
  etsy: "com.etsy.etsyforios",
  airbnb: "com.airbnb.app",
  "booking.com": "com.booking.BookingApp",
  booking: "com.booking.BookingApp",
  uber: "com.ubercab.UberClient",
  spotify: "com.spotify.client",
  music: "com.apple.Music",
  "apple music": "com.apple.Music",
  podcasts: "com.apple.podcasts",
  shazam: "com.shazam.Shazam",
  "youtube music": "com.google.ios.youtubemusic",
  // browsers (containers: the page decides)
  "google chrome": "com.google.Chrome",
  chrome: "com.google.Chrome",
  safari: "com.apple.Safari",
  arc: "company.thebrowser.Browser",
  dia: "company.thebrowser.dia",
  "brave browser": "com.brave.Browser",
  brave: "com.brave.Browser",
  "microsoft edge": "com.microsoft.edgemac",
  firefox: "org.mozilla.firefox",
  opera: "com.operasoftware.Opera",
  vivaldi: "com.vivaldi.Vivaldi",
  "zen browser": "app.zen-browser.zen",
  // the system
  finder: "com.apple.finder",
  "system settings": "com.apple.systempreferences",
  "system preferences": "com.apple.systempreferences",
  settings: "com.apple.Preferences",
  loginwindow: "com.apple.loginwindow",
  dock: "com.apple.dock",
  spotlight: "com.apple.Spotlight",
  "activity monitor": "com.apple.ActivityMonitor",
  "file explorer": "com.microsoft.explorer",
  "task manager": "com.microsoft.taskmgr",
  "app store": "com.apple.AppStore",
};

/**
 * Bundle id of a well known app from its name ("Google Chrome", "Code.app", "Instagram"), or null.
 * Case and a trailing ".app" (Mac) or ".exe" (Windows) do not matter. Unknown names are null: we never guess.
 */
export function bundleIdForAppName(name: string): string | null {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/\.(app|exe)$/, "");
  return Object.hasOwn(APP_NAMES, key) ? (APP_NAMES[key] ?? null) : null;
}

/** What a category does to a goal, wherever it shows up (score, patterns, timeline colours). */
export type CategoryRole = "work" | "distractor" | "neutral";

const WORK_CATEGORIES: ReadonlySet<AppCategory> = new Set(["work", "ai"]);
const DISTRACTING_CATEGORIES: ReadonlySet<AppCategory> = new Set([
  "communication",
  "social",
  "video",
  "news",
  "shopping",
  "travel",
]);

/**
 * work: work, ai. distractor: communication, social, video, news, shopping, travel. neutral:
 * music, the system and anything unknown (they neither make nor break focus).
 */
export const categoryRole = (category: AppCategory): CategoryRole =>
  WORK_CATEGORIES.has(category) ? "work" : DISTRACTING_CATEGORIES.has(category) ? "distractor" : "neutral";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

/**
 * THE categoriser for an event. A site (`data.host`) goes by `categoriseVisit`; an app by its
 * bundle id (`data.bundle_id`), else by its well known name (`data.app`, else the title of an
 * `app_usage` event). Null when the event is neither an app nor a site.
 */
export function categoriseEvent(e: {
  type?: string;
  title?: string | null;
  data?: Record<string, unknown> | null;
}): AppCategory | null {
  const d = e.data ?? {};
  const host = text(d.host);
  if (host) return categoriseVisit(host, d.category);
  const bundle = text(d.bundle_id);
  if (bundle) return categoriseApp(bundle);
  const name = text(d.app) ?? (e.type === "app_usage" ? text(e.title) : null);
  if (name) {
    const id = bundleIdForAppName(name);
    return id ? categoriseApp(id) : "other";
  }
  return null;
}

/** The site lists themselves, for the browser extension's generated copy (apps/extension/lib/categories.js). */
export const SITE_LISTS: Readonly<Record<string, readonly string[]>> = HOSTS;
export const SITE_BRANDS: Readonly<Record<string, AppCategory>> = HOST_BRANDS;
