import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instruction, mockInstructions, type RecommendationAction } from "@michael/shared";
import { bookFocusBlock } from "../actions/calendar";
import { runChatTool } from "../actions/chat-tools";
import { FakeModelClient } from "../analysis/model";
import { runAnalysis } from "../analysis/run";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { HttpError } from "../http";
import type { MapsDeps } from "../integrations/maps";
import { planTravel } from "../integrations/travel";
import { momentNudge } from "../moments/nudge";
import { T } from "../patterns/testkit";
import { Zone } from "../patterns/time";
import { momentCoreFor } from "../routes/moments";
import { MemoryStore, store } from "../store";
import { checkAction, guardRecommendation, type PlannedAction } from "./guard";
import { withoutInstructions } from "./testkit";

// The guard between Michael and the time a standing instruction protects (#191): the pure rules
// first, then every path that makes an action, through its real entry point and the memory store
// (which starts every user with the mock "Keep Sundays clear", except "Rhefuel").
// Athens is UTC+02:00 in November. Sunday 15 and 22 November 2026 are Sundays.

const rule = (n: number, i: Partial<Instruction> & Pick<Instruction, "kind" | "text">): Instruction => ({
  id: `50000000-0000-4000-8000-00000000010${n}`,
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  ...i,
});
const SUNDAYS = mockInstructions[0] as Instruction;
const HOME = rule(1, { text: "Home every day by 21:00", kind: "home_by", time: "21:00" });
const QUIET = rule(2, {
  text: "Nothing between 22:00 and 07:00",
  kind: "quiet_hours",
  time: "22:00",
  end_time: "07:00",
});
const CUSTOM = rule(3, { text: "Never two calls back to back", kind: "custom" });
const WEEKEND = rule(4, { text: "Weekends are mine", kind: "clear_day", days: [0, 6] });

const act = (kind: PlannedAction["kind"], from: string, to: string | null, title: string | null = "Gym") => ({
  kind,
  start: T(from),
  end: to === null ? null : T(to),
  title,
});
const verdict = (a: PlannedAction, rules: Instruction[]) => {
  const v = checkAction(a, rules);
  return v.allowed ? "allowed" : v.reason;
};

test("guard: each kind of instruction against each kind of action", () => {
  const all = [SUNDAYS, HOME, QUIET, CUSTOM];
  const sunday = ["2026-11-15 10:00", "2026-11-15 11:00"] as const;
  // Creating or moving a block onto a clear Sunday is refused, with Michael's line.
  assert.equal(verdict(act("create_focus_block", ...sunday), all), "Sundays are kept clear.");
  assert.equal(verdict(act("move_calendar_block", ...sunday), all), "Sundays are kept clear.");
  // Not planning: allowed on a clear Sunday.
  assert.equal(verdict(act("reminder", sunday[0], null, null), all), "allowed");
  assert.equal(verdict(act("draft_follow_up", sunday[0], null, null), all), "allowed");
  // Closing an app inside protected time protects it.
  assert.equal(verdict(act("block_mac_app", ...sunday, null), all), "allowed");
  // A Monday morning breaks nothing.
  assert.equal(verdict(act("create_focus_block", "2026-11-16 10:00", "2026-11-16 11:00"), all), "allowed");

  // home_by: after the time, and after midnight until 05:00.
  assert.equal(
    verdict(act("create_focus_block", "2026-11-16 21:30", "2026-11-16 22:00"), [HOME]),
    "You're home by 21:00.",
  );
  assert.equal(verdict(act("reminder", "2026-11-16 21:30", null, null), [HOME]), "allowed");

  // quiet_hours: blocks and reminders are refused; a draft is not.
  assert.equal(
    verdict(act("create_focus_block", "2026-11-16 22:30", "2026-11-16 23:00"), [QUIET]),
    "That's in the hours I never book.",
  );
  assert.equal(
    verdict(act("reminder", "2026-11-16 22:30", null, null), [QUIET]),
    "That's in the hours I never book.",
  );
  assert.equal(verdict(act("draft_follow_up", "2026-11-16 22:30", null, null), [QUIET]), "allowed");
  assert.equal(
    verdict(act("block_mac_app", "2026-11-16 22:30", "2026-11-16 23:00", null), [QUIET]),
    "allowed",
  );

  // custom never refuses; a paused instruction protects nothing.
  assert.equal(verdict(act("create_focus_block", ...sunday), [CUSTOM]), "allowed");
  assert.equal(verdict(act("create_focus_block", ...sunday), [{ ...SUNDAYS, active: false }]), "allowed");
  // Several days in Michael's words, Monday first.
  assert.equal(
    verdict(act("create_focus_block", ...sunday), [WEEKEND]),
    "Saturdays and Sundays are kept clear.",
  );
  // The first instruction that forbids it is named.
  const v = checkAction(act("create_focus_block", "2026-11-15 22:30", "2026-11-15 23:00"), all);
  assert.equal(v.allowed ? null : v.instruction.id, SUNDAYS.id);
});

