import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutUndoLine } from "./chat-undo";

test("the Undo word goes when the chip says it", () => {
  assert.equal(
    withoutUndoLine("Logged 40 min. Everything bath: 40 of 60 min this week. Undo"),
    "Logged 40 min. Everything bath: 40 of 60 min this week.",
  );
  assert.equal(withoutUndoLine("Moved Gym to 18:00. Undo until 17:00."), "Moved Gym to 18:00.");
  assert.equal(
    withoutUndoLine("Logged 20 min. Bath: 20 of 60 min this week. Undo. You are on track."),
    "Logged 20 min. Bath: 20 of 60 min this week. You are on track.",
  );
  assert.equal(withoutUndoLine("On it.\n\nLunch is in. Undo until 13:00."), "On it.\n\nLunch is in.");
});

test("other words stay", () => {
  assert.equal(withoutUndoLine("Undo that and keep Gym."), "Undo that and keep Gym.");
  assert.equal(withoutUndoLine("You can undo it until it starts."), "You can undo it until it starts.");
  assert.equal(withoutUndoLine("Undo"), "Undo");
});
