import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { type ChecklistItem, goalKind, RitualToday } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { seedDemoRitual } from "../demo/ritual";
import { demoGoals } from "../demo/week";
import type { BehindGoal } from "../nudges/engine";
import type { GoalBlock } from "../patterns/focus";
import { askMichael, setChatClientForTests } from "../routes/chat";
import { loadWeek } from "../routes/score";
import { store } from "../store";
import { logDoneTime } from "./log";
import { ritualNudgeText } from "./nudge";
import {
  eveningSummary,
  logEvening,
  morningSuggestions,
  OUTCOMES_TITLE,
  planMorning,
  ritualFor,
  ritualPhase,
  ritualStates,
  skipRitual,
} from "./ritual";

// The daily ritual (#318): morning outcomes, evening log. Against the in-memory store, each test
// as a new user with an empty account, at fixed instants of Friday 13 November 2026 (Athens).

const at = (day: string, time: string) => Date.parse(`2026-11-${day}T${time}:00+02:00`);
const MORNING = at("13", "09:50");
const EVENING = at("13", "21:30");

const asNewUser = <T>(fn: () => Promise<T>) =>
  runAsUser(randomUUID(), async () => {
    await store.deleteMyData({ everything: true });
    return fn();
  });

async function university() {
  return store.createGoal({
    category: "personal",
    title: "University",
    target: { calendar_titles: ["Study"] },
    weekly_budget_minutes: 600,
    active: true,
  });
}

/** Last night's sleep (woke at 07:00) and tomorrow's first block, a Study block at 09:00. */
async function week() {
  await store.insertEvents([
    {
      source: "health_auto_export",
      type: "sleep",
      start_at: "2026-11-12T23:00:00+02:00",
      end_at: "2026-11-13T07:00:00+02:00",
      title: "Sleep",
      data: {},
    },
    {
      source: "google_calendar",
      type: "calendar_event",
      start_at: "2026-11-14T09:00:00+02:00",
      end_at: "2026-11-14T11:00:00+02:00",
      title: "Study",
      data: { attendees: 0 },
    },
  ]);
}

const item = (p: Partial<ChecklistItem>): ChecklistItem => ({
  id: randomUUID(),
  goal_id: randomUUID(),
  date: "2026-11-13",
  text: "An outcome",
  position: 0,
  status: "open",
  settled_at: null,
  settled_by: null,
  carried_from: null,
  linked_goal_id: null,
  estimate_minutes: null,
  logged_minutes: null,
  created_at: "2026-11-13T07:00:00.000Z",
  updated_at: "2026-11-13T07:00:00.000Z",
  ...p,
});

// ---------- pure rules ----------

test("the phase follows waking and the evening time, or the nudge that opened it", () => {
  const t = { morningAt: at("13", "07:00"), eveningAt: at("13", "21:00") };
  const none = { morning: false, evening: false };
  assert.equal(ritualPhase({ now: at("13", "06:30"), ...t, nudged: none }), null);
  assert.equal(ritualPhase({ now: at("13", "06:30"), ...t, nudged: { ...none, morning: true } }), "morning");
  assert.equal(ritualPhase({ now: at("13", "12:00"), ...t, nudged: none }), "morning");
  assert.equal(ritualPhase({ now: at("13", "19:00"), ...t, nudged: { ...none, evening: true } }), "evening");
  assert.equal(ritualPhase({ now: at("13", "21:05"), ...t, nudged: none }), "evening");
});

test("states: a carried outcome still asks the morning; the evening needs outcomes", () => {
  const carried = item({ carried_from: randomUUID() });
  assert.deepEqual(ritualStates({ phase: null, items: [], rows: [] }), {
    morning: "not_yet",
    evening: "not_yet",
  });
  assert.deepEqual(ritualStates({ phase: "morning", items: [carried], rows: [] }), {
    morning: "due",
    evening: "not_yet",
  });
  assert.deepEqual(ritualStates({ phase: "evening", items: [item({})], rows: [] }), {
    morning: "done",
    evening: "due",
  });
  assert.deepEqual(ritualStates({ phase: "evening", items: [], rows: [] }).evening, "not_yet");
  const skipped = [
    { day: "2026-11-13", kind: "evening" as const, state: "skipped" as const, summary: null, updated_at: "" },
  ];
  assert.equal(ritualStates({ phase: "evening", items: [item({})], rows: skipped }).evening, "skipped");
});

