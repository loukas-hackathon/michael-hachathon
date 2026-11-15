import assert from "node:assert/strict";
import { test } from "node:test";
import { bookedLine, bookedSplit, bookMinutes } from "./goals-view";

// hm() keeps "1h 30" on one line with a no-break space: compare the words, not the kind of space.
const plain = (s: string | null) => s?.replace(/\u00a0/g, " ") ?? null;

test("what is left splits into what is booked ahead and what is still open", () => {
  // The demo week's 70.3: 1h 49 left, one 1h 30 block still to come.
  assert.deepEqual(bookedSplit(109, 90), { booked: 90, open: 19 });
  assert.equal(plain(bookedLine(109, 90)), "1h 30 booked, 19 minutes still open.");
  // Book is offered for the open part only.
  assert.equal(bookMinutes(bookedSplit(109, 90).open, 1), 30);
});

test("a block that covers what is left closes the goal, and nothing booked says nothing", () => {
  assert.deepEqual(bookedSplit(60, 90), { booked: 90, open: 0 });
  assert.equal(plain(bookedLine(60, 90)), "1h 30 booked. That closes it.");
  assert.equal(bookedLine(109, 0), null);
  assert.equal(bookedLine(0, 90), null);
});
