import assert from "node:assert/strict";
import { test } from "node:test";
import { Instruction, mockInstructions, Score } from "@michael/shared";
import { z } from "zod";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { store } from "../store";

// Standing instructions over HTTP, against the in-memory store (one copy per user, seeded with
// the mock "Keep Sundays clear").

const headers = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const List = z.object({ instructions: z.array(Instruction) });
const list = async () => List.parse(await (await call("GET", "/v1/instructions")).json()).instructions;
const create = async (body: unknown) => {
  const res = await call("POST", "/v1/instructions", body);
  assert.equal(res.status, 201);
  return Instruction.parse(await res.json());
};
const SOMEONE_ELSE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

test("instructions need the API key", async () => {
  assert.equal((await app.request("/v1/instructions")).status, 401);
  assert.equal((await app.request("/v1/instructions", { method: "POST", body: "{}" })).status, 401);
});

test("instructions: create, list, change, pause and delete", async () => {
  // The mock rule is there from the start.
  assert.deepEqual(await list(), mockInstructions);

  // home_by every day: `days` and `end_time` are not set, so they are not in the answer.
  const home = await create({ text: "Home every day by 21:00", kind: "home_by", time: "21:00" });
  assert.deepEqual(Object.keys(home).sort(), [
    "active",
    "created_at",
    "id",
    "kind",
    "text",
    "time",
    "updated_at",
  ]);
  assert.deepEqual([home.kind, home.time, home.active], ["home_by", "21:00", true]);

  // Only words: a custom instruction, kept exactly as written.
  const words = "  Never book two calls back to back.  ";
  const custom = await create({ text: words });
  assert.deepEqual([custom.kind, custom.text], ["custom", words]);

  const quiet = await create({
    text: "Nothing between ten and seven",
    kind: "quiet_hours",
    time: "22:00",
    end_time: "07:00",
    days: [4, 0, 1],
    active: false,
  });
  assert.deepEqual([quiet.days, quiet.end_time, quiet.active], [[0, 1, 4], "07:00", false]);

  // Oldest first.
  assert.deepEqual(
    (await list()).map((i) => i.text),
    ["Keep Sundays clear", "Home every day by 21:00", words, "Nothing between ten and seven"],
  );

  // Change: weekdays only, a new time, new words.
  let res = await call("PATCH", `/v1/instructions/${home.id}`, {
    text: "Home by 20:30 on weekdays",
    time: "20:30",
    days: [1, 2, 3, 4, 5],
  });
  assert.equal(res.status, 200);
  let changed = Instruction.parse(await res.json());
  assert.deepEqual(
    [changed.id, changed.text, changed.time, changed.days, changed.created_at],
    [home.id, "Home by 20:30 on weekdays", "20:30", [1, 2, 3, 4, 5], home.created_at],
  );

  // null clears a field: back to every day.
  res = await call("PATCH", `/v1/instructions/${home.id}`, { days: null });
  changed = Instruction.parse(await res.json());
  assert.equal("days" in changed, false);
  assert.equal(changed.time, "20:30");

  // Pause and resume.
  res = await call("PATCH", `/v1/instructions/${home.id}`, { active: false });
  assert.equal(Instruction.parse(await res.json()).active, false);
  assert.equal((await list()).find((i) => i.id === home.id)?.active, false);
  res = await call("PATCH", `/v1/instructions/${home.id}`, { active: true });
  assert.equal(Instruction.parse(await res.json()).active, true);

  // An empty change is allowed and changes nothing.
  res = await call("PATCH", `/v1/instructions/${custom.id}`, {});
  assert.equal(res.status, 200);
  assert.equal(Instruction.parse(await res.json()).text, words);

  // Delete.
  assert.equal((await call("DELETE", `/v1/instructions/${custom.id}`)).status, 204);
  assert.equal((await call("DELETE", `/v1/instructions/${custom.id}`)).status, 404);
  assert.equal((await call("PATCH", `/v1/instructions/${custom.id}`, { active: false })).status, 404);
  assert.equal(
    (await list()).some((i) => i.id === custom.id),
    false,
  );

  await call("DELETE", `/v1/instructions/${home.id}`);
  await call("DELETE", `/v1/instructions/${quiet.id}`);
  assert.deepEqual(await list(), mockInstructions);
});