test("morning suggestions: the goal furthest behind first, keeping today's block; at most two", async () => {
  const uni = { ...(await runAsUser(randomUUID(), university)) };
  const gym = { ...uni, id: randomUUID(), title: "Gym" };
  const work = { ...uni, id: randomUUID(), title: "The company" };
  const behind: BehindGoal[] = [
    { goal: uni, spent: 0, pace: 240, gap: 240 },
    { goal: gym, spent: 0, pace: 100, gap: 100 },
  ];
  const block = (goal: typeof uni, time: string, minutes: number): GoalBlock => ({
    start: at("13", time),
    end: at("13", time) + minutes * 60_000,
    eventId: randomUUID(),
    goal,
    title: goal.title === "Gym" ? "Gym" : "Deep work",
    rule: "goal_id",
  });
  const s = morningSuggestions({
    now: MORNING,
    behind,
    blocks: [block(gym, "18:00", 60), block(work, "11:00", 90)],
    items: [],
  });
  assert.deepEqual(s, [
    {
      text: "One University block",
      goal_id: uni.id,
      estimate_minutes: 90,
      reason: "University is 4h behind this week. One block today?",
      source: "behind",
    },
    {
      text: "Gym at 18:00",
      goal_id: gym.id,
      estimate_minutes: 60,
      reason: "Gym is 1h 40 behind this week. Keep the 18:00 block.",
      source: "calendar",
    },
  ]);
  // A goal an outcome already serves is not suggested again; the calendar fills in.
  const next = morningSuggestions({
    now: MORNING,
    behind,
    blocks: [block(work, "11:00", 90)],
    items: [item({ linked_goal_id: uni.id })],
  });
  assert.deepEqual(
    next.map((x) => [x.text, x.reason]),
    [
      ["One Gym block", "Gym is 1h 40 behind this week. One block today?"],
      ["Deep work at 11:00", "On your calendar at 11:00, for The company."],
    ],
  );
});

test("the evening line shows the maths, without guilt", () => {
  assert.equal(
    eveningSummary({
      items: [{ status: "done" }, { status: "done" }, { status: "moved" }],
      logged: [{ title: "Training", minutes: 40 }],
      carried: 1,
      tomorrow: "University at 09:00",
    }),
    "2 of 3 done. 40 min logged for Training. One carried to tomorrow. Tomorrow starts with University at 09:00.",
  );
  assert.equal(
    eveningSummary({
      items: [{ status: "partly" }, { status: "dropped" }],
      logged: [
        { title: "University", minutes: 60 },
        { title: "Gym", minutes: 45 },
        { title: "University", minutes: 30 },
      ],
      carried: 0,
      tomorrow: null,
    }),
    "0 of 2 done, 1 partly. 1h 30 logged for University, 45 min for Gym.",
  );
});

test("the Morning and Evening nudges ask the ritual's question only while it is to do", () => {
  const day = "2026-11-13";
  assert.equal(
    ritualNudgeText("morning", { items: [], rows: [] }),
    "What do you want to get done today? Up to three.",
  );
  assert.equal(ritualNudgeText("morning", { items: [item({})], rows: [] }), null);
  assert.equal(
    ritualNudgeText("morning", {
      items: [],
      rows: [{ day, kind: "morning", state: "skipped", summary: null, updated_at: "" }],
    }),
    null,
  );
  assert.equal(ritualNudgeText("evening", { items: [], rows: [] }), null);
  assert.equal(
    ritualNudgeText("evening", { items: [item({}), item({}), item({ status: "moved" })], rows: [] }),
    "2 outcomes today. What did you get done?",
  );
});

// ---------- the whole day ----------