test("guard: an exception title may be planned; a move out of protected time is allowed", () => {
  // "Rhefuel" is the exception on the mock's clear Sunday: equal or starting with it, any case.
  for (const title of ["Rhefuel", "rhefuel session", "RHEFUEL"]) {
    assert.equal(
      verdict(act("create_focus_block", "2026-11-15 09:00", "2026-11-15 10:30", title), [SUNDAYS]),
      "allowed",
    );
  }
  // Only at a word boundary, and only for that instruction: home_by still applies to it.
  assert.equal(
    verdict(act("create_focus_block", "2026-11-15 09:00", "2026-11-15 10:30", "Rhefuelling"), [SUNDAYS]),
    "Sundays are kept clear.",
  );
  assert.equal(
    verdict(act("create_focus_block", "2026-11-15 21:30", "2026-11-15 22:00", "Rhefuel"), [SUNDAYS, HOME]),
    "You're home by 21:00.",
  );
  // Only where the block lands counts: from Sunday to Monday is allowed, Sunday to Sunday is not.
  assert.equal(
    verdict(act("move_calendar_block", "2026-11-16 10:00", "2026-11-16 11:00"), [SUNDAYS]),
    "allowed",
  );
});

test("guard: quiet hours across midnight and home_by after midnight", () => {
  // 22:00 to 07:00 starts on Monday and holds Tuesday's small hours.
  assert.equal(
    verdict(act("create_focus_block", "2026-11-17 02:00", "2026-11-17 03:00"), [QUIET]),
    "That's in the hours I never book.",
  );
  assert.equal(
    verdict(act("reminder", "2026-11-17 06:30", null, null), [QUIET]),
    "That's in the hours I never book.",
  );
  assert.equal(verdict(act("reminder", "2026-11-17 07:00", null, null), [QUIET]), "allowed");
  assert.equal(
    verdict(act("create_focus_block", "2026-11-16 21:00", "2026-11-16 22:00"), [QUIET]),
    "allowed",
  );
  // A block at 00:30 counts as after 21:00 of the day before, until 05:00.
  assert.equal(
    verdict(act("create_focus_block", "2026-11-17 00:30", "2026-11-17 01:00"), [HOME]),
    "You're home by 21:00.",
  );
  assert.equal(verdict(act("create_focus_block", "2026-11-17 05:00", "2026-11-17 06:00"), [HOME]), "allowed");
  // A home_by on weekdays only: Friday night reaches Saturday 00:30, Saturday night does not exist.
  const weekdays = { ...HOME, days: [1, 2, 3, 4, 5] };
  assert.equal(
    verdict(act("create_focus_block", "2026-11-21 00:30", "2026-11-21 01:00"), [weekdays]),
    "You're home by 21:00.",
  );
  assert.equal(
    verdict(act("create_focus_block", "2026-11-22 00:30", "2026-11-22 01:00"), [weekdays]),
    "allowed",
  );
});

// ---------- the choke point ----------

const focus = (start: string, end: string, title = "Gym"): RecommendationAction => ({
  kind: "create_focus_block",
  payload: { start_at: T(start), end_at: T(end), title },
  involves_others: false,
  undo_until: T(start),
});
const deps = (instructions: Instruction[], logs: Record<string, unknown>[] = []) => ({
  instructions,
  getEvent: async () => null,
  log: (e: Record<string, unknown>) => logs.push(e),
});

