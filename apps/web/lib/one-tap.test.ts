import assert from "node:assert/strict";
import { test } from "node:test";
import { shortcutAddLink, telegramAppLink } from "./one-tap";

const APP = "https://michael.example";

test("shortcut: our signed file goes straight to the Shortcuts import screen", () => {
  assert.equal(
    shortcutAddLink("/Michael.shortcut", APP),
    "shortcuts://import-shortcut?url=https%3A%2F%2Fmichael.example%2FMichael.shortcut&name=Michael",
  );
  assert.equal(
    shortcutAddLink("https://files.example/a b/Michael.shortcut", APP),
    "shortcuts://import-shortcut?url=https%3A%2F%2Ffiles.example%2Fa%2520b%2FMichael.shortcut&name=Michael",
  );
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
