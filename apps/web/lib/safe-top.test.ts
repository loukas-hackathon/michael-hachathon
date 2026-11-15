import assert from "node:assert/strict";
import { test } from "node:test";
import { SAFE_TOP_FN, type SafeTopState } from "./safe-top";

const safeTopFor = new Function(`return ${SAFE_TOP_FN}`)() as (s: SafeTopState) => number | null;
const iphone13 = { standalone: true, innerWidth: 390, screenHeight: 844 };

test("a browser tab keeps env()", () => {
  assert.equal(safeTopFor({ ...iphone13, standalone: false, env: 0, innerHeight: 664 }), null);
});

test("full screen app with a real inset keeps env()", () => {
  assert.equal(safeTopFor({ ...iphone13, env: 47, innerHeight: 844 }), null);
});

test("full screen app that reports 0 gets the status bar height (#448)", () => {
  assert.equal(safeTopFor({ ...iphone13, env: 0, innerHeight: 844 }), 47);
  assert.equal(safeTopFor({ ...iphone13, screenHeight: 874, env: 0, innerHeight: 874 }), 62);
});

test("a page that already starts below the status bar gets no second inset (the black band)", () => {
  assert.equal(safeTopFor({ ...iphone13, env: 47, innerHeight: 797 }), 0);
  assert.equal(safeTopFor({ ...iphone13, env: 0, innerHeight: 797 }), 0);
});

test("landscape keeps env()", () => {
  assert.equal(safeTopFor({ ...iphone13, innerWidth: 844, env: 0, innerHeight: 390 }), null);
});