test("choke point: advice keeps its words and loses the action; an order from chat is a 409", async () => {
  const advice = {
    goal_id: null,
    title: "Book the gym",
    rationale: "Two sessions short.",
    action: focus("2026-11-15 10:00", "2026-11-15 11:00"),
  };
  const logs: Record<string, unknown>[] = [];
  const kept = await guardRecommendation(advice, deps([SUNDAYS], logs));
  assert.deepEqual(kept, { ...advice, action: null });
  assert.equal(logs[0]?.event, "instruction_guard_refused");
  assert.equal(logs[0]?.reason, "Sundays are kept clear.");
  // Allowed ones come back untouched; so does anything without an action.
  assert.equal(
    await guardRecommendation(
      { ...advice, action: focus("2026-11-16 10:00", "2026-11-16 11:00") },
      deps([SUNDAYS]),
    ).then((r) => r.action?.kind),
    "create_focus_block",
  );
  assert.equal(
    (
      await guardRecommendation(
        { ...advice, action: focus("2026-11-15 09:00", "2026-11-15 10:30", "Rhefuel") },
        deps([SUNDAYS]),
      )
    ).action?.kind,
    "create_focus_block",
  );
  // Asked for in chat: carried out at once, so it is refused with the reason instead.
  await assert.rejects(
    guardRecommendation({ ...advice, source: "chat" }, deps([SUNDAYS])),
    (err: unknown) =>
      err instanceof HttpError && err.code === "conflict" && err.message === "Sundays are kept clear.",
  );
});

// ---------- every path, through its real entry point ----------

const zone = new Zone("Europe/Athens");
/** A Sunday at least two days ahead, as a local day. */
function nextSunday(): string {
  let day = zone.nextDay(zone.dayOf(Date.now()), 2);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== 0) day = zone.nextDay(day);
  return day;
}
const at = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(zone.at(day, (h ?? 0) * 60 + (m ?? 0))).toISOString();
};
const asNewUser = <T>(fn: () => Promise<T>) => runAsUser(crypto.randomUUID(), fn);

test("path: the analysis keeps the advice and drops a block planned on a clear Sunday", async () => {
  const s = new MemoryStore();
  const action = (day: string, start: string, end: string, text: string | null = null) => ({
    kind: "create_focus_block",
    block: null,
    day,
    start,
    end,
    app: null,
    text,
  });
  const rec = (title: string, a: ReturnType<typeof action>) => ({
    goal_id: null,
    title,
    rationale: "Two sessions short this week.",
    action: a,
    evidence: [],
  });
  const model = new FakeModelClient([
    JSON.stringify({
      summary: "We got 60 of 60 minutes today.",
      recommendations: [
        rec("Training is 2 sessions short.", action("2026-11-15", "10:00", "11:00")),
        rec("Monday has room at 07:00.", action("2026-11-16", "07:00", "08:00")),
        rec("Sunday holds the recovery session.", action("2026-11-15", "09:00", "10:30", "Rhefuel")),
      ],
      question: null,
    }),
  ]);
  const result = await asNewUser(async () => {
    const out = await runAnalysis(
      { trigger: "evening" },
      { store: s, model, now: () => new Date("2026-11-14T20:00:00+02:00"), log: () => {} },
    );
    return { out, stored: await s.listRecommendations() };
  });
  const [sunday, monday, rhefuel] = result.out.recommendations;
  assert.equal(sunday?.title, "Training is 2 sessions short.", "the advice stays, word for word");
  assert.equal(sunday?.action, null, "the Sunday block does not");
  assert.equal(monday?.action?.kind, "create_focus_block");
  assert.equal(rhefuel?.action?.kind, "create_focus_block", "the exception may be planned");
  assert.equal(result.stored.find((r) => r.id === sunday?.id)?.action, null);
});

