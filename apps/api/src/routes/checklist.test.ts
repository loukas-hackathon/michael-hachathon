import assert from "node:assert/strict";
import { test } from "node:test";
import { ChecklistCarryResponse, ChecklistItem, ChecklistResponse, type Goal } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { store } from "../store";

// The day's outcomes over HTTP (#238), against the in-memory store as the demo account.

const headers = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const SOMEONE_ELSE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
// Days far from the real clock, so the offers the POST makes for today never get in the way.
let dayIndex = 0;
const freshDay = () => `2027-02-${String(++dayIndex).padStart(2, "0")}`;

async function checklistGoal(title = "Today's outcomes"): Promise<Goal> {
  const res = await call("POST", "/v1/goals", {
    category: "business",
    title,
    target: { kind: "checklist" },
  });
  assert.equal(res.status, 201);
  return (await res.json()) as Goal;
}

const add = async (body: unknown, status = 201) => {
  const res = await call("POST", "/v1/checklist", body);
  assert.equal(res.status, status, await res.clone().text());
  return res.status === 201 ? ChecklistItem.parse(await res.json()) : null;
};
const day = async (date: string) =>
  ChecklistResponse.parse(await (await call("GET", `/v1/checklist?date=${date}`)).json());

test("checklist needs the API key", async () => {
  assert.equal((await app.request("/v1/checklist")).status, 401);
});

test("create, list, tick, edit and delete the day's items", async () => {
  const goal = await checklistGoal();
  const date = freshDay();
  const a = await add({ goal_id: goal.id, date, text: "  Send the term sheet " });
  assert.ok(a);
  assert.deepEqual(
    [a.text, a.position, a.status, a.settled_at, a.settled_by, a.carried_from],
    ["Send the term sheet", 0, "open", null, null, null],
  );
  const b = await add({ goal_id: goal.id, date, text: "Call the bank" });
  assert.equal(b?.position, 1);

  let list = await day(date);
  assert.equal(list.date, date);
  assert.deepEqual(
    list.items.map((i) => i.text),
    ["Send the term sheet", "Call the bank"],
  );

  // Ticked by the user.
  const done = ChecklistItem.parse(
    await (await call("PATCH", `/v1/checklist/${a.id}`, { status: "done" })).json(),
  );
  assert.equal(done.status, "done");
  assert.equal(done.settled_by, "user");
  assert.ok(done.settled_at);
  // Reopened: settled is cleared.
  const reopened = ChecklistItem.parse(
    await (
      await call("PATCH", `/v1/checklist/${a.id}`, { status: "open", text: "Send the signed term sheet" })
    ).json(),
  );
  assert.deepEqual(
    [reopened.status, reopened.settled_at, reopened.settled_by, reopened.text],
    ["open", null, null, "Send the signed term sheet"],
  );

  assert.equal((await call("DELETE", `/v1/checklist/${b?.id}`)).status, 204);
  assert.equal((await call("DELETE", `/v1/checklist/${b?.id}`)).status, 404);
  list = await day(date);
  assert.deepEqual(
    list.items.map((i) => i.id),
    [a.id],
  );
});

test("validation: a checklist goal, real text, a real day; moved is not set by hand", async () => {
  const goal = await checklistGoal();
  const date = freshDay();
  // A time goal (the demo account's sample deep work goal) is not a checklist goal.
  await add({ goal_id: "10000000-0000-4000-8000-000000000001", date, text: "x" }, 400);
  await add({ goal_id: "7c9e6679-7425-40de-944b-e07fc1f90ae0", date, text: "x" }, 404);
  await add({ goal_id: goal.id, date, text: "   " }, 400);
  await add({ goal_id: goal.id, date, text: "x".repeat(201) }, 400);
  await add({ goal_id: goal.id, date: "2027-02-30", text: "x" }, 400);
  assert.equal((await call("GET", "/v1/checklist?date=2027-13-01")).status, 400);

  const item = await add({ goal_id: goal.id, date, text: "One" });
  assert.equal((await call("PATCH", `/v1/checklist/${item?.id}`, { status: "moved" })).status, 400);
  assert.equal((await call("PATCH", `/v1/checklist/${item?.id}`, {})).status, 400);
  assert.equal((await call("PATCH", "/v1/checklist/not-a-uuid", { status: "done" })).status, 404);
});

