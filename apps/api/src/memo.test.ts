import assert from "node:assert/strict";
import { test } from "node:test";
import { Score } from "@michael/shared";
import { app } from "./app";
import { runAsUser } from "./context";
import { env } from "./env";
import { memo, memoStats, resetMemo } from "./memo";
import { store } from "./store";

// The per user memo of computed results (#298): reused until the user writes, never across users.

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const auth = { Authorization: "Bearer dev-key" };

test("memo reuses a result until the user writes, and never shares it with another user", async () => {
  resetMemo();
  let runs = 0;
  const compute = async () => ({ run: ++runs });
  const read = (user: string) => runAsUser(user, () => memo("t", { x: 1 }, 60_000, compute));

  assert.deepEqual(await read(A), { run: 1 });
  assert.deepEqual(await read(A), { run: 1 }, "reused");
  assert.deepEqual(await read(B), { run: 2 }, "another user computes their own");

  // A write through the store, as user A: A's next read computes again, B's does not.
  await runAsUser(A, () => store.createGoal({ category: "work", title: "Memo test", active: true }));
  assert.deepEqual(await read(A), { run: 3 });
  assert.deepEqual(await read(B), { run: 2 });

  // Other args are another entry; each caller gets its own copy.
  const one = await runAsUser(A, () => memo("t", { x: 2 }, 60_000, compute));
  one.run = 99;
  assert.deepEqual(await runAsUser(A, () => memo("t", { x: 2 }, 60_000, compute)), { run: 4 });
});

test("memo shares one computation in flight, expires, and never keeps a failure", async () => {
  resetMemo();
  let runs = 0;
  const slow = () => new Promise<number>((r) => setTimeout(() => r(++runs), 20));
  const [x, y] = await runAsUser(A, () =>
    Promise.all([memo("s", null, 60_000, slow), memo("s", null, 60_000, slow)]),
  );
  assert.deepEqual([x, y, runs], [1, 1, 1]);

  // Time to live 0: always computed again.
  await runAsUser(A, () => memo("s", null, 0, slow));
  assert.equal(runs, 2);

  let fail = true;
  const flaky = async () => {
    if (fail) throw new Error("down");
    return "ok";
  };
  await assert.rejects(runAsUser(A, () => memo("f", null, 60_000, flaky)));
  fail = false;
  assert.equal(await runAsUser(A, () => memo("f", null, 60_000, flaky)), "ok");
});

test("a write that lands while a result is computed leaves that result stale", async () => {
  resetMemo();
  let runs = 0;
  const compute = async () => {
    const run = ++runs;
    if (run === 1)
      await runAsUser(A, () => store.createGoal({ category: "gym", title: "Mid write", active: true }));
    return run;
  };
  assert.equal(await runAsUser(A, () => memo("w", null, 60_000, compute)), 1);
  assert.equal(await runAsUser(A, () => memo("w", null, 60_000, compute)), 2);
  assert.equal(await runAsUser(A, () => memo("w", null, 60_000, compute)), 2);
});

test("GET /v1/score is reused until a goal changes, and a replay is always computed", async () => {
  resetMemo();
  const score = async (query = "") =>
    Score.parse(await (await app.request(`/v1/score${query}`, { headers: auth })).json());
  const first = await score();
  await score();
  const afterTwo = memoStats();
  assert.equal(afterTwo.hits, 1, "the second read is the memo");

  const title = `Memo goal ${Date.now()}`;
  await runAsUser(env.DEMO_USER_ID, () =>
    store.createGoal({ category: "work", title, weekly_budget_minutes: 120, active: true }),
  );
  const fresh = await score();
  assert.equal(memoStats().misses, afterTwo.misses + 1, "the write is seen by the very next read");
  assert.ok(fresh.goals.some((g) => g.title === title));
  assert.ok(!first.goals.some((g) => g.title === title));

  // A replay at another instant never uses (or fills) the memo.
  const before = memoStats();
  await score(`?date=2026-11-14&now=${encodeURIComponent("2026-11-14T20:00:00+02:00")}`);
  assert.deepEqual([memoStats().hits, memoStats().misses], [before.hits, before.misses]);
});
