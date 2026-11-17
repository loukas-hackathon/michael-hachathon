import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { Traction, type WaitlistEntry } from "@michael/shared";
import { Hono } from "hono";
import { isAdmin, isAdminEmail } from "../admin";
import { app, v1Routes } from "../app";
import { type AuthMethod, runAsUser } from "../context";
import { env } from "../env";
import { errorResponse, HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { type MemoryStore, store, type TractionUserFacts } from "../store";
import { clearTractionCache, isExcludedAccount } from ".";
import { computeTraction, median, sumGoalWeek, weekStarts } from "./compute";
import { sourceName, waitingList } from "./waiting-list";

// GET /v1/admin/traction: who may read it, who is never counted, and the maths.

const memory = store as unknown as MemoryStore;
const ADMIN = randomUUID();
const PLAIN = randomUUID();
const QUIET = randomUUID();
const JUDGES = randomUUID();
const DEMO = env.DEMO_USER_ID;

// The /v1 routes as a signed in session (Supabase tokens cannot be verified in tests), or as any
// other auth method, for the user in the x-test-user header.
const as = (via: AuthMethod) =>
  new Hono()
    .use(async (c, next) => runAsUser(c.req.header("x-test-user") as string, next, via))
    .route("/v1", v1Routes)
    .onError((err, c) =>
      err instanceof HttpError
        ? errorResponse(c, err.code, err.message)
        : errorResponse(c, "internal", String(err)),
    );
const sessions = as("session");
const get = (user: string, via: AuthMethod = "session") =>
  (via === "session" ? sessions : as(via)).request("/v1/admin/traction", {
    headers: { "x-test-user": user },
  });

memory.addAccount(ADMIN, "Founder@Example.com");
memory.addAccount(PLAIN, "someone@example.com");
memory.addAccount(QUIET, "quiet@example.com");
memory.addAccount(JUDGES, "judges@michael.app");
memory.addAccount(DEMO, "demo@michael.app");

const device = (title: string, external_id?: string) => ({
  source: "macos_usage" as const,
  type: "app_usage" as const,
  start_at: new Date(Date.now() - 600_000).toISOString(),
  end_at: new Date(Date.now() - 300_000).toISOString(),
  title,
  data: {},
  external_id: external_id ?? null,
});

// PLAIN connected a Mac today; the demo account has only seeded rows; QUIET never connected anything.
await runAsUser(PLAIN, () => store.insertEvents([device("Xcode")]));
await runAsUser(DEMO, () => store.insertEvents([device("Seeded", "demo:seed-1")]));
await runAsUser(QUIET, () => store.listGoals());

beforeEach(() => {
  env.ADMIN_EMAILS = "founder@example.com, other@example.com";
  clearTractionCache();
});

test("isAdminEmail: listed emails only, any case; empty means nobody", () => {
  assert.equal(isAdminEmail("FOUNDER@example.com"), true);
  assert.equal(isAdminEmail("someone@example.com"), false);
  assert.equal(isAdminEmail(null), false);
  env.ADMIN_EMAILS = "";
  assert.equal(isAdminEmail("founder@example.com"), false);
});

test("isAdmin: only a signed in session with an admin email", async () => {
  assert.equal(await runAsUser(ADMIN, isAdmin, "session"), true);
  assert.equal(await runAsUser(PLAIN, isAdmin, "session"), false);
  for (const via of ["api_key", "demo_visitor", "mcp_oauth", "personal_token", "script"] as const) {
    assert.equal(await runAsUser(ADMIN, isAdmin, via), false, via);
  }
  env.ADMIN_EMAILS = "";
  assert.equal(await runAsUser(ADMIN, isAdmin, "session"), false);
});

test("GET /v1/admin/traction: 404 for everyone but an admin, the same 404 as no route", async () => {
  const ok = await get(ADMIN);
  assert.equal(ok.status, 200);
  for (const res of [await get(PLAIN), await get(ADMIN, "mcp_oauth"), await get(ADMIN, "api_key")]) {
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "not_found");
    assert.match(body.error.message, /^No route for GET/);
  }
  // The API key (the demo account, demo visitors) through the real auth middleware.
  const key = await app.request("/v1/admin/traction", {
    headers: { authorization: `Bearer ${env.API_KEY}` },
  });
  assert.equal(key.status, 404);
  env.ADMIN_EMAILS = "";
  assert.equal((await get(ADMIN)).status, 404);
});

