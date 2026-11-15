import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  bundleIdForAppName,
  categoriseApp,
  categoriseEvent,
  categoriseHost,
  categoriseVisit,
  categoryRole,
  isBrowser,
  normaliseHost,
  SITE_BRANDS,
  SITE_LISTS,
} from "@michael/shared";

test("apps: known bundle ids on the Mac and the iPhone", () => {
  assert.equal(categoriseApp("com.microsoft.VSCode"), "work");
  assert.equal(categoriseApp("com.apple.Terminal"), "work");
  assert.equal(categoriseApp("net.whatsapp.WhatsApp"), "communication");
  assert.equal(categoriseApp("com.burbn.instagram"), "social");
  assert.equal(categoriseApp("com.google.ios.youtube"), "video");
  assert.equal(categoriseApp("com.anthropic.claudefordesktop"), "ai");
  assert.equal(categoriseApp("com.spotify.client"), "music");
  assert.equal(categoriseApp("com.apple.finder"), "system");
  assert.equal(categoriseApp("COM.MICROSOFT.VSCODE"), "work"); // case does not matter
  assert.equal(categoriseApp("com.jetbrains.intellij"), "work"); // a whole family by prefix
  assert.equal(categoriseApp("com.apple.springboard.home-screen"), "system");
});

test("apps: unknown ids stay other, and so does a browser", () => {
  assert.equal(categoriseApp("com.example.SuperNotes"), "other");
  assert.equal(categoriseApp(""), "other");
  assert.equal(categoriseApp("com.google.Chrome"), "other");
  assert.equal(isBrowser("com.google.Chrome"), true);
  assert.equal(isBrowser("com.microsoft.VSCode"), false);
});

test("hosts: the longest listed ending wins", () => {
  assert.equal(categoriseHost("www.youtube.com"), "video");
  assert.equal(categoriseHost("music.youtube.com"), "music");
  assert.equal(categoriseHost("amazon.com"), "shopping");
  assert.equal(categoriseHost("aws.amazon.com"), "work");
  assert.equal(categoriseHost("mail.google.com"), "communication");
  assert.equal(categoriseHost("docs.google.com"), "work");
  assert.equal(categoriseHost("www.google.com"), "other"); // a search page could be anything
  assert.equal(categoriseHost("gist.github.com"), "work");
  assert.equal(categoriseHost("claude.ai"), "ai");
  assert.equal(categoriseHost("old.reddit.com"), "social");
});

test("hosts: country endings of listed brands, and nothing that merely looks alike", () => {
  assert.equal(categoriseHost("www.amazon.de"), "shopping");
  assert.equal(categoriseHost("amazon.co.uk"), "shopping");
  assert.equal(categoriseHost("www.skyscanner.gr"), "travel");
  assert.equal(categoriseHost("notamazon.com"), "other");
  assert.equal(categoriseHost("amazon.example.org"), "other");
  assert.equal(categoriseHost("myyoutube.com"), "other");
  assert.equal(categoriseHost("unknown.example"), "other");
  assert.equal(categoriseHost(""), "other");
});

test("hosts: a full address is reduced to its host", () => {
  assert.equal(normaliseHost("https://WWW.Example.com:8443/path?q=1#x"), "example.com");
  assert.equal(normaliseHost("user@mail.example.com"), "mail.example.com");
  assert.equal(categoriseHost("https://www.youtube.com/watch?v=abc"), "video");
  assert.equal(categoriseHost("localhost:3000"), "work");
});

test("app names: well known names read as bundle ids, case and .app do not matter", () => {
  assert.equal(bundleIdForAppName("Code"), "com.microsoft.VSCode");
  assert.equal(bundleIdForAppName("Google Chrome.app"), "com.google.Chrome");
  assert.equal(bundleIdForAppName("  instagram "), "com.burbn.instagram");
  assert.equal(bundleIdForAppName("PyCharm"), "com.jetbrains.pycharm");
  assert.equal(categoriseApp(bundleIdForAppName("PyCharm") ?? ""), "work"); // the JetBrains family
  assert.equal(bundleIdForAppName("Some Private Tool"), null);
  // Names that are properties of every object are not apps.
  assert.equal(bundleIdForAppName("constructor"), null);
  assert.equal(bundleIdForAppName("toString"), null);
});

