import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Goal, Recommendation } from "@michael/shared";
import { runAsUser } from "../context";
import { buildScore } from "../score";
import { store } from "../store";
import { addItem } from "./items";
import { OUTCOME_TITLE, offerGoalActions, sessionTitle } from "./offers";

// Michael's two actions for checklist and count goals (#238): stored offers, made once a day,
// through the store's createRecommendation and so through the instruction guard. Never executed.

const at = (day: string, time: string) => Date.parse(`2026-11-${day}T${time}:00+02:00`);
const FRIDAY = at("13", "09:50");
const SUNDAY = at("15", "09:50");

const asNewUser = <T>(fn: () => Promise<T>) => runAsUser(randomUUID(), fn);
/** No sample day, no standing instructions: only what the test adds. */
const empty = () => store.deleteMyData({ everything: true });

async function goals() {
  const outcomes = await store.createGoal({
    category: "business",
    title: "Today's outcomes",
    target: { kind: "checklist" },
    active: true,
  });
  const gym = await store.createGoal({
    category: "health",
    title: "Gym",
    target: { kind: "count", per_week: 4, calendar_titles: ["Gym"] },
    active: true,
  });
  return { outcomes, gym };
}

/** The score's goal rows at `now`, as GET /v1/score hands them to the offers. */
async function rows(now: number) {
  const date = new Date(now).toISOString().slice(0, 10);
  const events = await store.listEvents({ from: "2026-11-09T00:00:00Z", to: "2026-11-16T00:00:00Z" });
  return buildScore(events, await store.listGoals(), { date, now: new Date(now).toISOString() }).goals;
}

const ours = async (titles: string[]): Promise<Recommendation[]> =>
  (await store.listRecommendations()).filter((r) => titles.includes(r.title));

test("the first open outcome of today gets one offered hour, once a day, never executed", () =>
  asNewUser(async () => {
    await empty();
    const { outcomes } = await goals();
    // A meeting at 10:00 pushes the hour to 11:30.
    await store.insertEvents([
      {
        source: "google_calendar",
        type: "calendar_event",
        start_at: "2026-11-13T10:00:00+02:00",
        end_at: "2026-11-13T11:30:00+02:00",
        title: "Investor call",
        data: { attendees: 2 },
      },
    ]);
    // An item for another day is not today's.
    await addItem({ goal_id: outcomes.id, date: "2026-11-14", text: "Tomorrow's thing" }, FRIDAY);
    assert.deepEqual(await offerGoalActions({ now: FRIDAY }), []);

    const first = await addItem(
      { goal_id: outcomes.id, date: "2026-11-13", text: "Send the term sheet" },
      FRIDAY,
    );
    await addItem({ goal_id: outcomes.id, date: "2026-11-13", text: "Call the bank" }, FRIDAY);
    const made = await offerGoalActions({ now: FRIDAY });
    assert.equal(made.length, 1);
    const offer = made[0];
    assert.ok(offer?.action);
    // No date: the card's line above it already says "Today, 11:30 to 12:30".
    assert.equal(offer.title, "An hour for your first outcome");
    assert.equal(offer.goal_id, first.goal_id);
    assert.deepEqual(
      [offer.status, offer.executed_at, offer.action.kind, offer.action.involves_others],
      ["proposed", null, "create_focus_block", false],
    );
    assert.deepEqual(offer.action.payload, {
      start_at: "2026-11-13T09:30:00.000Z",
      end_at: "2026-11-13T10:30:00.000Z",
      title: "Send the term sheet",
      offer_key: "first_outcome:2026-11-13",
    });
    assert.equal(offer.action.undo_until, "2026-11-13T09:30:00.000Z");
    assert.match(offer.rationale, /"Send the term sheet" is still open\. I found 60 minutes free\. One tap/);

    // Once a day, whatever happens to it.
    await store.updateRecommendationStatus(offer.id, "dismissed");
    assert.deepEqual(await offerGoalActions({ now: FRIDAY + 3_600_000 }), []);
    assert.equal((await ours([offer.title])).length, 1);
  }));

test("a count goal behind pace gets one offered slot, once a day", () =>
  asNewUser(async () => {
    await empty();
    const { gym } = await goals();
    // Four a week, none yet, Friday morning: 4 left, 3 days left. Today already has a Gym block,
    // so the slot goes to Saturday.
    await store.insertEvents([
      {
        source: "google_calendar",
        type: "calendar_event",
        start_at: "2026-11-13T18:00:00+02:00",
        end_at: "2026-11-13T19:30:00+02:00",
        title: "Gym",
        data: { attendees: 0 },
      },
    ]);
    const made = await offerGoalActions({ now: FRIDAY, rows: await rows(FRIDAY) });
    assert.equal(made.length, 1);
    const offer = made[0];
    assert.equal(offer?.title, "One more session for Gym");
    assert.equal(offer?.goal_id, gym.id);
    // The goal's usual length (90 minutes), from 07:00 on Saturday, titled so it counts.
    assert.deepEqual(offer?.action?.payload, {
      start_at: "2026-11-14T05:00:00.000Z",
      end_at: "2026-11-14T06:30:00.000Z",
      title: "Gym",
      goal_id: gym.id,
      offer_key: `count_session:${gym.id}:2026-11-13`,
    });
    assert.equal(
      offer?.rationale,
      "0 of 4 done, 4 left and 3 days to go. I found 90 minutes free. One tap books it, and you can undo it until it starts.",
    );
    assert.deepEqual(await offerGoalActions({ now: FRIDAY, rows: await rows(FRIDAY) }), []);

    // On pace: nothing. Without the score's rows the count offer is not considered.
    await store.updateGoal(gym.id, { target: { kind: "count", per_week: 1, calendar_titles: ["Gym"] } });
    assert.deepEqual(
      await offerGoalActions({ now: at("14", "09:00"), rows: await rows(at("14", "09:00")) }),
      [],
    );
    assert.deepEqual(await offerGoalActions({ now: FRIDAY }), []);
  }));