test("a whole day: suggestions, the morning plan, the evening log and tomorrow's carry", () =>
  asNewUser(async () => {
    const uni = await university();
    await week();

    const before = await ritualFor(MORNING);
    assert.deepEqual(
      [before.phase, before.morning, before.evening, before.goal_id],
      ["morning", "due", "not_yet", null],
    );
    assert.deepEqual(before.goals, [{ id: uni.id, title: "University", area: "personal" }]);
    assert.equal(before.suggestions[0]?.text, "One University block");
    assert.match(
      before.suggestions[0]?.reason ?? "",
      /^University is 6h 18 behind this week\. One block today\?$/,
    );
    // Before waking nothing shows.
    assert.equal((await ritualFor(at("13", "06:00"))).phase, null);

    // No checklist goal yet: saving makes "Today's outcomes" silently.
    const planned = await planMorning(
      {
        outcomes: [
          { text: " Statistics past paper ", goal_id: uni.id, estimate_minutes: 90 },
          { text: "Call the bank" },
          { text: "call the bank" },
        ],
      },
      MORNING,
    );
    assert.equal(planned.morning, "done");
    assert.deepEqual(planned.suggestions, []);
    const goal = await store.getGoal(planned.goal_id ?? "");
    assert.ok(goal);
    assert.deepEqual(
      [goal.title, goalKind(goal), goal.weekly_budget_minutes],
      [OUTCOMES_TITLE, "checklist", null],
    );
    assert.deepEqual(
      planned.items.map((i) => [i.text, i.linked_goal_id, i.estimate_minutes, i.position]),
      [
        ["Statistics past paper", uni.id, 90, 0],
        ["Call the bank", null, null, 1],
      ],
    );
    // The chips never offer the outcomes goal itself.
    assert.deepEqual(
      planned.goals.map((g) => g.title),
      ["University"],
    );
    // Three is the most for the day; a goal that is not the user's writes nothing.
    await assert.rejects(
      planMorning({ outcomes: [{ text: "One" }, { text: "Two" }] }, MORNING),
      /Three outcomes/,
    );
    await assert.rejects(
      planMorning({ outcomes: [{ text: "Three", goal_id: randomUUID() }] }, MORNING),
      /Goal not found/,
    );
    assert.equal((await ritualFor(MORNING)).items.length, 2);

    const [paper, bank] = planned.items as [ChecklistItem, ChecklistItem];
    const evening = await ritualFor(EVENING);
    assert.deepEqual(
      [evening.phase, evening.evening, evening.tomorrow],
      ["evening", "due", "University at 09:00"],
    );

    const out = await logEvening(
      {
        results: [
          { item_id: paper.id, result: "partly", minutes: 40, carry: true },
          { item_id: bank.id, result: "done" },
        ],
      },
      EVENING,
    );
    assert.equal(
      out.summary,
      "1 of 2 done, 1 partly. 40 min logged for University. One carried to tomorrow. Tomorrow starts with University at 09:00.",
    );
    assert.deepEqual(out.logged, [{ goal_id: uni.id, minutes: 40 }]);
    assert.equal(out.carried.length, 1);
    assert.deepEqual(
      [
        out.carried[0]?.date,
        out.carried[0]?.carried_from,
        out.carried[0]?.linked_goal_id,
        out.carried[0]?.status,
      ],
      ["2026-11-14", paper.id, uni.id, "open"],
    );
    const settled = await store.getChecklistItem(paper.id);
    assert.deepEqual([settled?.status, settled?.logged_minutes, settled?.settled_by], ["partly", 40, "user"]);
    assert.deepEqual([out.ritual.evening, out.ritual.summary], ["done", out.summary]);

    // Tomorrow morning the carried outcome waits, and the morning still asks.
    const saturday = await ritualFor(at("14", "08:30"));
    assert.deepEqual(
      [saturday.morning, saturday.items.map((i) => i.text)],
      ["due", ["Statistics past paper"]],
    );
  }));

test("not, carried: the old outcome moves; tomorrow full is refused before anything is written", () =>
  asNewUser(async () => {
    const planned = await planMorning({ outcomes: [{ text: "Write the essay" }] }, MORNING);
    const essay = planned.items[0] as ChecklistItem;
    await planMorning({ outcomes: [{ text: "A" }, { text: "B" }, { text: "C" }] }, at("14", "09:00"));
    await assert.rejects(
      logEvening({ results: [{ item_id: essay.id, result: "not", carry: true }] }, EVENING),
      /Tomorrow already has three/,
    );
    assert.equal((await store.getChecklistItem(essay.id))?.status, "open");

    const out = await logEvening({ results: [{ item_id: essay.id, result: "not" }] }, EVENING);
    assert.equal(out.summary, "0 of 1 done.");
    assert.equal((await store.getChecklistItem(essay.id))?.status, "dropped");
  }));

