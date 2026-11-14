import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Event, FocusGuardsResponse, Goal, PatternReport, Recommendation } from "@michael/shared";
import { offenderSuggestion } from "../actions/mac-apps";
import { app } from "../app";
import { runAsUser } from "../context";
import { store } from "../store";
import { createPersonalToken } from "../tokens";

// Runs against the in-memory store (no Supabase env in tests).
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const asNewUser = <T>(fn: () => Promise<T>) => runAsUser(randomUUID(), fn, "session");
const call = (path: string, token: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

async function guardRec(payload: Record<string, unknown>): Promise<Recommendation> {
  return store.createRecommendation({
    goal_id: null,
    title: "Mute WhatsApp",
    rationale: "Test",
    action: { kind: "block_mac_app", payload, involves_others: false, undo_until: null },
  });
}

test("executing block_mac_app creates a focus guard; undo removes it at once", () =>
  asNewUser(async () => {
    const { executeRecommendation, undoRecommendation } = await import("../actions/calendar");
    const { activeFocusGuards } = await import("../actions/focus-guard");
    const start = Date.now() - 5 * 60_000;
    const rec = await guardRec({
      app: "whatsapp",
      apps: ["Slack"],
      start_at: iso(start),
      end_at: iso(Date.now() + HOUR),
      back_to: "Deep work",
    });

    const done = await executeRecommendation(rec.id);
    assert.equal(done.status, "done");
    const active = await activeFocusGuards();
    assert.equal(active.off_the_record, false);
    assert.equal(active.guards.length, 1);
    const [g] = active.guards;
    assert.deepEqual(g?.apps, ["WhatsApp", "Slack"]);
    assert.ok(g?.bundle_ids.includes("net.whatsapp.WhatsApp"));
    assert.ok(g?.bundle_ids.includes("com.tinyspeck.slackmacgap"));
    assert.equal(g?.back_to, "Deep work");
    assert.equal(g?.recommendation_id, rec.id);
    // A window that had begun starts now.
    assert.ok(Date.parse(g?.start_at ?? "") >= start);

    const undone = await undoRecommendation(rec.id);
    assert.equal(undone.status, "undone");
    assert.equal((await activeFocusGuards()).guards.length, 0);
  }));

test("block_mac_app refuses apps off the allowlist and windows that have ended", () =>
  asNewUser(async () => {
    const { executeRecommendation } = await import("../actions/calendar");
    for (const app of ["Finder", "Terminal", "com.apple.finder", "Claude", "Michael", "Xcode"]) {
      const rec = await guardRec({ app, start_at: iso(Date.now()), end_at: iso(Date.now() + HOUR) });
      await assert.rejects(executeRecommendation(rec.id), /not on my list/, app);
    }
    const past = await guardRec({
      app: "WhatsApp",
      start_at: iso(Date.now() - 2 * HOUR),
      end_at: iso(Date.now() - HOUR),
    });
    await assert.rejects(executeRecommendation(past.id), /already ended/);
    const long = await guardRec({
      app: "WhatsApp",
      start_at: iso(Date.now() + HOUR),
      end_at: iso(Date.now() + 15 * HOUR),
    });
    await assert.rejects(executeRecommendation(long.id), /at most 12 hours/);
    assert.equal(
      (await store.listFocusGuards({ endsAfter: iso(0), startsBefore: iso(Date.now() + 99 * HOUR) })).length,
      0,
    );
  }));

test("a device key can read the active guards and nothing else", async () => {
  const owner = randomUUID();
  const { secret } = await runAsUser(owner, () => createPersonalToken("Mac collector"), "session");
  const { guardMacApps } = await import("../actions/mac-apps");
  await runAsUser(
    owner,
    () =>
      guardMacApps({
        apps: ["Instagram"],
        start_at: iso(Date.now()),
        end_at: iso(Date.now() + HOUR),
        requested_by: "a test",
      }),
    "session",
  );

  const res = await call("/v1/focus-guards/active", secret);
  assert.equal(res.status, 200);
  const body = (await res.json()) as FocusGuardsResponse;
  assert.deepEqual(
    body.guards.map((g) => g.apps),
    [["Instagram"]],
  );

  assert.equal((await call("/v1/goals", secret)).status, 403, "no reads");
  assert.equal((await call("/v1/recommendations", secret)).status, 403, "no reads");
  assert.equal((await call("/v1/focus-guards/suggest", secret, { method: "POST" })).status, 403);
  assert.equal((await call("/v1/focus-guards/active", secret, { method: "POST" })).status, 403);
  assert.equal((await call("/mcp", secret, { method: "POST" })).status, 403, "no MCP");
});

test("off the record: the collector is told, and gets no guards", () =>
  asNewUser(async () => {
    const { guardMacApps } = await import("../actions/mac-apps");
    const { activeFocusGuards } = await import("../actions/focus-guard");
    await guardMacApps({
      apps: ["Spotify"],
      start_at: iso(Date.now()),
      end_at: iso(Date.now() + HOUR),
      requested_by: "a test",
    });
    await store.setOffTheRecord(true);
    assert.deepEqual((await activeFocusGuards()).guards, []);
    assert.equal((await activeFocusGuards()).off_the_record, true);
    await store.setOffTheRecord(false);
    assert.equal((await activeFocusGuards()).guards.length, 1);
  }));

test("guards starting more than 10 minutes ahead are not sent yet", () =>
  asNewUser(async () => {
    const { guardMacApps } = await import("../actions/mac-apps");
    const { activeFocusGuards } = await import("../actions/focus-guard");
    await guardMacApps({
      apps: ["Discord"],
      start_at: iso(Date.now() + 2 * HOUR),
      end_at: iso(Date.now() + 3 * HOUR),
      requested_by: "a test",
    });
    assert.equal((await activeFocusGuards()).guards.length, 0);
    assert.equal((await activeFocusGuards(Date.now() + 2 * HOUR - 5 * 60_000)).guards.length, 1);
  }));

test("the chat tool mutes apps through the same execute path and undo_action takes it back", () =>
  asNewUser(async () => {
    const { runChatTool } = await import("../actions/chat-tools");
    const out = await runChatTool("block_mac_app", {
      apps: ["WhatsApp"],
      start_at: iso(Date.now() + HOUR),
      end_at: iso(Date.now() + 2 * HOUR),
    });
    assert.equal(out.isError, false, out.content);
    assert.equal(out.action?.status, "done");
    assert.equal(out.action?.source, "chat");
    assert.match(out.content, /Undo until/);
    const undo = await runChatTool("undo_action", { recommendation_id: out.action?.id });
    assert.equal(undo.isError, false, undo.content);

    const refused = await runChatTool("block_mac_app", {
      apps: ["System Settings"],
      start_at: iso(Date.now() + HOUR),
      end_at: iso(Date.now() + 2 * HOUR),
    });
    assert.equal(refused.isError, true);
  }));

// ---------- the worst offender as a suggestion ----------

const GOAL: Goal = {
  id: "0b5c7c1e-1a52-4e3e-9d1b-6a8f0a0b0c01",
  category: "work",
  title: "The company",
  description: null,
  target: { calendar_titles: ["Deep work"] },
  weekly_budget_minutes: 600,
  active: true,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const offenders = (
  list: { key: string; name: string; minutes: number }[],
): Pick<PatternReport, "repeat_offenders"> => ({
  repeat_offenders: {
    status: "ok",
    reason: null,
    minimum: "",
    summary: "",
    evidence: [],
    data: {
      days_with_focus: 5,
      offenders: list.map((o) => ({
        subject: { kind: "app" as const, key: o.key, name: o.name, category: "communication" as const },
        devices: ["mac" as const],
        disruptions: 9,
        minutes_lost: o.minutes,
        days: 4,
        ended_stretches: 2,
      })),
    },
  } as PatternReport["repeat_offenders"],
});

const block = (start: string, end: string): Event => ({
  id: "7c1d4e2a-3b4c-4d5e-8f60-718293a4b5c6",
  source: "google_calendar",
  type: "calendar_event",
  start_at: start,
  end_at: end,
  title: "Deep work",
  data: { attendees: 0 },
  external_id: "g1",
  created_at: start,
});

test("the worst blockable Mac offender is muted for the next work block", () => {
  const now = Date.parse("2026-11-15T09:00:00Z"); // 11:00 in Athens
  const next = offenderSuggestion({
    // Chrome is not blockable, so WhatsApp is the one.
    report: offenders([
      { key: "com.google.Chrome", name: "Chrome", minutes: 80 },
      { key: "net.whatsapp.WhatsApp", name: "WhatsApp", minutes: 47 },
    ]),
    events: [block("2026-11-15T12:00:00Z", "2026-11-15T14:00:00Z")],
    goals: [GOAL],
    now,
  });
  assert.ok(next);
  assert.equal(next.title, "Mute WhatsApp 14:00 to 16:00");
  assert.match(next.rationale, /took 47 min/);
  assert.equal(next.goal_id, GOAL.id);
  assert.equal(next.action?.kind, "block_mac_app");
  assert.equal(next.action?.payload.app, "WhatsApp");
  assert.equal(next.action?.payload.back_to, "Deep work");
  assert.equal(next.action?.undo_until, "2026-11-15T14:00:00.000Z");
});

test("no block: the next two hours inside working hours, nothing in the evening or without an offender", () => {
  const input = {
    report: offenders([{ key: "com.tinyspeck.slackmacgap", name: "Slack", minutes: 30 }]),
    events: [],
    goals: [GOAL],
  };
  const day = offenderSuggestion({ ...input, now: Date.parse("2026-11-15T08:05:00Z") }); // 10:05
  assert.equal(day?.title, "Mute Slack 10:15 to 12:15");
  assert.equal(offenderSuggestion({ ...input, now: Date.parse("2026-11-15T18:00:00Z") }), null); // 20:00
  assert.equal(
    offenderSuggestion({ ...input, report: offenders([]), now: Date.parse("2026-11-15T08:05:00Z") }),
    null,
  );
});
