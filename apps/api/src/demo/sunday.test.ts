import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { DEMO_RECOMMENDATION_IDS, type Recommendation } from "@michael/shared";

// The finals demo runs on Sunday 15 November at 20:00 in Athens, on the demo account after a
// reseed. "Keep Sundays clear" in the plan made Book on Goals answer "No free 90 minutes left this
// week" and Do it refuse a Sunday block. The plan's standing instructions must leave a Sunday
// evening bookable: this books, undoes and carries out exactly what the stage does.

const SUNDAY_20_ATHENS = Date.parse("2026-11-15T18:00:00Z");
mock.timers.enable({ apis: ["Date"], now: SUNDAY_20_ATHENS });

const { app } = await import("../app");
const { runAsUser } = await import("../context");
const { env } = await import("../env");
const { store } = await import("../store");
const { seedDemoWeek } = await import("./sync");
const { demoGoals, demoInstructions } = await import("./week");

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const asDemo = <T>(fn: () => Promise<T>) => runAsUser(env.DEMO_USER_ID, fn, "api_key");
const post = (path: string, body?: unknown) =>
  app.request(path, { method: "POST", headers: auth, body: body ? JSON.stringify(body) : undefined });
const weekday = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "short" }).format(ms);

await asDemo(() => seedDemoWeek(store, { overwriteGoals: true, now: new Date(SUNDAY_20_ATHENS) }));

test("the reseed gives the demo the plan's instructions, none of them on a weekend day", async () => {
  const instructions = await asDemo(() => store.listInstructions());
  assert.deepEqual(
    instructions.map((i) => i.text),
    demoInstructions.map((i) => i.text),
  );
  for (const i of instructions) assert.notEqual(i.kind, "clear_day", `${i.text} clears a whole day`);
});

test("demo Book at Sunday 20:00: 90 minutes land on Sunday evening, and undo works", async () => {
  const goal = demoGoals.find((g) => g.title === "University") ?? demoGoals[0];
  const res = await post(`/v1/goals/${goal?.id}/book`, { minutes: 90 });
  const body = (await res.json()) as Recommendation & { error?: { message: string } };
  assert.ok(res.ok, `Book answered ${res.status}: ${body.error?.message}`);
  const start = Date.parse(String(body.action?.payload.start_at));
  assert.ok(start > SUNDAY_20_ATHENS, "the block starts after now");
  assert.equal(weekday(start), "Sun");
  assert.equal((await post(`/v1/recommendations/${body.id}/undo`)).status, 200);
});

test("demo Do it at Sunday 20:00: a Sunday evening block and the seeded suggestions are carried out", async () => {
  const rec = await asDemo(() =>
    store.createRecommendation({
      goal_id: demoGoals[0]?.id ?? null,
      title: "Study 21:00 to 22:30",
      rationale: "University is behind.",
      action: {
        kind: "create_focus_block",
        payload: { start_at: "2026-11-15T19:00:00.000Z", end_at: "2026-11-15T20:30:00.000Z", title: "Study" },
        involves_others: false,
        undo_until: "2026-11-15T19:00:00.000Z",
      },
    }),
  );
  const res = await post(`/v1/recommendations/${rec.id}/execute`);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(((await res.json()) as Recommendation).status, "done");

  for (const id of DEMO_RECOMMENDATION_IDS) {
    const seeded = await asDemo(() => store.getRecommendation(id));
    if (!seeded?.action || seeded.status !== "proposed" || seeded.action.involves_others) continue;
    const done = await post(`/v1/recommendations/${id}/execute`);
    assert.equal(done.status, 200, `${seeded.title}: ${await done.clone().text()}`);
  }
});
