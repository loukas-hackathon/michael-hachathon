import assert from "node:assert/strict";
import { test } from "node:test";
import type { Score } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { store } from "../store";
import { seedDemoWeek } from "./sync";

// A new week starts on Monday, and the pitch is on a Monday (16 November) at an hour nobody knows
// yet. Monday's first own goal block used to start at 17:00, so until then the stage, Today,
// Timeline and Goals had nothing to read: "0% so far", no lost time, an empty tape (#330). Monday
// now opens with a 07:30 block that has real Mac and phone activity in it, some of it lost.

const auth = { Authorization: "Bearer dev-key" };
const asDemo = <T>(fn: () => Promise<T>) => runAsUser(env.DEMO_USER_ID, fn, "api_key");
const score = async (now: string) => {
  const res = await app.request(`/v1/score?now=${encodeURIComponent(new Date(now).toISOString())}`, {
    headers: auth,
  });
  assert.equal(res.status, 200);
  return (await res.json()) as Score;
};

for (const clock of ["08:30", "09:00", "11:05", "14:00"]) {
  test(`pitch Monday at ${clock}: today and the new week have a score, lost time and what took it`, async () => {
    const now = `2026-11-16T${clock}:00+02:00`;
    await asDemo(() => seedDemoWeek(store, { overwriteGoals: true, now: new Date(now) }));
    const s = await score(now);
    assert.equal(s.day.date, "2026-11-16");
    const first = s.day.blocks[0];
    assert.equal(first?.title, "Meeting Preparation");
    assert.equal(first?.goal_title, "The company");

    // Today: part of the block is proven on the Mac, part of it went to the phone.
    assert.ok(s.day.elapsed_minutes >= 60, `${s.day.elapsed_minutes} minutes have run`);
    assert.ok(
      s.day.score_pct !== null && s.day.score_pct >= 50 && s.day.score_pct < 100,
      `${s.day.score_pct}%`,
    );
    assert.ok(s.day.lost_minutes >= 10, `${s.day.lost_minutes} minutes lost`);
    // Proven on the Mac at every hour: Sunday's replayed "Screen off" must not run over the block.
    assert.ok(s.day.spent_minutes - s.day.unverified_minutes >= 30, "spent time the Mac proves");
    assert.ok(first.ticks.includes("spent") && first.ticks.includes("lost"));

    // The week, which is only Monday so far: the same numbers, and a name for what took the time.
    assert.equal(s.lost_minutes, s.day.lost_minutes);
    assert.equal(s.score_pct, s.day.score_pct);
    assert.equal(s.lost_by?.[0]?.what, "Instagram");
    // He sells on messaging: inside a company block it is never what took the time.
    assert.ok(!first.lost.some((l) => l.category === "communication"));
  });
}
