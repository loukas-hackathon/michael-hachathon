import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FOCUS_SHORTCUT_DOWNLOAD, FOCUS_SHORTCUT_NAME, focusShortcutInput } from "@michael/shared";
import { FOCUS_SHORTCUT_FILE, focusShortcutLink, focusShortcutOffLink, focusShortcutRunLink } from "./dnd";

test("Focus now runs Michael Focus with the end time and comes back to the session", () => {
  const input = focusShortcutInput("2026-11-15T13:46:00.000Z");
  assert.equal(input, "2026-11-15 15:46");
  const link = focusShortcutRunLink(input, "https://michael.app/?focus=1");
  assert.ok(link.startsWith("shortcuts://x-callback-url/run-shortcut?"));
  const q = new URL(link.replace("shortcuts://x-callback-url/", "https://x/")).searchParams;
  assert.equal(q.get("name"), "Michael Focus");
  assert.equal(q.get("input"), "text");
  assert.equal(q.get("text"), "2026-11-15 15:46");
  assert.equal(q.get("x-success"), "https://michael.app/?focus=1");
  assert.equal(q.get("x-cancel"), "https://michael.app/?focus=1");
  // Spaces as %20, as Shortcuts reads them; the app address is encoded whole.
  assert.ok(link.includes("name=Michael%20Focus&input=text&text=2026-11-15%2015%3A46"));
  assert.ok(link.includes("x-success=https%3A%2F%2Fmichael.app%2F%3Ffocus%3D1"));
  // Off, and no way back in the installed app.
  assert.equal(
    focusShortcutRunLink("off"),
    "shortcuts://x-callback-url/run-shortcut?name=Michael%20Focus&input=text&text=off",
  );
});

test("the hand over runs the Michael Focus shortcut by name, with the time to end as text", () => {
  const input = focusShortcutInput("2026-11-17T12:00:00.000Z");
  assert.equal(input, "2026-11-17 14:00");
  assert.equal(
    focusShortcutLink(input),
    "shortcuts://run-shortcut?name=Michael%20Focus&input=text&text=2026-11-17%2014%3A00",
  );
  assert.equal(focusShortcutOffLink(), "shortcuts://run-shortcut?name=Michael%20Focus&input=text&text=off");
  // iOS names an imported shortcut after its file: the address has no space, the download does.
  assert.equal(FOCUS_SHORTCUT_FILE, "/MichaelFocus.shortcut");
  assert.equal(FOCUS_SHORTCUT_DOWNLOAD, `${FOCUS_SHORTCUT_NAME}.shortcut`);
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.ok(config.includes(`source: "${FOCUS_SHORTCUT_FILE}"`));
  assert.ok(config.includes(`filename="${FOCUS_SHORTCUT_DOWNLOAD}"`));
  // And the signed file is there, signed.
  const file = readFileSync(new URL(`../public${FOCUS_SHORTCUT_FILE}`, import.meta.url));
  assert.equal(file.subarray(0, 4).toString("latin1"), "AEA1");
});

test("the time is the wall clock of the place, to the minute, across midnight and summer time", () => {
  assert.equal(focusShortcutInput("2026-11-17T22:30:00Z"), "2026-11-18 00:30");
  assert.equal(focusShortcutInput("2026-07-01T04:00:00Z"), "2026-07-01 07:00");
  assert.equal(focusShortcutInput("2026-11-17T12:00:00Z", "Europe/London"), "2026-11-17 12:00");
});