test("Not today hides that half for the day", () =>
  asNewUser(async () => {
    const skipped = await skipRitual("morning", MORNING);
    assert.equal(skipped.morning, "skipped");
    assert.deepEqual(skipped.suggestions, []);
    // A later plan from chat still counts.
    const planned = await planMorning({ outcomes: [{ text: "Gym" }] }, MORNING);
    assert.equal(planned.morning, "done");
    const evening = await skipRitual("evening", EVENING);
    assert.equal(evening.evening, "skipped");
  }));

test("over HTTP: the key is needed, the body is checked and a preview phase is honoured", async () => {
  assert.equal((await app.request("/v1/ritual")).status, 401);
  const headers = { Authorization: "Bearer dev-key", "content-type": "application/json" };
  const res = await app.request("/v1/ritual?phase=evening", { headers });
  assert.equal(res.status, 200);
  assert.equal(RitualToday.parse(await res.json()).phase, "evening");
  const bad = await app.request("/v1/ritual/morning", {
    method: "POST",
    headers,
    body: JSON.stringify({ outcomes: [] }),
  });
  assert.equal(bad.status, 400);
  const four = await app.request("/v1/ritual/morning", {
    method: "POST",
    headers,
    body: JSON.stringify({ outcomes: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }] }),
  });
  assert.equal(four.status, 400);
  assert.equal((await app.request("/v1/ritual/noon/skip", { method: "POST", headers })).status, 400);
});

test("the demo week: today's plan filled and two evenings logged, written once", () =>
  asNewUser(async () => {
    await store.seedGoals(demoGoals, { overwrite: true });
    const days = ["2026-11-11", "2026-11-12", "2026-11-13"];
    await seedDemoRitual(store, days);
    await seedDemoRitual(store, days);
    const items = await store.listChecklist({ from: "2026-11-11", to: "2026-11-13" });
    const on = (d: string) => items.filter((i) => i.date === d).map((i) => [i.text, i.status]);
    assert.deepEqual(on("2026-11-13"), [
      ["Statistics past paper", "open"],
      ["Call three leads", "open"],
      ["Yoga before bed", "open"],
    ]);
    assert.deepEqual(on("2026-11-12"), [
      ["Finish the marketing post", "done"],
      ["Long swim", "done"],
      ["Statistics past paper", "moved"],
    ]);
    const rows = await store.listRituals({ from: "2026-11-11", to: "2026-11-13" });
    const evenings = rows.filter((r) => r.kind === "evening").sort((a, b) => a.day.localeCompare(b.day));
    assert.deepEqual(
      evenings.map((r) => r.summary),
      [
        "1 of 3 done, 1 partly. 45 min logged for The company, 1h for University.",
        "2 of 3 done. 50 min logged for The company, 1h for 70.3. One carried to tomorrow.",
      ],
    );
    const today = await ritualFor(at("13", "21:30"));
    assert.deepEqual([today.morning, today.evening, today.items.length], ["done", "due", 3]);
  }));

// ---------- chat, with Claude mocked ----------

type Reply = { text?: string; tool?: { name: string; input: unknown } };

