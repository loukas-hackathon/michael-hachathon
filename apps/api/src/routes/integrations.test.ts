import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { CalendarSyncResult, Integration, IntegrationsResponse, OAuthConnectResponse } from "@michael/shared";

// env.ts reads process.env on import, so configure Google before loading the app.
process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret-xyz";
process.env.PUBLIC_API_URL = "https://api.example.test";
process.env.WEB_ORIGIN = "https://web.example.test";

const { app } = await import("../app");
const { runAsUser } = await import("../context");
const { store } = await import("../store");
const { setGoogleFetch } = await import("../integrations/google");
const { syncGoogleCalendar, toTimelineEvent } = await import("../integrations/calendar-sync");
const { signState, verifyState } = await import("../integrations/state");
const { fakeGoogle, gEvent } = await import("../integrations/fake-google");

const auth = { Authorization: "Bearer dev-key" };
const DEMO = "2ee12960-e594-456d-85cb-a672d0ff3ac3";
const HOUR = 3600_000;

async function connectUrl(): Promise<URL> {
  const res = await app.request("/v1/integrations/google_calendar/connect", {
    method: "POST",
    headers: auth,
  });
  assert.equal(res.status, 200);
  return new URL(OAuthConnectResponse.parse(await res.json()).url);
}

test("GET /v1/integrations lists both providers, disconnected, and needs auth", async () => {
  assert.equal((await app.request("/v1/integrations")).status, 401);
  const res = await app.request("/v1/integrations", { headers: auth });
  const body = IntegrationsResponse.parse(await res.json());
  assert.deepEqual(
    body.integrations.map((i) => [i.provider, i.status]),
    [
      ["google_calendar", "disconnected"],
      ["whoop", "disconnected"],
    ],
  );
});

test("connect returns Google's consent screen with a signed state, account choice and offline access", async () => {
  const url = await connectUrl();
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const q = url.searchParams;
  assert.equal(q.get("client_id"), "client-123.apps.googleusercontent.com");
  assert.equal(q.get("redirect_uri"), "https://api.example.test/oauth/google/callback");
  assert.equal(q.get("scope"), "openid email https://www.googleapis.com/auth/calendar.events");
  assert.equal(q.get("access_type"), "offline");
  assert.equal(q.get("prompt"), "select_account consent");
  assert.equal(q.get("include_granted_scopes"), "true");
  assert.deepEqual(verifyState(q.get("state") ?? ""), { userId: DEMO, provider: "google_calendar" });
});

test("state: tampered, forged or expired states are refused", () => {
  const s = signState(DEMO, "google_calendar");
  const [body, mac] = s.split(".");
  const forged = Buffer.from(
    JSON.stringify({ u: randomUUID(), p: "google_calendar", exp: Date.now() + 1e6, n: "x" }),
  );
  assert.equal(verifyState(`${forged.toString("base64url")}.${mac}`), null);
  assert.equal(verifyState(`${body}.AAAA`), null);
  assert.equal(verifyState("garbage"), null);
  assert.equal(verifyState(s, Date.now() + 16 * 60_000), null);
});

test("callback with a bad state or a refusal goes back to the web app without connecting", async () => {
  const bad = await app.request("/oauth/google/callback?state=nope&code=abc");
  assert.equal(bad.status, 302);
  assert.match(
    bad.headers.get("location") ?? "",
    /^https:\/\/web\.example\.test\/you\?integration_error=google_calendar/,
  );
  const state = (await connectUrl()).searchParams.get("state") ?? "";
  const declined = await app.request(
    `/oauth/google/callback?state=${encodeURIComponent(state)}&error=access_denied`,
  );
  assert.match(declined.headers.get("location") ?? "", /reason=declined/);
});

