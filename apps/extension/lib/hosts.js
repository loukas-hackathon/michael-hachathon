// Which pages may be recorded. Everything here works on the host only: the full address is read
// once to take the host out of it and is never stored or sent.

/** The host of a web page, or null for anything that is not http(s) (chrome://, file:, about:). */
export function hostFromUrl(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return host || null;
}

/** True when `host` is `domain` or one of its subdomains. */
export const matchesDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/** `www.example.com` and `example.com` are one site in the popup and in the user's list. */
export const displayHost = (host) => host.replace(/^www\./, "");

const LOCAL_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "lan",
  "home",
  "corp",
  "home.arpa",
  "test",
  "onion",
];

function isPrivateIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** localhost, machines on the local network, private IPv4 ranges and every IPv6 literal. */
export function isPrivateHost(host) {
  if (host.startsWith("[")) return true;
  if (!host.includes(".")) return true;
  if (LOCAL_SUFFIXES.some((suffix) => matchesDomain(host, suffix))) return true;
  return isPrivateIpv4(host);
}

// Built in: never recorded, whatever the user's list says. The lists name the big ones; the word
// patterns catch the long tail (a local bank, a clinic's patient portal). They lean towards
// leaving a site out: a wrongly skipped site costs a few minutes of data, a wrongly recorded one
// costs trust.
const BANKING = [
  "paypal.com",
  "revolut.com",
  "wise.com",
  "n26.com",
  "monzo.com",
  "starlingbank.com",
  "chase.com",
  "wellsfargo.com",
  "citi.com",
  "hsbc.com",
  "hsbc.co.uk",
  "barclays.co.uk",
  "lloydsbank.com",
  "natwest.com",
  "santander.com",
  "santander.co.uk",
  "ing.com",
  "bnpparibas.com",
  "db.com",
  "commerzbank.de",
  "unicredit.it",
  "capitalone.com",
  "americanexpress.com",
  "nbg.gr",
  "alpha.gr",
  "eurobank.gr",
  "winbank.gr",
  "viva.com",
  "klarna.com",
  "stripe.com",
  "coinbase.com",
  "binance.com",
  "kraken.com",
];
const HEALTH = [
  "webmd.com",
  "mayoclinic.org",
  "nhs.uk",
  "healthline.com",
  "medlineplus.gov",
  "drugs.com",
  "betterhelp.com",
  "talkspace.com",
  "plannedparenthood.org",
  "zocdoc.com",
  "doctolib.fr",
  "doctolib.de",
  "doctoranytime.gr",
  "mychart.org",
  "mychart.com",
  "patient.info",
  "psychologytoday.com",
];
const ADULT = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "onlyfans.com",
  "chaturbate.com",
  "stripchat.com",
  "fansly.com",
  "spankbang.com",
];
const PASSWORD_MANAGERS = [
  "1password.com",
  "1password.eu",
  "1password.ca",
  "lastpass.com",
  "bitwarden.com",
  "bitwarden.eu",
  "dashlane.com",
  "keepersecurity.com",
  "keepersecurity.eu",
  "nordpass.com",
  "pass.proton.me",
  "passwords.google.com",
  "enpass.io",
  "roboform.com",
];
const BUILT_IN = [...BANKING, ...HEALTH, ...ADULT, ...PASSWORD_MANAGERS];
const BUILT_IN_WORDS =
  /bank|banque|banco|banca|sparkasse|creditunion|health|clinic|hospital|medical|pharmac|therap|patient|porn|xxx|hentai/;
const ADULT_SUFFIXES = ["xxx", "porn", "adult", "sex"];

export function isBuiltInExcluded(host) {
  if (BUILT_IN.some((domain) => matchesDomain(host, domain))) return true;
  if (ADULT_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`))) return true;
  return BUILT_IN_WORDS.test(host);
}

/**
 * Turns what the user typed into a bare host: `https://www.Example.com/page` and `*.example.com`
 * both become `example.com`. Returns null when it is not a usable site name.
 */
export function normaliseEntry(raw) {
  let text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = `http://${text.replace(/^\*\./, "")}`;
  let host;
  try {
    host = new URL(text).hostname;
  } catch {
    return null;
  }
  host = displayHost(host.replace(/^\*\./, "").replace(/\.$/, ""));
  return /^[a-z0-9[\]:.-]+$/.test(host) && host.length > 0 ? host : null;
}

/** An entry in the user's list covers that host and all its subdomains. */
export const isUserExcluded = (host, list) => (list ?? []).some((entry) => matchesDomain(host, entry));

export const isExcluded = (host, userList) =>
  isPrivateHost(host) || isBuiltInExcluded(host) || isUserExcluded(host, userList);