test("instructions: a kind must have what it needs, on create and after a change", async () => {
  const bad = async (body: unknown) => {
    const res = await call("POST", "/v1/instructions", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "bad_request");
  };
  await bad({});
  await bad({ text: "   " });
  await bad({ text: "x", kind: "protected" });
  await bad({ text: "Keep Sundays clear", kind: "clear_day" }); // no days
  await bad({ text: "Keep Sundays clear", kind: "clear_day", days: [] });
  await bad({ text: "Keep Sundays clear", kind: "clear_day", days: [7] });
  await bad({ text: "Home by nine", kind: "home_by" }); // no time
  await bad({ text: "Home by nine", kind: "home_by", time: "9pm" });
  await bad({ text: "Home by nine", kind: "home_by", time: "24:00" });
  await bad({ text: "Quiet", kind: "quiet_hours", time: "22:00" }); // no end
  assert.equal((await call("POST", "/v1/instructions", "not json")).status, 400);

  const [sundays] = mockInstructions;
  assert.ok(sundays);
  const path = `/v1/instructions/${sundays.id}`;
  // A clear day cannot lose its days, and cannot become a kind it has no time for.
  assert.equal((await call("PATCH", path, { days: null })).status, 400);
  assert.equal((await call("PATCH", path, { kind: "home_by" })).status, 400);
  assert.equal((await call("PATCH", path, { text: "" })).status, 400);
  assert.equal((await call("PATCH", path, { days: [0, 9] })).status, 400);
  // With the time it needs, the change of kind goes through; then back again.
  const res = await call("PATCH", path, { kind: "home_by", time: "18:00" });
  assert.equal(res.status, 200);
  assert.equal(Instruction.parse(await res.json()).kind, "home_by");
  assert.equal((await call("PATCH", path, { kind: "clear_day", time: null })).status, 200);
  assert.deepEqual(await list(), [{ ...sundays, updated_at: (await list())[0]?.updated_at }]);
});

test("instructions: another user's instruction is invisible and cannot be changed or deleted", async () => {
  const theirs = await runAsUser(SOMEONE_ELSE, () =>
    store.createInstruction({ text: "Fridays are for family", kind: "clear_day", days: [5], active: true }),
  );
  // The demo account does not see it, in the list or by id.
  assert.equal(
    (await list()).some((i) => i.id === theirs.id),
    false,
  );
  assert.equal((await call("PATCH", `/v1/instructions/${theirs.id}`, { active: false })).status, 404);
  assert.equal((await call("DELETE", `/v1/instructions/${theirs.id}`)).status, 404);
  // The store itself refuses across users, whatever the route does.
  assert.equal(
    await runAsUser(env.DEMO_USER_ID, () => store.updateInstruction(theirs.id, { active: false })),
    null,
  );
  assert.equal(await runAsUser(env.DEMO_USER_ID, () => store.deleteInstruction(theirs.id)), false);
  // It is still there, untouched, for its owner; and the owner does not see the demo account's.
  const own = await runAsUser(SOMEONE_ELSE, () => store.listInstructions());
  assert.deepEqual(
    own.filter((i) => i.id === theirs.id),
    [theirs],
  );
  const mine = await create({ text: "Mine only", kind: "custom" });
  const ownAfter = await runAsUser(SOMEONE_ELSE, () => store.listInstructions());
  assert.equal(
    ownAfter.some((i) => i.id === mine.id),
    false,
  );
  await call("DELETE", `/v1/instructions/${mine.id}`);
});

test("GET /v1/score flags a block planned on a clear Sunday", async () => {
  // The mock training goal counts "Gym"; the mock instruction keeps Sundays clear.
  const res = await call("POST", "/v1/events", {
    source: "google_calendar",
    type: "calendar_event",
    start_at: "2026-11-15T10:00:00+02:00",
    end_at: "2026-11-15T11:00:00+02:00",
    title: "Gym",
    data: { attendees: 0 },
    external_id: "instructions-test-sunday-gym",
  });
  assert.equal(res.status, 201);
  const score = Score.parse(
    await (
      await call("GET", `/v1/score?date=2026-11-15&now=${encodeURIComponent("2026-11-15T12:00:00+02:00")}`)
    ).json(),
  );
  assert.deepEqual(
    score.day.blocks.map((b) => [b.title, b.instructions_broken]),
    [["Gym", [mockInstructions[0]?.id]]],
  );
  // Pausing the instruction lifts the flag; the minutes never moved.
  const id = mockInstructions[0]?.id;
  await call("PATCH", `/v1/instructions/${id}`, { active: false });
  const paused = Score.parse(
    await (
      await call("GET", `/v1/score?date=2026-11-15&now=${encodeURIComponent("2026-11-15T12:00:00+02:00")}`)
    ).json(),
  );
  assert.deepEqual(paused.day.blocks[0]?.instructions_broken, []);
  assert.equal(paused.day.spent_minutes, score.day.spent_minutes);
  await call("PATCH", `/v1/instructions/${id}`, { active: true });
});
