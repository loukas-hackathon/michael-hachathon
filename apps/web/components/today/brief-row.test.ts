import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalysisRun } from "@michael/shared";
import { briefRow, NO_BRIEF } from "./brief-row";

const run = (over: Partial<AnalysisRun>) => ({ summary: "Solid morning.\nMore.", ...over }) as AnalysisRun;
const now = new Date("2026-11-15T06:12:00+02:00");

test("brief row: no brief says so in one line, never filler about what a brief is", () => {
  assert.deepEqual(briefRow(null, now), { preview: NO_BRIEF, when: null });
  assert.doesNotMatch(NO_BRIEF, /tell you what matters/);
});

test("brief row: the first line previews; a brief from yesterday says Yesterday, not 14:30", () => {
  assert.deepEqual(briefRow(run({ finished_at: "2026-11-14T14:30:00+02:00" }), now), {
    preview: "Solid morning.",
    when: "Yesterday",
  });
  assert.equal(briefRow(run({ finished_at: "2026-11-15T05:40:00+02:00" }), now).when, "05:40");
});
