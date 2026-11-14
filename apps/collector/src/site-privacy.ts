// What browsing we refuse to collect, and the only part of an address we ever keep. Shared by the
// Chrome history reader and the browser extension. No imports, so it runs anywhere.
//
// Two rules:
//   1. We keep the host of a page, never the path or the query string.
//   2. A visit to an excluded host is dropped whole: no title, no search term, no trace.
//
// The built in list errs towards leaving things out. A wrongly excluded site costs one missing
// line on the timeline; a wrongly included one puts a bank or a clinic there.

/**
 * The bare host of a web address: lower case, no "www.", no port, path or query.
 * Returns null for anything that is not a normal web page (files, browser pages, extensions).
 */
export function hostFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return host || null;
}

// Hosts listed whole. Each entry also covers its subdomains.
const EXCLUDED_HOSTS = [
  // Sign in and account pages.
  "accounts.google.com",
  "myaccount.google.com",
  "passwords.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "account.microsoft.com",
  "appleid.apple.com",
  "account.apple.com",
  // Password managers.
  "pass.proton.me",
  "keepersecurity.com",
  "enpass.io",
  // Banks and money accounts whose names do not say so.
  "nbg.gr",
  "alpha.gr",
  "viva.com",
  "chase.com",
  "citi.com",
  "wellsfargo.com",
  "capitalone.com",
  "americanexpress.com",
  "natwest.com",
  "ubs.com",
  "sparkasse.de",
  // Health.
  "nhs.uk",
  "webmd.com",
  "drugs.com",
  "patient.info",
  "medlineplus.gov",
  "zocdoc.com",
  "betterhelp.com",
  "talkspace.com",
  "idika.gr",
  // Private networks and device names.
  "ts.net",
];

// Brand names that are private under any ending or subdomain ("paypal.com", "www.paypal.co.uk").
// Matched against each whole label of the host.
const EXCLUDED_LABELS = new Set([
  // Password managers.
  "1password",
  "bitwarden",
  "lastpass",
  "dashlane",
  "nordpass",
  "roboform",
  // Banks, wallets, brokers and exchanges.
  "paypal",
  "revolut",
  "wise",
  "n26",
  "monzo",
  "hsbc",
  "barclays",
  "santander",
  "bnpparibas",
  "unicredit",
  "raiffeisen",
  "bbva",
  "ing",
  "schwab",
  "fidelity",
  "vanguard",
  "etoro",
  "trading212",
  "degiro",
  "interactivebrokers",
  "robinhood",
  "coinbase",
  "binance",
  "kraken",
  // Dating.
  "tinder",
  "bumble",
  "hinge",
  "grindr",
  // Adult.
  "onlyfans",
  "fansly",
  "xvideos",
  "xnxx",
  "xhamster",
  "chaturbate",
  "stripchat",
  "redtube",
  "brazzers",
]);

// Words that mark a host as private wherever they appear inside a label
// ("mybank.example", "cityclinic.example").
const EXCLUDED_WORDS = [
  "bank",
  "health",
  "clinic",
  "hospital",
  "pharma",
  "medic",
  "doctor",
  "therap",
  "iatr",
  "farmak",
  "porn",
  "xxx",
  "hentai",
  "nsfw",
];

// Endings that only exist on a local network.
const LOCAL_ENDINGS = ["localhost", "local", "internal", "lan", "home", "arpa", "test", "intranet", "corp"];

const PRIVATE_IPV4 =
  /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isLocalHost(host: string, labels: string[]): boolean {
  // A name with no dot ("router", "localhost") only resolves on a local network.
  if (labels.length === 1) return true;
  // Nobody types a public IPv6 address; a bracketed one is a device nearby.
  if (host.startsWith("[")) return true;
  if (IPV4.test(host)) return PRIVATE_IPV4.test(host);
  return LOCAL_ENDINGS.includes(labels[labels.length - 1] as string);
}

const matchesSuffix = (host: string, entry: string) => host === entry || host.endsWith(`.${entry}`);

/**
 * True when visits to this host must not be collected at all.
 * `host` comes from `hostFromUrl`. `extra` is the user's own list (see `parseExcludeList`).
 */
export function isExcludedHost(host: string, extra: readonly string[] = []): boolean {
  const labels = host.split(".");
  if (isLocalHost(host, labels)) return true;
  if (EXCLUDED_HOSTS.some((entry) => matchesSuffix(host, entry))) return true;
  if (extra.some((entry) => matchesSuffix(host, entry))) return true;
  // The last label is the ending (".health" is a real one), so words are checked there too.
  for (const label of labels) {
    if (EXCLUDED_LABELS.has(label)) return true;
    if (label === "sex" || label.startsWith("sex") || label.startsWith("adult")) return true;
    if (EXCLUDED_WORDS.some((word) => label.includes(word))) return true;
  }
  return false;
}

/**
 * Reads the user's own exclusion list: one host or ending per line ("example.com" also covers
 * "shop.example.com"). Blank lines and lines starting with "#" are ignored. A pasted address is
 * reduced to its host.
 */
export function parseExcludeList(text: string): string[] {
  const entries: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase();
    if (!line || line.startsWith("#")) continue;
    const entry = (line.includes("://") ? (hostFromUrl(line) ?? "") : (line.split(/[/\s?#]/)[0] as string))
      .replace(/^\*?\.+/, "")
      .replace(/^www\./, "")
      .replace(/\.+$/, "");
    if (entry) entries.push(entry);
  }
  return entries;
}
