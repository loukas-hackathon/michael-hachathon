import assert from "node:assert/strict";
import { test } from "node:test";
import { sideBySide } from "./timeline";

test("a drive over real activity steps aside, and the activity it overlaps does too", () => {
  const keys = sideBySide(
    [
      { key: "d1", top: 100, bottom: 160 },
      { key: "d2", top: 400, bottom: 440 },
    ],
    [
      { key: "mac", top: 140, bottom: 260 },
      { key: "gym", top: 300, bottom: 360 },
    ],
  );
  assert.deepEqual([...keys].sort(), ["d1", "mac"]);
});

test("touching edges are not an overlap", () => {
  const keys = sideBySide([{ key: "d", top: 100, bottom: 160 }], [{ key: "mac", top: 160, bottom: 200 }]);
  assert.equal(keys.size, 0);
});