test("full flow: callback stores tokens, syncs the calendar, never returns tokens, then disconnects", async () => {
  const now = Date.now();
  const g = fakeGoogle([
    gEvent("solo1", now + 2 * HOUR, 60, { summary: "Gym: legs" }),
    gEvent("meet1", now + 4 * HOUR, 30, {
      summary: "Investor call",
      attendees: [
        { email: "manolis@example.com", self: true, responseStatus: "accepted" },
        { email: "vc@example.com", responseStatus: "accepted" },
      ],
    }),
  ]);
  setGoogleFetch(g.fetch);
  const state = (await connectUrl()).searchParams.get("state") ?? "";
  const cb = await app.request(`/oauth/google/callback?state=${encodeURIComponent(state)}&code=auth-code`);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get("location"), "https://web.example.test/you?connected=google_calendar");
  const tokenCall = g.calls.find((c) => c.url.startsWith("https://oauth2.googleapis.com/token"));
  assert.match(tokenCall?.body ?? "", /grant_type=authorization_code/);
  assert.match(tokenCall?.body ?? "", /code=auth-code/);

  const list = await app.request("/v1/integrations", { headers: auth });
  const raw = await list.text();
  assert.doesNotMatch(raw, /access-1|refresh-1|secret/);
  const google = IntegrationsResponse.parse(JSON.parse(raw)).integrations[0];
  assert.equal(google?.status, "connected");
  assert.equal(google?.account, "calendar.owner@example.com");
  assert.ok(google?.last_sync_at);

  const tl = await app.request(
    `/v1/timeline?source=google_calendar&from=${encodeURIComponent(new Date(now).toISOString())}&to=${encodeURIComponent(new Date(now + 6 * HOUR).toISOString())}`,
    { headers: auth },
  );
  const events = ((await tl.json()) as { events: { external_id: string; data: { with_others: boolean } }[] })
    .events;
  assert.equal(events.find((e) => e.external_id === "solo1")?.data.with_others, false);
  assert.equal(events.find((e) => e.external_id === "meet1")?.data.with_others, true);

  const sync = await app.request("/v1/integrations/google_calendar/sync", { method: "POST", headers: auth });
  const result = CalendarSyncResult.parse(await sync.json());
  assert.equal(result.inserted, 0);
  assert.equal(result.unchanged, 2);

  const del = await app.request("/v1/integrations/google_calendar", { method: "DELETE", headers: auth });
  const after = Integration.parse(await del.json());
  assert.equal(after.status, "disconnected");
  assert.equal(after.account, null);
  assert.ok(g.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke")));
  const again = await app.request("/v1/integrations/google_calendar/sync", { method: "POST", headers: auth });
  assert.equal(again.status, 409);
});

// Direct sync tests run as a fresh user, far from the mock day, so counts are exact.
const NOW = Date.parse("2030-03-04T10:00:00Z");
const asNewUser = <T>(fn: () => Promise<T>) => runAsUser(randomUUID(), fn);
const connected = () =>
  store.saveIntegration("google_calendar", {
    status: "connected",
    access_token: "live",
    refresh_token: "refresh-1",
    expires_at: new Date(Date.now() + HOUR).toISOString(),
  });

test("sync is idempotent, updates moved events and drops ones deleted in Google", () =>
  asNewUser(async () => {
    const g = fakeGoogle([
      gEvent("a", NOW + HOUR, 60),
      gEvent("b", NOW + 3 * HOUR, 45),
      gEvent("c", NOW - 2 * 24 * HOUR, 30, { recurringEventId: "series" }),
    ]);
    setGoogleFetch(g.fetch);
    await connected();
    const first = await syncGoogleCalendar(NOW);
    assert.deepEqual([first.fetched, first.inserted, first.updated, first.removed], [3, 3, 0, 0]);
    const second = await syncGoogleCalendar(NOW);
    assert.deepEqual([second.inserted, second.updated, second.unchanged, second.removed], [0, 0, 3, 0]);

    const a = g.events.get("a");
    if (a) {
      a.summary = "Moved";
      a.start = { dateTime: new Date(NOW + 2 * HOUR).toISOString() };
      a.end = { dateTime: new Date(NOW + 3 * HOUR).toISOString() };
    }
    g.events.delete("b");
    const third = await syncGoogleCalendar(NOW);
    assert.deepEqual([third.inserted, third.updated, third.unchanged, third.removed], [0, 1, 1, 1]);

    const mirror = await store.listEvents({
      from: new Date(NOW - 8 * 24 * HOUR).toISOString(),
      to: new Date(NOW + 8 * 24 * HOUR).toISOString(),
      source: ["google_calendar"],
    });
    assert.deepEqual(mirror.map((e) => [e.external_id, e.title]).sort(), [
      ["a", "Moved"],
      ["c", "Event c"],
    ]);
    assert.equal(mirror.find((e) => e.external_id === "a")?.start_at, new Date(NOW + 2 * HOUR).toISOString());
  }));