test("GET /v1/admin/traction: real users only, aggregates only", async () => {
  const res = await get(ADMIN);
  const raw = await res.text();
  const t = Traction.parse(JSON.parse(raw));
  // The demo account and the michael.app addresses are left out; the founder counts as a user.
  assert.equal(t.excluded_accounts, 2);
  assert.equal(t.sign_ups.total, 3);
  assert.equal(t.sign_ups.weeks.length, 8);
  assert.equal(t.sign_ups.weeks.at(-1)?.sign_ups, 3);
  // Only PLAIN connected a real source; the demo account's seeded Mac row never counts.
  assert.equal(t.activation.activated, 1);
  assert.equal(t.activation.median_minutes_to_first_source, 0);
  assert.equal(t.active.daily, 1);
  assert.equal(t.active.weekly, 1);
  // Nothing about any one user: no ids, no emails, no event titles.
  for (const secret of [ADMIN, PLAIN, QUIET, DEMO, "founder@", "someone@", "judges@", "Xcode", "Seeded"]) {
    assert.ok(!raw.toLowerCase().includes(secret.toLowerCase()), secret);
  }
});

test("isExcludedAccount: the demo account and michael.app addresses", () => {
  const at = new Date().toISOString();
  assert.equal(isExcludedAccount({ id: DEMO, email: null, created_at: at }), true);
  assert.equal(isExcludedAccount({ id: randomUUID(), email: "Judges@Michael.app", created_at: at }), true);
  assert.equal(isExcludedAccount({ id: randomUUID(), email: "a@gmail.com", created_at: at }), false);
  assert.equal(isExcludedAccount({ id: randomUUID(), email: null, created_at: at }), false);
});

// ---------- the maths, on a fixed week ----------

// Tuesday 17 November 2026, 12:00 in Athens. This week starts Monday 16 November.
const NOW = Date.parse("2026-11-17T10:00:00Z");
const facts = (user_id: string, f: Partial<TractionUserFacts> = {}): TractionUserFacts => ({
  user_id,
  first_source_at: null,
  active_days: [],
  actions_done: 0,
  actions_undone: 0,
  chat_messages: 0,
  nudges_sent: 0,
  ...f,
});
const goalTime = {
  this_week: sumGoalWeek("2026-11-16", []),
  last_week: sumGoalWeek("2026-11-09", []),
  users_scored: 0,
  capped: false,
};

test("weekStarts: eight Mondays, oldest first, ending with this week", () => {
  const w = weekStarts(NOW, DEFAULT_TIMEZONE);
  assert.equal(w.length, 8);
  assert.equal(w[0], "2026-09-28");
  assert.equal(w[7], "2026-11-16");
});