test("path: the travel rules do not move a block within a clear Sunday", async () => {
  // Rush hour on the mocked roads: departures 17:00 to 17:29 on Sunday 22 November.
  const RUSH_FROM = Date.parse("2026-11-22T15:00:00Z");
  const RUSH_TO = Date.parse("2026-11-22T15:30:00Z");
  const maps: MapsDeps = {
    apiKey: "test-key",
    now: () => Date.parse("2026-11-22T06:00:00Z"),
    fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { departureTime?: string }) : {};
      const depart = Date.parse(String(body.departureTime));
      const rush = depart >= RUSH_FROM && depart < RUSH_TO;
      return Response.json({
        routes: [
          { duration: `${rush ? 50 * 60 : 20 * 60}s`, staticDuration: "1200s", distanceMeters: 12_400 },
        ],
      });
    }) as typeof fetch,
  };
  const s = new MemoryStore();
  const out = await asNewUser(async () => {
    await s.replacePlaces([
      { key: "work", label: "Work", address: null, lat: 37.98, lng: 23.73 },
      { key: "gym", label: "Gym", address: null, lat: 38.05, lng: 23.81 },
    ]);
    await s.setSourceEnabled("maps", true);
    const cal = (title: string, start: string, end: string, location: string) => ({
      source: "google_calendar" as const,
      type: "calendar_event" as const,
      start_at: start,
      end_at: end,
      title,
      data: { location, attendees: 0 },
      external_id: `test-${title}`,
    });
    await s.insertEvents([
      cal("Deep work", "2026-11-22T13:00:00Z", "2026-11-22T15:00:00Z", "Work"),
      cal("Gym: legs", "2026-11-22T15:40:00Z", "2026-11-22T16:40:00Z", "Gym"),
    ]);
    return planTravel(s, { from: "2026-11-21T22:00:00Z", to: "2026-11-22T22:00:00Z", deps: maps });
  });
  // On a Friday this is "Move Gym: legs to 17:55" with the move (integrations/travel.test.ts).
  const rec = out.recommendations.find((r) => r.title.startsWith("Move Gym: legs"));
  assert.ok(rec, "the advice is still there");
  assert.equal(rec.action, null, "the move inside a clear Sunday is not");
});

test("path: the chat tools refuse a Sunday block with the reason, and allow the exception and a move out", async () => {
  const sunday = nextSunday();
  await asNewUser(async () => {
    const refused = await runChatTool("create_focus_block", {
      title: "Gym",
      start_at: at(sunday, "10:00"),
      end_at: at(sunday, "11:00"),
    });
    assert.equal(refused.isError, true);
    assert.equal(refused.content, "Refused (conflict): Sundays are kept clear.");
    const range = { from: at(sunday, "00:00"), to: at(sunday, "23:59") };
    assert.equal((await store.listEvents(range)).length, 0, "nothing was booked");
    assert.equal((await store.listRecommendations()).filter((r) => r.source === "chat").length, 0);

    const rhefuel = await runChatTool("create_focus_block", {
      title: "Rhefuel",
      start_at: at(sunday, "09:00"),
      end_at: at(sunday, "10:30"),
    });
    assert.equal(rhefuel.isError, false, rhefuel.content);

    // A block already on Sunday may move out to Monday, not to later on Sunday.
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: at(sunday, "15:00"),
        end_at: at(sunday, "16:00"),
        title: "Gym",
        data: {},
      },
    ]);
    const gym = inserted[0];
    assert.ok(gym);
    const within = await runChatTool("move_calendar_block", {
      event_id: gym.id,
      start_at: at(sunday, "17:00"),
    });
    assert.equal(within.content, "Refused (conflict): Sundays are kept clear.");
    const monday = zone.nextDay(sunday);
    const out = await runChatTool("move_calendar_block", { event_id: gym.id, start_at: at(monday, "17:00") });
    assert.equal(out.isError, false, out.content);
    assert.equal((await store.getEvent(gym.id))?.start_at, at(monday, "17:00"));
  });
});