test("at most three open items per goal and day: the fourth is a 409", async () => {
  const goal = await checklistGoal();
  const other = await checklistGoal("Side project");
  const date = freshDay();
  const items = [];
  for (const text of ["One", "Two", "Three"]) items.push(await add({ goal_id: goal.id, date, text }));
  assert.deepEqual(
    items.map((i) => i?.position),
    [0, 1, 2],
  );
  await add({ goal_id: goal.id, date, text: "Four" }, 409);
  // Another goal and another day have their own three.
  await add({ goal_id: other.id, date, text: "Elsewhere" });
  await add({ goal_id: goal.id, date: freshDay(), text: "Tomorrow" });

  // Done frees a slot; the new item takes the lowest free one.
  await call("PATCH", `/v1/checklist/${items[1]?.id}`, { status: "done" });
  const four = await add({ goal_id: goal.id, date, text: "Four" });
  assert.equal(four?.position, 1);
  // And now reopening the done one would make four open: refused.
  assert.equal((await call("PATCH", `/v1/checklist/${items[1]?.id}`, { status: "open" })).status, 409);
});

test("carry moves an open item to the next day, and yesterday's open items are suggestions", async () => {
  const goal = await checklistGoal();
  const date = freshDay();
  const next = `2027-02-${String(Number(date.slice(-2)) + 1).padStart(2, "0")}`;
  dayIndex++; // `next` is used here
  const open = await add({ goal_id: goal.id, date, text: "Hire the designer" });
  const done = await add({ goal_id: goal.id, date, text: "Pay the invoice" });
  await call("PATCH", `/v1/checklist/${done?.id}`, { status: "done" });

  // The next day suggests what is still open, nothing else.
  let tomorrow = await day(next);
  assert.deepEqual(
    tomorrow.suggestions.map((i) => i.id),
    [open?.id],
  );

  const res = await call("POST", `/v1/checklist/${open?.id}/carry`);
  assert.equal(res.status, 201);
  const carried = ChecklistCarryResponse.parse(await res.json());
  assert.deepEqual([carried.moved.status, carried.moved.settled_by], ["moved", "user"]);
  assert.deepEqual(
    [carried.item.date, carried.item.text, carried.item.status, carried.item.carried_from],
    [next, "Hire the designer", "open", open?.id],
  );
  tomorrow = await day(next);
  assert.deepEqual(tomorrow.suggestions, []);
  assert.deepEqual(
    tomorrow.items.map((i) => i.id),
    [carried.item.id],
  );

  // Only an open item can be carried, and a moved one is not changed by hand.
  assert.equal((await call("POST", `/v1/checklist/${open?.id}/carry`)).status, 409);
  assert.equal((await call("POST", `/v1/checklist/${done?.id}/carry`)).status, 409);
  assert.equal((await call("PATCH", `/v1/checklist/${open?.id}`, { status: "done" })).status, 409);
});

test("another user's items are invisible and untouchable", async () => {
  const goal = await checklistGoal();
  const date = freshDay();
  const mine = await add({ goal_id: goal.id, date, text: "Mine" });
  await runAsUser(SOMEONE_ELSE, async () => {
    assert.deepEqual(await store.listChecklist({ from: date, to: date }), []);
    assert.equal(await store.getChecklistItem(mine?.id ?? ""), null);
    assert.equal(await store.updateChecklistItem(mine?.id ?? "", { text: "Theirs" }), null);
    assert.equal(await store.deleteChecklistItem(mine?.id ?? ""), false);
  });
  const list = await day(date);
  assert.equal(list.items[0]?.text, "Mine");
  // Deleting the goal deletes its items, as the foreign key does.
  assert.equal((await call("DELETE", `/v1/goals/${goal.id}`)).status, 204);
  assert.deepEqual((await day(date)).items, []);
});

test("deleting the account deletes the checklist", async () => {
  await runAsUser(SOMEONE_ELSE, async () => {
    const goal = await store.createGoal({
      category: "business",
      title: "Outcomes",
      target: { kind: "checklist" },
      active: true,
    });
    await store.createChecklistItem({ goal_id: goal.id, date: "2027-03-01", text: "One", position: 0 });
    const counts = await store.deleteMyData({ everything: true });
    assert.equal(counts.checklist_items, 1);
    assert.deepEqual(await store.listChecklist({ from: "2027-01-01", to: "2027-12-31" }), []);
  });
});
