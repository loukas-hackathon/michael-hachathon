import assert from "node:assert/strict";
import { test } from "node:test";
import type { MomentStretch } from "@michael/shared";
import { lastTime, lastTimeSentence } from "./moment-risk";

const risk = (last_time?: MomentStretch["last_time"]): MomentStretch => ({
  start_at: "2026-11-20T08:30:00.000Z",
  end_at: "2026-11-20T10:00:00.000Z",
  title: "Cold Outreach / Sales",
  goal_id: null,
  block_event_id: null,
  expected_lost_minutes: 25,
  history_days: 3,
  usual_trigger: "TikTok",
  last_time,
});

test("yesterday is said as Yesterday, in the API's words", () => {
  const r = risk({ day: "2026-11-19", lost_minutes: 17, trigger: "TikTok" });
  assert.deepEqual(lastTime(r, "2026-11-20"), { when: "Yesterday", lost: "17 minutes", trigger: "TikTok" });
  assert.equal(lastTimeSentence(r, "2026-11-20"), "Yesterday this block lost 17 minutes to TikTok.");
});

test("an earlier day is named, and long losses read as hours", () => {
  const r = risk({ day: "2026-11-16", lost_minutes: 135, trigger: "WhatsApp Business" });
  assert.equal(lastTimeSentence(r, "2026-11-19"), "On Monday this block lost 2h 15 to WhatsApp Business.");
  // Across a month's end the day before is still yesterday.
  const first = risk({ day: "2026-11-30", lost_minutes: 12, trigger: null });
  assert.equal(lastTimeSentence(first, "2026-12-01"), "Yesterday this block lost 12 minutes.");
});

test("without a last time the card keeps the average", () => {
  assert.equal(lastTime(risk(), "2026-11-20"), null);
  assert.equal(lastTime(risk(null), "2026-11-20"), null);
  assert.equal(lastTimeSentence(risk(null), "2026-11-20"), null);
});
