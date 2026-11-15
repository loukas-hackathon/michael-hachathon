import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeOnTitle, loggedTitle, michaelBadges } from "./timeline";

test("touching blocks by Michael never stack two badges (Walk and Boatspace, #448)", () => {
  // 56 px an hour: a 5 minute block at 09:55 right above a 2 hour block at 10:00.
  const badges = michaelBadges([
    { key: "leave", top: 195.3, bottom: 200 },
    { key: "boat", top: 200, bottom: 312 },
  ]);
  assert.deepEqual([...badges.entries()], [["boat", 203]]);
});

test("badges of blocks far apart are all kept, short ones above their block", () => {
  const badges = michaelBadges([
    { key: "a", top: 100, bottom: 108 },
    { key: "b", top: 300, bottom: 400 },
  ]);
  assert.equal(badges.get("a"), 92);
  assert.equal(badges.get("b"), 303);
});

test("a title shares its line with a badge only when they meet", () => {
  assert.equal(badgeOnTitle(100, [103]), true);
  assert.equal(badgeOnTitle(100, [92]), true);
  assert.equal(badgeOnTitle(100, [140]), false);
  assert.equal(badgeOnTitle(100, []), false);
});

test("a logged block reads the block's name, not the settle sentence", () => {
  assert.equal(loggedTitle("Did Everything bath, 1h from 06:30"), "Everything bath");
  assert.equal(loggedTitle("Did Καθαρισμός δωματίου, 45 min from 12:00"), "Καθαρισμός δωματίου");
  assert.equal(loggedTitle("Did Write, edit, ship, 1h 20 from 9:05"), "Write, edit, ship");
  assert.equal(loggedTitle("Gym"), "Gym");
});
