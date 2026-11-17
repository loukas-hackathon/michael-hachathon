import assert from "node:assert/strict";
import { test } from "node:test";
import type { SourceSetting } from "@michael/shared";
import { hasSavedRule, sourceSwitchOn } from "./source-switch";

const epoch = new Date(0).toISOString();
const now = "2026-11-15T14:16:00.000Z";
const s = (source: SourceSetting["source"], enabled: boolean, updated_at: string): SourceSetting => ({
  source,
  enabled,
  updated_at,
});

test("a source with no saved rule is collected, so its switch reads On", () => {
  assert.equal(hasSavedRule(s("ios_shortcuts", false, epoch)), false);
  assert.equal(sourceSwitchOn(s("ios_shortcuts", false, epoch)), true);
  assert.equal(sourceSwitchOn(s("iphone_usage", false, epoch)), true);
});

test("a saved rule reads as saved, on or off", () => {
  assert.equal(sourceSwitchOn(s("ios_shortcuts", true, now)), true);
  assert.equal(sourceSwitchOn(s("ios_shortcuts", false, now)), false);
});

test("location stays opt in: no rule reads Off", () => {
  assert.equal(sourceSwitchOn(s("maps", false, epoch)), false);
  assert.equal(sourceSwitchOn(s("maps", true, now)), true);
});

test("an unknown source reads Off", () => {
  assert.equal(sourceSwitchOn(undefined), false);
});
