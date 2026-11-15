import assert from "node:assert/strict";
import { test } from "node:test";
import { FOCUS_SHORTCUT_NAME, focusShortcutInput } from "@michael/shared";
import { FOCUS_SHORTCUT_FILE, focusShortcutLink, focusShortcutOffLink } from "./dnd";

test("the hand over runs the Michael Focus shortcut by name, with the time to end as text", () => {
  const input = focusShortcutInput("2026-11-17T12:00:00.000Z");
  assert.equal(input, "2026-11-17 14:00");
  assert.equal(
    focusShortcutLink(input),
    "shortcuts://run-shortcut?name=Michael%20Focus&input=text&text=2026-11-17%2014%3A00",
  );
  assert.equal(focusShortcutOffLink(), "shortcuts://run-shortcut?name=Michael%20Focus&input=text&text=off");
  // iOS names an imported shortcut after its file, so the file carries the name the link runs.
  assert.equal(decodeURIComponent(FOCUS_SHORTCUT_FILE), `/${FOCUS_SHORTCUT_NAME}.shortcut`);
});

test("the time is the wall clock of the place, to the minute, across midnight and summer time", () => {
  assert.equal(focusShortcutInput("2026-11-17T22:30:00Z"), "2026-11-18 00:30");
  assert.equal(focusShortcutInput("2026-07-01T04:00:00Z"), "2026-07-01 07:00");
  assert.equal(focusShortcutInput("2026-11-17T12:00:00Z", "Europe/London"), "2026-11-17 12:00");
});