test("path: an agent's create_focus_block (MCP) on a clear Sunday answers 409 and leaves nothing", async () => {
  const sunday = nextSunday();
  await asNewUser(async () => {
    const before = (await store.listRecommendations()).length;
    await assert.rejects(
      bookFocusBlock({
        start_at: at(sunday, "10:00"),
        end_at: at(sunday, "11:00"),
        title: "Focus: pitch",
        requested_by: "Claude",
      }),
      (err: unknown) =>
        err instanceof HttpError && err.code === "conflict" && err.message === "Sundays are kept clear.",
    );
    assert.equal((await store.listRecommendations()).length, before);
  });
});

test("path: the Morning and Evening moments and their nudge never offer a Sunday block", async () => {
  await asNewUser(async () => {
    // Saturday evening: the first move for tomorrow would be a block on the clear Sunday.
    const evening = await momentCoreFor("evening", "2026-11-14T20:00:00+02:00");
    assert.equal(evening.first_move, null);
    assert.doesNotMatch(momentNudge(evening).reason, /Tomorrow: Book/);
    const morning = await momentCoreFor("morning", "2026-11-15T08:00:00+02:00");
    assert.ok(morning.suggestions.every((m) => m.action_kind !== "create_focus_block"));

    // Without the instruction the same moments offer exactly those blocks.
    await withoutInstructions(store);
    const free = await momentCoreFor("evening", "2026-11-14T20:00:00+02:00");
    assert.equal(free.first_move?.action_kind, "create_focus_block");
    assert.equal(zone.dayOf(Date.parse(free.first_move?.start_at ?? "")), "2026-11-15");
    assert.match(momentNudge(free).reason, /Tomorrow: Book \d+ minutes for .+ at 08:00 tomorrow/);
    const freeMorning = await momentCoreFor("morning", "2026-11-15T08:00:00+02:00");
    assert.ok(freeMorning.suggestions.some((m) => m.action_kind === "create_focus_block"));
  });
});

test("path: executing after a new instruction answers 409 with a plain reason", async () => {
  const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
  // A Monday at least two days ahead, booked as advice before the rule exists.
  const monday = zone.nextDay(nextSunday());
  const rec = await runAsUser(env.DEMO_USER_ID, () =>
    store.createRecommendation({
      goal_id: null,
      title: "Monday has room at 07:00.",
      rationale: "Two sessions short.",
      action: {
        kind: "create_focus_block",
        payload: { start_at: at(monday, "07:00"), end_at: at(monday, "08:00"), title: "Gym" },
        involves_others: false,
        undo_until: at(monday, "07:00"),
      },
    }),
  );
  assert.equal(rec.action?.kind, "create_focus_block", "allowed when it was made");
  const added = await app.request("/v1/instructions", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "Mondays off", kind: "clear_day", days: [1] }),
  });
  assert.equal(added.status, 201);
  const { id } = (await added.json()) as { id: string };
  try {
    const res = await app.request(`/v1/recommendations/${rec.id}/execute`, { method: "POST", headers: auth });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: { code: "conflict", message: "Mondays are kept clear." } });
    assert.equal(
      (await runAsUser(env.DEMO_USER_ID, () => store.getRecommendation(rec.id)))?.status,
      "proposed",
    );
  } finally {
    await app.request(`/v1/instructions/${id}`, { method: "DELETE", headers: auth });
  }
});

test("exceptions are set through POST and PATCH, cleared with null, and shown in the list", async () => {
  const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
  const created = await app.request("/v1/instructions", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      text: "Saturdays are for family",
      kind: "clear_day",
      days: [6],
      exceptions: ["Long run"],
    }),
  });
  assert.equal(created.status, 201);
  const row = (await created.json()) as Instruction;
  try {
    assert.deepEqual(row.exceptions, ["Long run"]);
    const patch = (body: unknown) =>
      app.request(`/v1/instructions/${row.id}`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify(body),
      });
    assert.deepEqual(
      ((await (await patch({ exceptions: ["Long run", "Swim"] })).json()) as Instruction).exceptions,
      ["Long run", "Swim"],
    );
    const cleared = (await (await patch({ exceptions: null })).json()) as Instruction;
    assert.equal("exceptions" in cleared, false);
    assert.equal((await patch({ exceptions: ["  "] })).status, 400);
  } finally {
    await app.request(`/v1/instructions/${row.id}`, { method: "DELETE", headers: auth });
  }
});