function fakeClaude(replies: Reply[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  let i = 0;
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParams) => {
        requests.push({ ...params, messages: [...params.messages] });
        const r = replies[i] ?? { text: "Nothing more." };
        const n = i++;
        return {
          stop_reason: r.tool ? "tool_use" : "end_turn",
          content: [
            ...(r.text ? [{ type: "text", text: r.text }] : []),
            ...(r.tool
              ? [{ type: "tool_use", id: `toolu_${n}`, name: r.tool.name, input: r.tool.input }]
              : []),
          ],
        } as unknown as Anthropic.Message;
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const lastToolResult = (req: Anthropic.MessageCreateParams | undefined) => {
  const last = req?.messages.at(-1);
  const blocks = (Array.isArray(last?.content) ? last.content : []) as Anthropic.ContentBlockParam[];
  const result = blocks.find((b) => b.type === "tool_result") as Anthropic.ToolResultBlockParam | undefined;
  return typeof result?.content === "string" ? result.content : JSON.stringify(result?.content);
};

test("chat: 'my goals today are X, Y' sets the outcomes; 'I finished X, did 30 min of Y' logs them", () =>
  asNewUser(async () => {
    const uni = await university();
    const morning = fakeClaude([
      {
        tool: {
          name: "set_day_outcomes",
          input: { outcomes: [{ text: "Send the deck" }, { text: "Revise chapter 4", goal_id: uni.id }] },
        },
      },
      { text: "Two outcomes for today. Send the deck, and chapter 4 for University." },
    ]);
    setChatClientForTests(morning.client);
    try {
      const { answer } = await askMichael(
        [{ role: "user", content: "My goals today are the deck and chapter 4" }],
        "ctx",
      );
      assert.match(answer, /Two outcomes/);
      assert.match(lastToolResult(morning.requests[1]), /Kept today's outcomes \(2 of 3\)/);
      assert.ok(morning.requests[0]?.tools?.some((t) => "name" in t && t.name === "log_day"));
    } finally {
      setChatClientForTests(null);
    }

    const today = await ritualFor();
    const [deck, chapter] = today.items as [ChecklistItem, ChecklistItem];
    assert.equal(chapter.linked_goal_id, uni.id);
    const evening = fakeClaude([
      {
        tool: {
          name: "log_day",
          input: {
            results: [
              { item_id: deck.id, result: "done" },
              { item_id: chapter.id, result: "partly", minutes: 30 },
            ],
          },
        },
      },
      { text: "1 of 2 done, 1 partly. 30 min logged for University." },
    ]);
    setChatClientForTests(evening.client);
    try {
      await askMichael([{ role: "user", content: "I finished the deck, did 30 min of chapter 4" }], "ctx");
      assert.match(
        lastToolResult(evening.requests[1]),
        /^Logged\. Tell the user this line, word for word: "1 of 2 done, 1 partly\. 30 min logged for University\./,
      );
    } finally {
      setChatClientForTests(null);
    }
    assert.equal((await store.getChecklistItem(chapter.id))?.logged_minutes, 30);
    assert.equal((await ritualFor()).evening, "done");
  }));

test("the evening log moves the goal's week: logged minutes count toward its budget (#317, #372)", () =>
  asNewUser(async () => {
    const uni = await university();
    const now = Date.now();
    const goalRow = async () => (await loadWeek({})).score.goals.find((g) => g.goal_id === uni.id);
    const done = (g: { spent_minutes: number; logged_minutes?: number } | undefined) =>
      (g?.spent_minutes ?? 0) + (g?.logged_minutes ?? 0);
    const before = done(await goalRow());

    const planned = await planMorning({ outcomes: [{ text: "Past paper", goal_id: uni.id }] }, now);
    const [paper] = planned.items as [ChecklistItem];
    const out = await logEvening({ results: [{ item_id: paper.id, result: "partly", minutes: 25 }] }, now);
    assert.deepEqual(out.logged, [{ goal_id: uni.id, minutes: 25 }]);
    const after = await goalRow();
    // 25 more minutes toward the budget, outside any block so outside the score (a run just after
    // midnight may put some in yesterday: skip then).
    const athens = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(ms);
    const justAfterMidnight = athens(now - 25 * 60_000) !== athens(now);
    if (!justAfterMidnight) {
      assert.equal(done(after) - before, 25);
      assert.equal(after?.logged_minutes, 25);
      assert.equal(after?.unverified_minutes, 0);
    }

    // A goal that takes no minutes (the outcomes checklist itself), or one that is gone: not counted.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(now);
    const checklistGoal = planned.goal_id as string;
    assert.deepEqual(await logDoneTime({ goal_id: checklistGoal, minutes: 10, day, note: "x" }, now), {
      counted: false,
    });
    assert.deepEqual(await logDoneTime({ goal_id: randomUUID(), minutes: 10, day, note: "x" }, now), {
      counted: false,
    });
  }));