test("a clear Sunday gets no offer: nothing to book, so nothing is said", () =>
  asNewUser(async () => {
    // The memory store starts every user with the mock "Keep Sundays clear".
    const rules = await store.listInstructions();
    assert.ok(rules.some((i) => i.kind === "clear_day" && i.days?.includes(0)));
    const { outcomes, gym } = await goals();
    await addItem({ goal_id: outcomes.id, date: "2026-11-15", text: "Plan the week" }, SUNDAY);
    assert.deepEqual(await offerGoalActions({ now: SUNDAY, rows: await rows(SUNDAY) }), []);
    assert.deepEqual(await ours([OUTCOME_TITLE, sessionTitle(gym as Goal)]), []);
  }));

test("a count goal's slot skips a protected day and an exception by title is allowed in", () =>
  asNewUser(async () => {
    // Saturday morning with the mock "Keep Sundays clear": 4 left, 2 days left, Saturday already
    // has a Gym block, Sunday is protected, so there is no offer.
    const { gym } = await goals();
    await store.insertEvents([
      {
        source: "google_calendar",
        type: "calendar_event",
        start_at: "2026-11-14T18:00:00+02:00",
        end_at: "2026-11-14T19:00:00+02:00",
        title: "Gym",
        data: { attendees: 0 },
      },
    ]);
    const saturday = at("14", "09:00");
    assert.deepEqual(await offerGoalActions({ now: saturday, rows: await rows(saturday) }), []);
    // With Gym named as an exception, Sunday is open to it.
    const sundays = (await store.listInstructions()).find((i) => i.kind === "clear_day");
    assert.ok(sundays);
    await store.updateInstruction(sundays.id, { exceptions: ["Gym"] });
    const made = await offerGoalActions({ now: saturday, rows: await rows(saturday) });
    assert.equal(made.length, 1);
    assert.equal(made[0]?.title, sessionTitle(gym));
    assert.ok(made[0]?.action);
    assert.equal(String(made[0]?.action?.payload.start_at).slice(0, 10), "2026-11-15");
  }));

test("an offer for an outcome that is ticked or gone is withdrawn", () =>
  asNewUser(async () => {
    await empty();
    const { outcomes } = await goals();
    const first = await addItem(
      { goal_id: outcomes.id, date: "2026-11-13", text: "Send the term sheet" },
      FRIDAY,
    );
    const [offer] = await offerGoalActions({ now: FRIDAY });
    assert.equal(offer?.status, "proposed");
    // Still open: the offer stays.
    await offerGoalActions({ now: FRIDAY + 60_000 });
    assert.equal((await ours([outcomeTitle("2026-11-13")]))[0]?.status, "proposed");
    // Ticked: the next look withdraws it, and it is not offered again that day.
    await store.updateChecklistItem(first.id, {
      status: "done",
      settled_at: new Date(FRIDAY).toISOString(),
      settled_by: "user",
    });
    assert.deepEqual(await offerGoalActions({ now: FRIDAY + 120_000 }), []);
    const after = await ours([outcomeTitle("2026-11-13")]);
    assert.equal(after.length, 1);
    assert.equal(after[0]?.status, "dismissed");
  }));

test("two reads at once store one offer", () =>
  asNewUser(async () => {
    await empty();
    const { outcomes } = await goals();
    await addItem({ goal_id: outcomes.id, date: "2026-11-13", text: "Send the term sheet" }, FRIDAY);
    const [a, b] = await Promise.all([offerGoalActions({ now: FRIDAY }), offerGoalActions({ now: FRIDAY })]);
    assert.equal(a.length + b.length, 1);
    assert.equal((await ours([OUTCOME_TITLE])).length, 1);
  }));

test("no checklist or count goal: nothing is read or offered", () =>
  asNewUser(async () => {
    const before = (await store.listRecommendations()).length;
    assert.deepEqual(await offerGoalActions({ now: FRIDAY }), []);
    assert.equal((await store.listRecommendations()).length, before);
  }));

test("the same offer is made again the next day, and one stored with a dated title still counts", () =>
  asNewUser(async () => {
    await empty();
    const { outcomes } = await goals();
    await addItem({ goal_id: outcomes.id, date: "2026-11-13", text: "Send the term sheet" }, FRIDAY);
    await addItem({ goal_id: outcomes.id, date: "2026-11-14", text: "Plan the pitch" }, FRIDAY);
    assert.equal((await offerGoalActions({ now: FRIDAY })).length, 1);
    // Same title, a new day: a new offer.
    const next = await offerGoalActions({ now: at("14", "09:00") });
    assert.equal(next.length, 1);
    assert.equal(next[0]?.title, OUTCOME_TITLE);
    assert.equal(next[0]?.action?.payload.offer_key, "first_outcome:2026-11-14");
  }));

test("an offer stored before the key, with the day in its title, still counts for that day", () =>
  asNewUser(async () => {
    await empty();
    const { outcomes } = await goals();
    await store.createRecommendation({
      goal_id: outcomes.id,
      title: "An hour for your first outcome, Fri 13 Nov",
      rationale: "Made before.",
      action: null,
      source: "analysis",
    });
    await addItem({ goal_id: outcomes.id, date: "2026-11-13", text: "Send the term sheet" }, FRIDAY);
    assert.deepEqual(await offerGoalActions({ now: FRIDAY }), []);
  }));