test("roles: work and AI make goal time, distractions break it, the rest is neutral", () => {
  assert.equal(categoryRole("work"), "work");
  assert.equal(categoryRole("ai"), "work");
  for (const c of ["communication", "social", "video", "news", "shopping", "travel"] as const) {
    assert.equal(categoryRole(c), "distractor", c);
  }
  for (const c of ["music", "system", "other"] as const) assert.equal(categoryRole(c), "neutral", c);
});

test("one categoriser for an event: site, bundle id, then a well known name", () => {
  assert.equal(categoriseEvent({ type: "web_visit", data: { host: "www.youtube.com" } }), "video");
  // The host list wins over the label a collector sent; an unknown host falls back to the label.
  assert.equal(
    categoriseEvent({ type: "web_visit", data: { host: "github.com", category: "social" } }),
    "work",
  );
  assert.equal(
    categoriseEvent({ type: "web_visit", data: { host: "unknown.example", category: "mail" } }),
    "communication",
  );
  assert.equal(
    categoriseEvent({ type: "app_usage", data: { bundle_id: "net.whatsapp.WhatsApp" } }),
    "communication",
  );
  assert.equal(
    categoriseEvent({ type: "app_usage", title: "Instagram", data: { app: "Instagram" } }),
    "social",
  );
  assert.equal(categoriseEvent({ type: "app_usage", title: "Code", data: {} }), "work");
  assert.equal(categoriseEvent({ type: "app_usage", title: "Some Private Tool", data: {} }), "other");
  // Neither an app nor a site: no category, and the title of a workout is never read.
  assert.equal(categoriseEvent({ type: "workout", title: "Instagram", data: {} }), null);
});

test("old collector labels read as the shared vocabulary; unknown labels are other", () => {
  assert.equal(categoriseVisit("unknown.example", "dev"), "work");
  assert.equal(categoriseVisit("unknown.example", "docs"), "work");
  assert.equal(categoriseVisit("unknown.example", "messaging"), "communication");
  assert.equal(categoriseVisit("unknown.example", "search"), "other");
  assert.equal(categoriseVisit("unknown.example", "constructor"), "other");
  assert.equal(categoriseHost("constructor.com"), "other");
});

test("the hosts the collector and the extension used to list on their own are in the one list", () => {
  assert.equal(categoriseHost("easyjet.com"), "travel");
  assert.equal(categoriseHost("www.vinted.fr"), "shopping");
  assert.equal(categoriseHost("pinterest.co.uk"), "social");
  assert.equal(categoriseHost("fastmail.com"), "communication");
  assert.equal(categoriseHost("huggingface.co"), "ai");
  assert.equal(categoriseHost("sentry.io"), "work");
  assert.equal(categoriseHost("apnews.com"), "news");
  assert.equal(categoriseHost("tv.apple.com"), "video");
});

test("the browser extension's generated copy matches the shared lists (pnpm categories:extension)", async () => {
  const url = pathToFileURL(new URL("../../../extension/lib/categories.js", import.meta.url).pathname).href;
  const ext = (await import(url)) as {
    SITE_LISTS: unknown;
    SITE_BRANDS: unknown;
    categoryFor: (host: string) => string | undefined;
  };
  assert.deepEqual(ext.SITE_LISTS, SITE_LISTS, "run pnpm categories:extension");
  assert.deepEqual(ext.SITE_BRANDS, SITE_BRANDS, "run pnpm categories:extension");
  const hosts = [
    ...Object.values(SITE_LISTS).flat(),
    ...Object.values(SITE_LISTS)
      .flat()
      .map((h) => `sub.${h}`),
    ...Object.keys(SITE_BRANDS).flatMap((b) => [`${b}.de`, `www.${b}.co.uk`, `${b}.example.org`]),
    "www.google.com",
    "google.co.uk",
    "unknown.example",
    "constructor.com",
    "localhost",
    "",
  ];
  for (const host of hosts) {
    const shared = categoriseHost(host);
    assert.equal(ext.categoryFor(host), shared === "other" ? undefined : shared, host);
  }
});
