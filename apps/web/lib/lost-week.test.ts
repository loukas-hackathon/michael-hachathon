import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneLine } from "./lost-week";

test("phone line: 01:30 on Sunday in Athens is today, not Saturday (UTC still says Saturday)", () => {
  // 23:30 UTC on Saturday is 01:30 on Sunday in Athens.
  assert.equal(
    phoneLine({ phoneUntil: "2026-11-14T23:30:00.000Z", today: "2026-11-15" }),
    "Phone data up to 01:30, so today can still grow.",
  );
});

test("phone line: data that stopped on an earlier day names that day", () => {
  assert.equal(
    phoneLine({ phoneUntil: "2026-11-14T10:00:00.000Z", today: "2026-11-15" }),
    "Phone data up to Saturday 12:00, so today can still grow.",
  );
  assert.equal(phoneLine({ phoneUntil: null, today: "2026-11-15" }), null);
});
