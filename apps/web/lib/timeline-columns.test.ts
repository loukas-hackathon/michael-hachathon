import assert from "node:assert/strict";
import { test } from "node:test";
import { columns, edgeLabels } from "./timeline";

// #463: things at the same time go side by side, never one title over another.

test("a drive over real activity takes the right column, and the activity the left", () => {
  const { spots, more } = columns([
    { key: "d1", top: 100, bottom: 160, late: true },
    { key: "d2", top: 400, bottom: 440, late: true },
    { key: "mac", top: 140, bottom: 260 },
    { key: "gym", top: 300, bottom: 360 },
  ]);
  assert.deepEqual(spots.get("mac"), { col: 0, cols: 2 });
  assert.deepEqual(spots.get("d1"), { col: 1, cols: 2 });
  assert.equal(spots.has("d2"), false);
  assert.equal(spots.has("gym"), false);
  assert.deepEqual(more, []);
});

test("touching edges are not an overlap: back to back blocks stay full width", () => {
  const { spots } = columns([
    { key: "a", top: 100, bottom: 160 },
    { key: "b", top: 160, bottom: 200 },
    { key: "c", top: 200, bottom: 214 },
  ]);
  assert.equal(spots.size, 0);
});

test("an event inside another sits beside it, and the group shares the width", () => {
  const { spots } = columns([
    { key: "offsite", top: 0, bottom: 112 },
    { key: "sync", top: 28, bottom: 56 },
    { key: "focus", top: 84, bottom: 126 },
    { key: "standup", top: 112, bottom: 117 },
  ]);
  assert.deepEqual(spots.get("offsite"), { col: 0, cols: 2 });
  assert.deepEqual(spots.get("sync"), { col: 1, cols: 2 });
  // The sync is over by the time focus starts: focus reuses its column.
  assert.deepEqual(spots.get("focus"), { col: 1, cols: 2 });
  assert.deepEqual(spots.get("standup"), { col: 0, cols: 2 });
});

test("three at once: three columns", () => {
  const { spots, more } = columns([
    { key: "a", top: 0, bottom: 56 },
    { key: "b", top: 0, bottom: 56 },
    { key: "c", top: 14, bottom: 42 },
  ]);
  assert.deepEqual(
    ["a", "b", "c"].map((k) => spots.get(k)),
    [
      { col: 0, cols: 3 },
      { col: 1, cols: 3 },
      { col: 2, cols: 3 },
    ],
  );
  assert.deepEqual(more, []);
});

test("four at once: two columns and +2 more in the third", () => {
  const { spots, more } = columns([
    { key: "a", top: 0, bottom: 56 },
    { key: "b", top: 0, bottom: 56 },
    { key: "c", top: 0, bottom: 56 },
    { key: "d", top: 14, bottom: 42 },
  ]);
  assert.deepEqual(spots.get("a"), { col: 0, cols: 3 });
  assert.deepEqual(spots.get("b"), { col: 1, cols: 3 });
  assert.equal(spots.has("c"), false);
  assert.equal(spots.has("d"), false);
  assert.deepEqual(more, [{ key: "morec", top: 0, bottom: 56, col: 2, cols: 3, hidden: ["c", "d"] }]);
});

test("an edge label is left out on a title line or within a line of another label", () => {
  const kept = edgeLabels(
    [
      { key: "free", top: 300 },
      { key: "onTitle", top: 100 },
      { key: "nearBadge", top: 205 },
      { key: "afterFree", top: 310 },
    ],
    [[104, 120]],
    [200],
  );
  assert.deepEqual([...kept], ["free"]);
});