test("sync refreshes an expired access token and marks a revoked grant as an error", () =>
  asNewUser(async () => {
    const g = fakeGoogle([gEvent("a", NOW + HOUR, 60)]);
    setGoogleFetch(g.fetch);
    await store.saveIntegration("google_calendar", {
      status: "connected",
      access_token: "old",
      refresh_token: "refresh-1",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    await syncGoogleCalendar(NOW);
    assert.match(g.calls[0]?.body ?? "", /grant_type=refresh_token/);
    const rec = await store.getIntegration("google_calendar");
    assert.equal(rec?.access_token, "access-1");
    assert.ok(Date.parse(rec?.expires_at ?? "") > Date.now());

    await store.saveIntegration("google_calendar", { expires_at: new Date(Date.now() - 1000).toISOString() });
    g.failTokenWith = "invalid_grant";
    await assert.rejects(syncGoogleCalendar(NOW), /Connect Google Calendar again/);
    const after = await store.getIntegration("google_calendar");
    assert.equal(after?.status, "error");
  }));

test("mapping: all day events, declined and cancelled events, rooms and other organisers", () => {
  const allDay = toTimelineEvent(
    { id: "d", summary: "Holiday", start: { date: "2026-11-14" }, end: { date: "2026-11-15" } },
    "Europe/Athens",
  );
  assert.equal(allDay?.start_at, "2026-11-13T22:00:00.000Z");
  assert.equal(allDay?.end_at, "2026-11-14T22:00:00.000Z");
  assert.equal(allDay?.data.all_day, true);

  assert.equal(toTimelineEvent(gEvent("x", NOW, 30, { status: "cancelled" }), "UTC"), null);
  const declined = gEvent("y", NOW, 30, {
    attendees: [{ email: "me", self: true, responseStatus: "declined" }],
  });
  assert.equal(toTimelineEvent(declined, "UTC"), null);

  const room = toTimelineEvent(
    gEvent("r", NOW, 30, {
      attendees: [
        { email: "me", self: true },
        { email: "room", resource: true },
      ],
    }),
    "UTC",
  );
  assert.equal(room?.data.with_others, false);
  assert.equal(room?.data.attendees, 1);

  const invited = toTimelineEvent(gEvent("i", NOW, 30, { organizer: { email: "boss@example.com" } }), "UTC");
  assert.equal(invited?.data.with_others, true);
  const untitled = toTimelineEvent(gEvent("u", NOW, 30, { summary: "  " }), "UTC");
  assert.equal(untitled?.title, "Busy");
});

test("return_to: a path on the web app is signed into state and used by the callback; other sites are refused", async () => {
  const connect = (body: unknown) =>
    app.request("/v1/integrations/google_calendar/connect", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const res = await connect({ return_to: "/onboarding?step=done" });
  assert.equal(res.status, 200);
  const state = new URL(OAuthConnectResponse.parse(await res.json()).url).searchParams.get("state") ?? "";
  assert.deepEqual(verifyState(state), {
    userId: DEMO,
    provider: "google_calendar",
    returnTo: "/onboarding?step=done",
  });
  const cb = await app.request(
    `/oauth/google/callback?state=${encodeURIComponent(state)}&error=access_denied`,
  );
  assert.equal(
    cb.headers.get("location"),
    "https://web.example.test/onboarding?step=done&integration_error=google_calendar&reason=declined",
  );

  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example/", "onboarding", "/a b"]) {
    assert.equal((await connect({ return_to: bad })).status, 400, bad);
  }
});

test("onboarding: the callback goes straight back and the page reads four weeks with past_days", async () => {
  const now = Date.now();
  const g = fakeGoogle([gEvent("old", now - 20 * 24 * HOUR, 60, { summary: "Swim" })]);
  setGoogleFetch(g.fetch);
  const res = await app.request("/v1/integrations/google_calendar/connect", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ return_to: "/onboarding?step=goals" }),
  });
  const state = new URL(OAuthConnectResponse.parse(await res.json()).url).searchParams.get("state") ?? "";
  const cb = await app.request(`/oauth/google/callback?state=${encodeURIComponent(state)}&code=auth-code`);
  assert.equal(
    cb.headers.get("location"),
    "https://web.example.test/onboarding?step=goals&connected=google_calendar&sync=pending",
  );
  assert.ok(!g.calls.some((c) => c.url.includes("/calendars/")), "no sync before the redirect");

  const sync = (q: string) =>
    app.request(`/v1/integrations/google_calendar/sync${q}`, { method: "POST", headers: auth });
  assert.equal((await sync("?past_days=99")).status, 400);
  const result = CalendarSyncResult.parse(await (await sync("?past_days=28")).json());
  assert.ok(Date.parse(result.from) <= now - 27 * 24 * HOUR);
});

test("a second landing of Google's redirect (code already spent) still reads as connected", async () => {
  const g = fakeGoogle();
  setGoogleFetch(g.fetch);
  const res = await app.request("/v1/integrations/google_calendar/connect", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ return_to: "/onboarding?step=talk" }),
  });
  const state = new URL(OAuthConnectResponse.parse(await res.json()).url).searchParams.get("state") ?? "";
  const land = () => app.request(`/oauth/google/callback?state=${encodeURIComponent(state)}&code=auth-code`);
  const ok = "https://web.example.test/onboarding?step=talk&connected=google_calendar&sync=pending";
  assert.equal((await land()).headers.get("location"), ok);
  g.failTokenWith = "invalid_grant";
  assert.equal((await land()).headers.get("location"), ok);

  // Long after a connect, a spent code is a real failure again.
  await runAsUser(DEMO, () =>
    store.saveIntegration("google_calendar", { connected_at: new Date(Date.now() - HOUR).toISOString() }),
  );
  g.failTokenWith = "invalid_grant";
  assert.match(
    (await land()).headers.get("location") ?? "",
    /integration_error=google_calendar&reason=token/,
  );
});
