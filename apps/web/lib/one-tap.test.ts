import assert from "node:assert/strict";
import { test } from "node:test";
import { shortcutAddLink, telegramAppLink } from "./one-tap";

const APP = "https://michael.example";

test("shortcut: our signed file is opened as its absolute https URL, never shortcuts://import-shortcut", () => {
  for (const file of ["/Michael.shortcut", "https://files.example/a b/Michael.shortcut"]) {
    const link = shortcutAddLink(file, APP);
    assert.ok(!link.startsWith("shortcuts:"), link);
    assert.ok(link.startsWith("https://"), link);
  }
  assert.equal(shortcutAddLink("/Michael.shortcut", APP), "https://michael.example/Michael.shortcut");
});

test("shortcut: an iCloud link stays as it is, it opens Shortcuts itself", () => {
  const icloud = "https://www.icloud.com/shortcuts/0123456789abcdef";
  assert.equal(shortcutAddLink(icloud, APP), icloud);
});

test("shortcut: a local http server gets an absolute link, never a shortcuts:// one", () => {
  assert.equal(
    shortcutAddLink("/Michael.shortcut", "http://localhost:3000"),
    "http://localhost:3000/Michael.shortcut",
  );
});

test("telegram: a t.me bot link becomes the app's own link, anything else is refused", () => {
  assert.equal(
    telegramAppLink("https://t.me/MichaelBot?start=abc_123"),
    "tg://resolve?domain=MichaelBot&start=abc_123",
  );
  assert.equal(telegramAppLink("https://t.me/MichaelBot"), "tg://resolve?domain=MichaelBot");
  assert.equal(telegramAppLink("https://evil.example/MichaelBot?start=x"), null);
  assert.equal(telegramAppLink("https://t.me/a/b"), null);
  assert.equal(telegramAppLink("not a url"), null);
});
