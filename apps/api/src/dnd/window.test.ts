import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type PhoneCadence, type Recommendation, voiceProblems } from "@michael/shared";
import { executeRecommendation, undoRecommendation } from "../actions/calendar";
import { activeDnd, resetDnd } from "../actions/dnd";
import { runAsUser } from "../context";
import { withoutInstructions } from "../instructions/testkit";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { busiestWindow, nextWindow, planDndWindow, WINDOW_MARK } from "./window";

const zone = new Zone(DEFAULT_TIMEZONE);
const MIN = 60_000;

/** A week of phone opens: `peak` opens a day in each hour from 11:00 to 13:00, 1 a day elsewhere. */
function cadence(opts: { days?: number; peak?: number; peakFrom?: number } = {}): PhoneCadence {
  const peakFrom = opts.peakFrom ?? 11;
  return {
    days_with_data: opts.days ?? 7,
    window: { start_hour: 9, end_hour: 18 },
    by_hour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      sessions: 0,
      sessions_per_day:
        hour >= peakFrom && hour < peakFrom + 2 ? (opts.peak ?? 4) : hour >= 9 && hour < 18 ? 1 : 0,
      median_gap_minutes: null,
    })),
  } as unknown as PhoneCadence;
}

test("busiest window: the two hours of the working day with the most opens", () => {
  assert.deepEqual(busiestWindow(cadence()), { startHour: 11, endHour: 13, opensPerDay: 8 });
  assert.deepEqual(busiestWindow(cadence({ peakFrom: 15 }))?.startHour, 15);
});

test("busiest window: too few days, or too quiet, offers nothing", () => {
  assert.equal(busiestWindow(cadence({ days: 2 })), null);
  assert.equal(busiestWindow(cadence({ peak: 1 })), null);
  assert.equal(busiestWindow(null), null);
});

test("next window: today while enough of it is left, else tomorrow", () => {
  const win = { startHour: 11, endHour: 13, opensPerDay: 8 };
  const day = "2026-11-16";
  const at = (h: number, m = 0) => zone.at(day, h * 60 + m);
  assert.deepEqual(nextWindow(win, at(9), zone), { day, start: at(11), end: at(13) });
  // Inside it: from now to its end.
  assert.deepEqual(nextWindow(win, at(12), zone), { day, start: at(12), end: at(13) });
  // Ten minutes before its end: tomorrow.
  const next = nextWindow(win, at(12, 50), zone);
  assert.equal(next.day, "2026-11-17");
  assert.equal(zone.clock(next.start), "11:00");
});

test("the offer: one tap, the window's hours, the voice, once a day", () => {
  const now = zone.at("2026-11-16", 9 * 60);
  const offer = planDndWindow({ cadence: cadence(), now, zone, existing: [] });
  assert.ok(offer?.action);
  assert.equal(offer.title, "Do Not Disturb today, 11:00 to 13:00.");
  assert.match(
    offer.rationale,
    /^11:00 to 13:00 is when your phone pulls hardest: 8 opens a day this week, one every 15 minutes\./,
  );
  for (const line of [offer.title, offer.rationale]) assert.deepEqual(voiceProblems(line), [], line);
  assert.equal(offer.action.kind, "do_not_disturb");
  assert.equal(offer.action.involves_others, false);
  assert.equal(offer.action.payload.window, WINDOW_MARK);
  assert.equal(zone.clock(Date.parse(String(offer.action.payload.start_at))), "11:00");
  assert.equal(zone.clock(Date.parse(String(offer.action.payload.end_at))), "13:00");

  // An offer for that day already made, taken or not: no second one. A dismissed one is not offered again either way.
  const made = { ...offer, id: randomUUID(), status: "proposed" } as unknown as Recommendation;
  assert.equal(planDndWindow({ cadence: cadence(), now, zone, existing: [made] }), null);
});

test("set ahead: it is not on before its hour, it is on inside it, undo ends it", () =>
  runAsUser(randomUUID(), async () => {
    await withoutInstructions(store);
    resetDnd();
    const start = Date.now() + 30 * MIN;
    const end = start + 2 * 60 * MIN;
    const rec = await store.createRecommendation({
      goal_id: null,
      title: "Do Not Disturb today, 11:00 to 13:00.",
      rationale: "Test.",
      action: {
        kind: "do_not_disturb",
        payload: {
          start_at: new Date(start).toISOString(),
          end_at: new Date(end).toISOString(),
          window: WINDOW_MARK,
        },
        involves_others: false,
        undo_until: new Date(end).toISOString(),
      },
      source: "analysis",
    });
    await executeRecommendation(rec.id);
    assert.equal(await activeDnd(), null, "not on before its hour");
    assert.deepEqual(await activeDnd(start + MIN), { id: rec.id, until: new Date(end).toISOString() });
    // After a restart the same answer comes back from the recommendations.
    resetDnd();
    assert.equal(await activeDnd(), null);
    assert.equal((await activeDnd(start + MIN))?.id, rec.id);
    await undoRecommendation(rec.id);
    assert.equal(await activeDnd(start + MIN), null);
    resetDnd();
  }));