test("median: odd, even, empty", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("computeTraction: sign ups, activation, active users, retention and engagement", () => {
  const t = computeTraction({
    now: NOW,
    timezone: DEFAULT_TIMEZONE,
    excluded: 1,
    connectorQueries: 7,
    goalTime,
    accounts: [
      // Cohort of 19 October (4 weeks back): two people.
      { id: "a", email: null, created_at: "2026-10-19T08:00:00Z" },
      { id: "b", email: null, created_at: "2026-10-21T08:00:00Z" },
      // Cohort of 2 November: one person.
      { id: "c", email: null, created_at: "2026-11-03T08:00:00Z" },
      // This week: one person.
      { id: "d", email: null, created_at: "2026-11-16T09:00:00Z" },
    ],
    facts: [
      facts("a", {
        first_source_at: "2026-10-19T10:00:00Z", // 120 minutes after sign up
        active_days: ["2026-10-27", "2026-11-03", "2026-11-17"], // weeks 1, 2 and 4
        actions_done: 3,
        actions_undone: 1,
        chat_messages: 5,
        nudges_sent: 2,
      }),
      facts("b", {
        first_source_at: "2026-10-21T14:00:00Z", // 360 minutes
        active_days: ["2026-10-26"], // week 1 only
        chat_messages: 1,
      }),
      facts("c", {
        first_source_at: "2026-11-03T09:00:00Z", // 60 minutes
        active_days: ["2026-11-10", "2026-11-12", "2026-11-16"], // weeks 1 and 2 (2 is this week)
      }),
      facts("d", { active_days: ["2026-11-17"] }),
      // Not a real account (left out upstream): never counted.
      facts("ghost", { active_days: ["2026-11-17"], actions_done: 99 }),
    ],
  });

  assert.equal(t.sign_ups.total, 4);
  assert.deepEqual(
    t.sign_ups.weeks.map((w) => [w.week_start, w.sign_ups, w.active]),
    [
      ["2026-09-28", 0, 0],
      ["2026-10-05", 0, 0],
      ["2026-10-12", 0, 0],
      ["2026-10-19", 2, 0],
      ["2026-10-26", 0, 2],
      ["2026-11-02", 1, 1],
      ["2026-11-09", 0, 1],
      ["2026-11-16", 1, 3],
    ],
  );

  assert.equal(t.activation.activated, 3);
  assert.equal(t.activation.share, 0.75);
  assert.equal(t.activation.median_minutes_to_first_source, 120);

  // Today (17 November): a and d. Last 7 days (11 to 17 November): a, c and d.
  assert.equal(t.active.daily, 2);
  assert.equal(t.active.weekly, 3);
  // 12 Nov: c; 16 Nov: c; 17 Nov: a, d. 4 user days over 7 days.
  assert.equal(t.active.daily_average_7d, 0.6);

  const cohort = (week: string) => t.retention.cohorts.find((c) => c.week_start === week);
  const oct19 = cohort("2026-10-19");
  assert.deepEqual(
    oct19?.retention.map((r) => [r.week, r.active, r.share, r.complete]),
    [
      [1, 2, 1, true],
      [2, 1, 0.5, true],
      [4, 1, 0.5, false], // week 4 is this week: begun, not complete
    ],
  );
  const nov2 = cohort("2026-11-02");
  assert.deepEqual(
    nov2?.retention.map((r) => [r.week, r.share, r.complete]),
    [
      [1, 1, true],
      [2, 1, false],
      [4, null, false], // not begun
    ],
  );
  assert.equal(t.retention.cohorts.length, 3);
  // Complete weeks only, weighted by cohort size: week 1 = (2 + 1) / (2 + 1); week 2 = 1 / 2.
  assert.equal(t.retention.week_1, 1);
  assert.equal(t.retention.week_2, 0.5);
  assert.equal(t.retention.week_4, null);

  assert.deepEqual(t.engagement, {
    actions_done: 3,
    actions_undone: 1,
    chat_messages: 6,
    nudges_sent: 2,
    connector_queries: 7,
  });
  assert.equal(t.excluded_accounts, 1);
  Traction.parse(t);
});

test("sumGoalWeek: only users with planned goal time; share is spent over elapsed", () => {
  const w = sumGoalWeek("2026-11-16", [
    { planned_minutes: 600, elapsed_minutes: 200, spent_minutes: 150, time_won_back_minutes: 20 },
    { planned_minutes: 300, elapsed_minutes: 100, spent_minutes: 90, time_won_back_minutes: 0 },
    { planned_minutes: 0, elapsed_minutes: 0, spent_minutes: 0, time_won_back_minutes: 0 },
  ]);
  assert.deepEqual(w, {
    week_start: "2026-11-16",
    users: 2,
    planned_minutes: 900,
    elapsed_minutes: 300,
    spent_minutes: 240,
    share: 0.8,
    won_back_minutes: 20,
  });
  assert.equal(sumGoalWeek("2026-11-16", []).share, null);
});

const entry = (over: Partial<WaitlistEntry>): WaitlistEntry => ({
  id: randomUUID(),
  email: `${randomUUID().slice(0, 8)}@example.com`,
  name: "Someone",
  role: "founder",
  hours_lost_per_week: 6,
  computer: "mac",
  phone: "iphone",
  calendar: "google",
  founding_member: false,
  referral_code: randomUUID().slice(0, 8),
  referred_by: null,
  source: null,
  created_at: "2026-11-16T09:00:00Z",
  invited_at: null,
  ...over,
});

test("waitingList: days, sources, the hours spread and intent, never a name or an email", () => {
  const inviter = entry({ referral_code: "inviter1", created_at: "2026-11-05T09:00:00Z", source: "t.co" });
  const list = [
    inviter,
    entry({
      created_at: "2026-11-06T09:00:00Z",
      source: "https://www.linkedin.com/feed",
      hours_lost_per_week: 2,
    }),
    entry({
      created_at: "2026-11-09T09:00:00Z",
      source: "x.com",
      hours_lost_per_week: 3,
      founding_member: true,
    }),
    entry({
      created_at: "2026-11-16T09:00:00Z",
      referred_by: "inviter1",
      source: "x.com",
      hours_lost_per_week: 10,
    }),
    entry({
      created_at: "2026-11-17T08:00:00Z",
      hours_lost_per_week: 40,
      role: "executive",
      phone: "android",
    }),
    // Ours: never counted.
    entry({ email: "team@michael.app", created_at: "2026-11-17T08:30:00Z" }),
  ];
  const w = waitingList(list, { now: NOW, timezone: DEFAULT_TIMEZONE });
  assert.equal(w.total, 5);
  assert.equal(w.excluded, 1);
  // The last 7 days run back to 10 Nov 10:00: 16 and 17 Nov. The 7 before: 5, 6 and 9 Nov.
  assert.equal(w.last_7_days, 2);
  assert.equal(w.previous_7_days, 3);
  assert.equal(w.first_day, "2026-11-05");
  assert.equal(w.by_day.length, 13, "5 to 17 November, every day");
  assert.equal(w.by_day[0]?.sign_ups, 1);
  assert.equal(w.by_day.at(-1)?.day, "2026-11-17");
  assert.equal(
    w.by_day.reduce((s, d) => s + d.sign_ups, 0),
    5,
  );
  assert.deepEqual(w.by_source, [
    { source: "X", sign_ups: 2 },
    { source: "a friend", sign_ups: 1 },
    { source: "direct", sign_ups: 1 },
    { source: "LinkedIn", sign_ups: 1 },
  ]);
  assert.deepEqual(
    w.hours.map((h) => [h.up_to, h.people]),
    [
      [2, 1],
      [4, 1],
      [6, 1],
      [8, 0],
      [null, 2],
    ],
  );
  assert.equal(w.median_hours, 6);
  assert.equal(w.founding_members, 1);
  assert.equal(w.referred, 1);
  assert.equal(w.referrers, 1);
  assert.equal(w.by_role.executive, 1);
  assert.equal(w.by_phone.android, 1);
  assert.doesNotMatch(JSON.stringify(w), /@|Someone|inviter1/);

  const empty = waitingList([], { now: NOW, timezone: DEFAULT_TIMEZONE });
  assert.equal(empty.total, 0);
  assert.equal(empty.first_day, null);
  assert.deepEqual(empty.by_day, []);
  assert.equal(empty.median_hours, null);
  assert.equal(empty.hours.length, 5);
});

test("sourceName: what people call the places they came from", () => {
  assert.equal(sourceName("t.co", false), "X");
  assert.equal(sourceName("twitter", false), "X");
  assert.equal(sourceName("lnkd.in", false), "LinkedIn");
  assert.equal(sourceName(null, false), "direct");
  assert.equal(sourceName("x.com", true), "a friend");
  assert.equal(sourceName("blog.example.com", false), "blog.example.com");
});
