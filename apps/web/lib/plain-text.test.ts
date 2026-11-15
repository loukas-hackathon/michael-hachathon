import assert from "node:assert/strict";
import { test } from "node:test";
import { plainText } from "@michael/shared/plain-text";

// QA round 2 (#346): the conversation list showed "**2h 01 of 6h**" and "- **Calendar:**".

test("plain text: a stored preview loses its Markdown marks", () => {
  assert.equal(
    plainText(
      "You're behind on University this week: **2h 01 of 6h**, with **3h 59** still to go. - **Calendar:** you planned 4h 50",
    ),
    "You're behind on University this week: 2h 01 of 6h, with 3h 59 still to go. Calendar: you planned 4h 50",
  );
});

test("plain text: lists, headings, links, italics and code from a full answer", () => {
  assert.equal(
    plainText("## Today\n- **Gym** at 18:00\n- *Rest* after\n1. See [Goals](/goals)\nRun `pnpm`"),
    "Today Gym at 18:00 Rest after See Goals Run pnpm",
  );
});

test("plain text: ordinary sentences and times stay as they are", () => {
  const s = "Leave at 19:15, win 20 minutes. 3 - 2 = 1 and snake_case_word stay.";
  assert.equal(plainText(s), s);
});
