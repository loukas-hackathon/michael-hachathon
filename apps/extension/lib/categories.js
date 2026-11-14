// A small host to category map, so the timeline can say "travel during a work block" without the
// model ever seeing an address. apps/collector has its own map in TypeScript for the Chrome
// history reader. This folder has no build step and cannot import TypeScript, so the two are
// separate for now and should become one shared list later (see README).

const BY_CATEGORY = {
  travel: [
    "booking.com",
    "airbnb.com",
    "skyscanner.net",
    "skyscanner.com",
    "kayak.com",
    "expedia.com",
    "tripadvisor.com",
    "ryanair.com",
    "easyjet.com",
    "aegeanair.com",
    "trainline.com",
    "hotels.com",
    "trivago.com",
    "rome2rio.com",
    "flights.google.com",
  ],
  shopping: [
    "amazon.com",
    "amazon.co.uk",
    "amazon.de",
    "ebay.com",
    "etsy.com",
    "aliexpress.com",
    "temu.com",
    "zalando.com",
    "ikea.com",
    "skroutz.gr",
    "vinted.com",
    "asos.com",
    "shein.com",
  ],
  social: [
    "instagram.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "tiktok.com",
    "reddit.com",
    "linkedin.com",
    "threads.net",
    "threads.com",
    "pinterest.com",
    "bsky.app",
    "tumblr.com",
    "snapchat.com",
  ],
  news: [
    "bbc.com",
    "bbc.co.uk",
    "theguardian.com",
    "nytimes.com",
    "reuters.com",
    "apnews.com",
    "ft.com",
    "economist.com",
    "bloomberg.com",
    "kathimerini.gr",
    "news.ycombinator.com",
    "news.google.com",
    "techcrunch.com",
    "theverge.com",
    "cnn.com",
  ],
  video: [
    "youtube.com",
    "netflix.com",
    "twitch.tv",
    "vimeo.com",
    "disneyplus.com",
    "primevideo.com",
    "max.com",
    "dailymotion.com",
  ],
  messaging: [
    "web.whatsapp.com",
    "web.telegram.org",
    "messenger.com",
    "discord.com",
    "slack.com",
    "teams.microsoft.com",
    "meet.google.com",
    "zoom.us",
    "chat.google.com",
  ],
  mail: [
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "mail.proton.me",
    "mail.yahoo.com",
    "fastmail.com",
  ],
  dev: [
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "stackoverflow.com",
    "developer.mozilla.org",
    "developer.chrome.com",
    "npmjs.com",
    "vercel.com",
    "railway.com",
    "supabase.com",
    "cloudflare.com",
    "codepen.io",
  ],
  ai: [
    "claude.ai",
    "chatgpt.com",
    "chat.openai.com",
    "gemini.google.com",
    "perplexity.ai",
    "copilot.microsoft.com",
    "aistudio.google.com",
    "huggingface.co",
  ],
  docs: [
    "docs.google.com",
    "drive.google.com",
    "sheets.google.com",
    "slides.google.com",
    "notion.so",
    "notion.com",
    "figma.com",
    "miro.com",
    "dropbox.com",
    "airtable.com",
    "office.com",
    "canva.com",
  ],
  finance: [
    "finance.yahoo.com",
    "tradingview.com",
    "investing.com",
    "coinmarketcap.com",
    "marketwatch.com",
    "morningstar.com",
  ],
  search: ["google.com", "bing.com", "duckduckgo.com", "search.brave.com", "ecosia.org", "kagi.com"],
};

const CATEGORY_OF = new Map(
  Object.entries(BY_CATEGORY).flatMap(([category, hosts]) => hosts.map((host) => [host, category])),
);

/**
 * The category for a host, or undefined. The most specific entry wins: `mail.google.com` is mail,
 * `docs.google.com` is docs, any other `google.com` host is search.
 */
export function categoryFor(host) {
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const category = CATEGORY_OF.get(labels.slice(i).join("."));
    if (category) return category;
  }
  // Country versions of Google search (google.gr, google.co.uk).
  if (/^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return "search";
  return undefined;
}
