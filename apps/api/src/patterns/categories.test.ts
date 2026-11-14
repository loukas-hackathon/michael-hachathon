import assert from "node:assert/strict";
import { test } from "node:test";
import { categoriseApp, categoriseHost, isBrowser, normaliseHost } from "@michael/shared";

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
