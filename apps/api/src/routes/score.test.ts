import assert from "node:assert/strict";
import { test } from "node:test";
import { Score } from "@michael/shared";
import { app } from "../app";
import { calendar } from "../patterns/testkit";
import type { TimelineFilter } from "../store";
import { readAllEvents } from "./score";

const auth = { Authorization: "Bearer dev-key" };
const get = (query = "") => app.request(`/v1/score${query}`, { headers: auth });
const enc = encodeURIComponent;

test("GET /v1/score needs the API key", async () => {
  const res = await app.request("/v1/score");
  assert.equal(res.status, 401);
});

test("GET /v1/score defaults to today in Athens and returns a valid score", async () => {
  const res = await get();
  assert.equal(res.status, 200);
  const body = Score.parse(await res.json());
  assert.equal(body.timezone, "Europe/Athens");
  assert.equal(body.days.length, 7);
  assert.ok(body.days.some((d) => d.date === body.date));
  assert.equal(body.day.date, body.date);
});

test("GET /v1/score scores the mock day: the gym hour is a block, the call with other people is not", async () => {
  // The in-memory store holds the mock day (14 November 2026). Scored as it stood at 20:00.
  const res = await get(`?date=2026-11-14&now=${enc("2026-11-14T20:00:00+02:00")}`);
  assert.equal(res.status, 200);
  const body = Score.parse(await res.json());
  assert.equal(body.week_start, "2026-11-08T22:00:00.000Z");
  assert.deepEqual(
    body.day.blocks.map((b) => [b.title, b.matched_by, b.planned_minutes, b.spent_minutes]),
    [["Gym: upper body", "calendar_titles", 60, 60]],
  );
  assert.equal(body.day.unverified_minutes, 60);
  assert.equal(body.day.score_pct, 100);
  assert.equal(body.day.time_won_back.reason?.startsWith("not enough history"), true);
  // Sleep is listed with its budget, outside the score.
  const sleep = body.goals.find((g) => g.category === "rest");
  assert.equal(sleep?.scored, false);
  assert.equal(sleep?.budget_minutes, 3150);

  // The same day at 09:00: nothing has elapsed, so there is no score yet.
  const early = Score.parse(
    await (await get(`?date=2026-11-14&now=${enc("2026-11-14T09:00:00+02:00")}`)).json(),
  );
  assert.equal(early.day.score_pct, null);
  assert.equal(early.day.ahead_minutes, 60);

  // `week` is the old name of `date`.
  const byWeek = Score.parse(await (await get("?week=2026-11-10")).json());
  assert.equal(byWeek.date, "2026-11-10");
  assert.equal(byWeek.week_start, "2026-11-08T22:00:00.000Z");
});

test("GET /v1/score rejects a bad date or instant", async () => {
  for (const query of ["?date=today", "?date=2026-02-30", "?date=2026-11-14T10:00:00Z", "?now=yesterday"]) {
    const res = await get(query);
    assert.equal(res.status, 400, query);
    const error = (await res.json()) as { error: { code: string } };
    assert.equal(error.error.code, "bad_request", query);
  }
});

test("the reader gets every event from a store that caps the rows of one query", async () => {
  // 3,500 one minute events, and a store that never returns more than 1,000 rows, oldest first.
  const first = Date.parse("2026-11-09T00:00:00+02:00");
  const at = (ms: number) => new Date(ms).toISOString();
  const all = Array.from({ length: 3500 }, (_, i) =>
    calendar("Block", at(first + i * 60_000), at(first + (i + 1) * 60_000)),
  );
  let queries = 0;
  const capped = async (f: TimelineFilter) => {
    queries++;
    const from = Date.parse(f.from);
    const to = Date.parse(f.to);
    return all
      .filter((e) => Date.parse(e.start_at) <= to && Date.parse(e.end_at ?? e.start_at) >= from)
      .slice(0, 1000);
  };
  const read = await readAllEvents(capped, first, first + 7 * 24 * 3600_000, ["calendar_event"]);
  assert.equal(read.length, 3500);
  assert.equal(new Set(read.map((e) => e.id)).size, 3500);
  assert.ok(queries >= 4 && queries <= 6, `${queries} queries`);

  // A page that brings nothing new ends the loop instead of spinning.
  const stuck = async () => all.slice(0, 1000);
  assert.equal((await readAllEvents(stuck, first, first + 3600_000, ["calendar_event"])).length, 1000);
});
