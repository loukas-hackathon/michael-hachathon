import assert from "node:assert/strict";
import { test } from "node:test";
import type { Recommendation } from "@michael/shared";
import { bookedAhead, openRecommendations } from "./recommendations";

// Sunday 15 November 2026, 12:00 in Athens.
const now = new Date("2026-11-15T10:00:00.000Z");
let n = 0;

/** A focus block at `start` (UTC hour today), as the API records it. */
function block(over: Partial<Recommendation> & { start?: number } = {}): Recommendation {
  const { start = 13, ...rest } = over;
  const at = (h: number) => `2026-11-15T${String(h).padStart(2, "0")}:00:00.000Z`;
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    analysis_run_id: null,
    goal_id: null,
    title: "Sales focus",
    rationale: "Booked at your request through Claude. Undo in Michael until it starts.",
    action: {
      kind: "create_focus_block",
      payload: { start_at: at(start), end_at: at(start + 1), title: "Sales focus" },
      involves_others: false,
      undo_until: at(start),
    },
    status: "done",
    executed_at: "2026-11-15T09:00:00.000Z",
    undone_at: null,
    source: "chat",
    created_at: "2026-11-15T09:00:00.000Z",
    updated_at: "2026-11-15T09:00:00.000Z",
    ...rest,
  };
}

test("a block the user asked for and then undid is never offered back as the next move", () => {
  const undone = block({ status: "undone", undone_at: "2026-11-15T09:30:00.000Z" });
  assert.deepEqual(openRecommendations([undone], now), []);
  // Dismissed stays closed too.
  assert.deepEqual(openRecommendations([block({ status: "dismissed" })], now), []);
});

test("Michael's own suggestion, done and undone, is still his offer", () => {
  const suggestion = block({ status: "undone", source: "analysis", title: "Block 15:00 for cold outreach" });
  assert.deepEqual(openRecommendations([suggestion], now), [suggestion]);
  // Older rows carry no source and read as analysis.
  const old = block({ status: "undone", source: undefined });
  assert.deepEqual(openRecommendations([old], now), [old]);
});

test("the block just booked through Claude is the one Today shows on top", () => {
  const first = block({ executed_at: "2026-11-15T09:00:00.000Z" });
  const newest = block({ executed_at: "2026-11-15T09:40:00.000Z", start: 16 });
  assert.equal(bookedAhead([first, newest], now), newest);
  assert.equal(bookedAhead([newest, first], now), newest);
});

test("nothing shows on top once the block has started, was undone, or was not asked for", () => {
  assert.equal(bookedAhead([block({ start: 9 })], now), null);
  assert.equal(bookedAhead([block({ status: "undone" })], now), null);
  assert.equal(bookedAhead([block({ source: "analysis" })], now), null);
  assert.equal(bookedAhead([block({ status: "proposed" })], now), null);
  const moved = block();
  assert.equal(
    bookedAhead(
      [{ ...moved, action: moved.action && { ...moved.action, kind: "move_calendar_block" } }],
      now,
    ),
    null,
  );
  assert.equal(bookedAhead([], now), null);
});
