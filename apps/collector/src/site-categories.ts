// A short label for what a site is for. Shared by the Chrome history reader and the browser
// extension, so both give the same site the same label. No imports, so it runs anywhere.
//
// Chrome's own category column (`content_annotations.categories`) is not usable for this: it holds
// opaque Knowledge Graph ids with a confidence ("/m/<id>:<0 to 100>"), the names for those ids are
// not on the machine, and it describes the topic of a page rather than what the site is for.
//
// Keep this list small and honest. It names well known sites only. A site we do not know has no
// category; a later step can ask a model about the rest and cache the answer per host.

export const SITE_CATEGORIES = [
  "travel",
  "shopping",
  "social",
  "news",
  "video",
  "messaging",
  "mail",
  "dev",
  "ai",
  "docs",
  "finance",
  "search",
] as const;

export type SiteCategory = (typeof SITE_CATEGORIES)[number];

// Two kinds of entry:
//   "example.com"  the host and every subdomain of it
//   "example.*"    exactly example.<any ending> (example.com, example.co.uk), no subdomains
// The most specific entry wins, so "mail.google.com" is mail while "google.*" is search.
const SITES: Record<SiteCategory, string[]> = {
  travel: [
    "booking.com",
    "airbnb.*",
    "skyscanner.*",
    "expedia.*",
    "tripadvisor.*",
    "kayak.*",
    "momondo.*",
    "hotels.com",
    "agoda.com",
    "trip.com",
    "omio.com",
    "rome2rio.com",
    "ferryhopper.com",
    "thetrainline.com",
    "ryanair.com",
    "easyjet.com",
    "wizzair.com",
    "aegeanair.com",
    "lufthansa.com",
  ],
  shopping: [
    "amazon.*",
    "ebay.*",
    "etsy.com",
    "aliexpress.com",
    "alibaba.com",
    "temu.com",
    "shein.com",
    "zalando.*",
    "asos.com",
    "zara.com",
    "hm.com",
    "nike.com",
    "ikea.com",
    "vinted.*",
    "walmart.com",
    "bestbuy.com",
    "skroutz.gr",
    "public.gr",
    "plaisio.gr",
    "kotsovolos.gr",
  ],
  social: [
    "facebook.com",
    "instagram.com",
    "x.com",
    "twitter.com",
    "tiktok.com",
    "linkedin.com",
    "reddit.com",
    "threads.net",
    "threads.com",
    "pinterest.*",
    "snapchat.com",
    "tumblr.com",
    "bsky.app",
    "mastodon.social",
  ],
  news: [
    "news.google.com",
    "news.ycombinator.com",
    "bbc.com",
    "bbc.co.uk",
    "cnn.com",
    "nytimes.com",
    "theguardian.com",
    "reuters.com",
    "apnews.com",
    "bloomberg.com",
    "ft.com",
    "wsj.com",
    "economist.com",
    "washingtonpost.com",
    "politico.com",
    "politico.eu",
    "euronews.com",
    "aljazeera.com",
    "techcrunch.com",
    "theverge.com",
    "wired.com",
    "arstechnica.com",
    "kathimerini.gr",
    "naftemporiki.gr",
    "protothema.gr",
    "in.gr",
  ],
  video: [
    "youtube.com",
    "youtu.be",
    "netflix.com",
    "twitch.tv",
    "vimeo.com",
    "dailymotion.com",
    "disneyplus.com",
    "primevideo.com",
    "hbomax.com",
    "max.com",
    "hulu.com",
    "tv.apple.com",
    "crunchyroll.com",
  ],
  messaging: [
    "whatsapp.com",
    "messenger.com",
    "telegram.org",
    "discord.com",
    "slack.com",
    "teams.microsoft.com",
    "messages.google.com",
    "chat.google.com",
  ],
  mail: [
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "mail.yahoo.com",
    "mail.proton.me",
    "fastmail.com",
    "mail.zoho.com",
    "hey.com",
  ],
  dev: [
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "stackoverflow.com",
    "stackexchange.com",
    "developer.mozilla.org",
    "developer.apple.com",
    "npmjs.com",
    "pypi.org",
    "crates.io",
    "docker.com",
    "vercel.com",
    "netlify.com",
    "railway.app",
    "railway.com",
    "supabase.com",
    "cloudflare.com",
    "aws.amazon.com",
    "console.cloud.google.com",
    "portal.azure.com",
    "sentry.io",
    "linear.app",
    "atlassian.net",
    "codepen.io",
    "codesandbox.io",
    "replit.com",
  ],
  ai: [
    "chatgpt.com",
    "openai.com",
    "claude.ai",
    "anthropic.com",
    "gemini.google.com",
    "aistudio.google.com",
    "notebooklm.google.com",
    "copilot.microsoft.com",
    "perplexity.ai",
    "mistral.ai",
    "grok.com",
    "deepseek.com",
    "poe.com",
    "huggingface.co",
    "openrouter.ai",
    "midjourney.com",
    "elevenlabs.io",
  ],
  docs: [
    "docs.google.com",
    "drive.google.com",
    "notion.so",
    "notion.site",
    "dropbox.com",
    "onedrive.live.com",
    "office.com",
    "sharepoint.com",
    "airtable.com",
    "coda.io",
    "evernote.com",
    "overleaf.com",
  ],
  finance: [
    "finance.yahoo.com",
    "tradingview.com",
    "investing.com",
    "marketwatch.com",
    "morningstar.com",
    "seekingalpha.com",
    "coinmarketcap.com",
    "coingecko.com",
    "stripe.com",
    "xero.com",
    "quickbooks.intuit.com",
  ],
  search: [
    "google.*",
    "bing.com",
    "duckduckgo.com",
    "search.yahoo.com",
    "search.brave.com",
    "ecosia.org",
    "startpage.com",
    "kagi.com",
    "yandex.*",
    "baidu.com",
  ],
};

const BY_ENTRY = new Map<string, SiteCategory>();
for (const category of SITE_CATEGORIES) {
  for (const entry of SITES[category]) BY_ENTRY.set(entry, category);
}

// A country ending is one label ("gr") or two short ones ("co.uk").
const isEnding = (labels: string[]) =>
  labels.length === 1 || (labels.length === 2 && labels.every((label) => label.length <= 3));

/**
 * The category of a host, or undefined when we do not know the site.
 * Pass the bare host, lower case, without "www." (see `hostFromUrl` in site-privacy.ts).
 */
export function siteCategory(host: string): SiteCategory | undefined {
  const labels = host.toLowerCase().split(".");
  if (labels.length >= 2 && isEnding(labels.slice(1))) {
    const exact = BY_ENTRY.get(host) ?? BY_ENTRY.get(`${labels[0]}.*`);
    if (exact) return exact;
  }
  // Walk up: "a.b.example.com", "b.example.com", "example.com".
  for (let i = 0; i < labels.length - 1; i++) {
    const found = BY_ENTRY.get(labels.slice(i).join("."));
    if (found) return found;
  }
  return undefined;
}
