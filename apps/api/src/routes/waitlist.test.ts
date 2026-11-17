import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { WaitlistAdmin, WaitlistStanding } from "@michael/shared";

// Each test file runs in its own process: sign in as test users (e2e_<uuid>) and make one an admin.
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOMEONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
process.env.E2E_TEST_AUTH = "on";
process.env.ADMIN_EMAILS = ` Someone@Else.test , ${ADMIN}@e2e.michael.test`;

const { app } = await import("../app");
const { JOINS_PER_HOUR, resetWaitlistLimit } = await import("./waitlist");

beforeEach(() => resetWaitlistLimit());

let n = 0;
const person = (over: Record<string, unknown> = {}) => ({
  email: `person${++n}@example.com`,
  name: `Person ${n}`,
  role: "founder",
  hours_lost_per_week: 6,
  computer: "mac",
  phone: "iphone",
  calendar: "google",
  founding_member: false,
  ...over,
});

const join = (body: unknown, headers: Record<string, string> = {}) =>
  app.request("/v1/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.1", ...headers },
    body: JSON.stringify(body),
  });

const joined = async (body: unknown) => {
  const res = await join(body);
  assert.ok(res.status === 201 || res.status === 200, `join answered ${res.status}`);
  return (await res.json()) as WaitlistStanding;
};

test("joining needs no sign in and answers with a code and a position", async () => {
  const res = await join(person({ email: "  First@Example.com ", source: "twitter" }));
  assert.equal(res.status, 201);
  const body = (await res.json()) as WaitlistStanding;
  assert.match(body.referral_code, /^[A-Za-z0-9_-]{8}$/);
  assert.equal(body.position, body.total);
  assert.equal(body.referrals, 0);
  assert.deepEqual(Object.keys(body).sort(), ["position", "referral_code", "referrals", "total"]);
});

test("joining again with the same email returns the same entry, never an error", async () => {
  const first = await joined(person({ email: "again@example.com" }));
  const res = await join(person({ email: "AGAIN@example.com", name: "Someone else" }));
  assert.equal(res.status, 200);
  const second = (await res.json()) as WaitlistStanding;
  assert.equal(second.referral_code, first.referral_code);
  assert.equal(second.total, first.total, "nobody was added");
});

test("a bad body is refused, and so is a filled in honeypot (nothing is stored)", async () => {
  const before = (await joined(person())).total;
  assert.equal((await join(person({ role: "ceo" }))).status, 400);
  assert.equal((await join(person({ email: "nope" }))).status, 400);
  const bot = await join(person({ email: "bot@example.com", website: "http://spam.example" }));
  assert.equal(bot.status, 400);
  const after = await joined(person());
  assert.equal(after.total, before + 1, "only the real sign up counted");
});

test("each friend who joins with your code moves you up 5 places", async () => {
  for (let i = 0; i < 6; i++) await joined(person());
  // The last to join is at the back, at least six places behind the people before.
  const late = await joined(person());
  assert.equal(late.position, late.total);
  const friend = await joined(person({ ref: late.referral_code }));
  assert.equal(friend.referrals, 0);
  const res = await app.request(`/v1/waitlist/${late.referral_code}`);
  const now = (await res.json()) as WaitlistStanding;
  assert.equal(now.referrals, 1);
  assert.equal(now.position, late.position - 5, "five places up");
  // An unknown code is ignored, not refused.
  const stray = await join(person({ ref: "unknown1" }));
  assert.equal(stray.status, 201);
});

test("the public lookup gives the standing of that code only", async () => {
  const me = await joined(person({ email: "private@example.com", name: "Private Name" }));
  const res = await app.request(`/v1/waitlist/${me.referral_code}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.doesNotMatch(text, /private@example\.com|Private Name|email|name/);
  assert.equal((await app.request("/v1/waitlist/nobody12")).status, 404);
  assert.equal((await app.request("/v1/waitlist/no!")).status, 404);
});

test("sign ups are limited per address", async () => {
  for (let i = 0; i < JOINS_PER_HOUR; i++) {
    assert.equal((await join(person(), { "x-real-ip": "198.51.100.7" })).status, 201);
  }
  assert.equal((await join(person(), { "x-real-ip": "198.51.100.7" })).status, 429);
  assert.equal((await join(person(), { "x-real-ip": "198.51.100.8" })).status, 201);
  // The client address header only counts next to the API key (the web server sends both).
  const spoof = await join(person(), { "x-real-ip": "198.51.100.7", "x-michael-client-ip": "192.0.2.1" });
  assert.equal(spoof.status, 429);
  const web = await join(person(), {
    "x-real-ip": "198.51.100.7",
    authorization: "Bearer dev-key",
    "x-michael-client-ip": "192.0.2.1",
  });
  assert.equal(web.status, 201);
});

test("only an admin sees the full list; everyone else gets a 404", async () => {
  const anon = await app.request("/v1/waitlist");
  assert.equal(anon.status, 401);
  const other = await app.request("/v1/waitlist", { headers: { authorization: `Bearer e2e_${SOMEONE}` } });
  assert.equal(other.status, 404);
  const key = await app.request("/v1/waitlist", { headers: { authorization: "Bearer dev-key" } });
  assert.equal(key.status, 404, "the API key is not an admin");

  const inviter = await joined(person({ role: "executive", computer: "windows", founding_member: true }));
  await joined(person({ ref: inviter.referral_code }));
  const res = await app.request("/v1/waitlist", { headers: { authorization: `Bearer e2e_${ADMIN}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as WaitlistAdmin;
  assert.equal(body.stats.total, body.entries.length);
  assert.ok(body.entries.length > 2);
  // Newest first, with every field.
  const times = body.entries.map((e) => e.created_at);
  assert.deepEqual(times, [...times].sort().reverse());
  const newest = body.entries[0];
  assert.ok(newest?.email && newest.name && newest.referral_code);
  assert.equal(newest?.referred_by, inviter.referral_code);
  assert.ok(body.stats.by_role.executive >= 1);
  assert.ok(body.stats.by_computer.windows >= 1);
  assert.ok(body.stats.founding_members >= 1);
  assert.equal(body.stats.last_7_days, body.stats.total);
  assert.ok(
    body.stats.top_referrers.some((r) => r.referral_code === inviter.referral_code && r.referrals === 1),
  );
});
