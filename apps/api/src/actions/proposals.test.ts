import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { Recommendation } from "@michael/shared";
import { runAsUser } from "../context";
import { withoutInstructions } from "../instructions/testkit";
import { askMichael, setChatClientForTests } from "../routes/chat";
import { store } from "../store";
import { executeRecommendation, revertExpiredGoalChanges, undoRecommendation } from "./calendar";

// #188: Michael proposes goal and plan changes from what the user told him; nothing changes until
// the user accepts, every accepted change can be undone. Claude is a scripted stand in.

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

type Reply = { text?: string; tools?: { name: string; input: unknown }[] };

function fakeClaude(replies: Reply[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  let i = 0;
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParams) => {
        requests.push({ ...params, messages: [...params.messages] });
        const r = replies[i] ?? { text: "Nothing more to add." };
        const n = i++;
        return {
          stop_reason: r.tools?.length ? "tool_use" : "end_turn",
          content: [
            ...(r.text ? [{ type: "text", text: r.text }] : []),
            ...(r.tools ?? []).map((t, k) => ({
              type: "tool_use",
              id: `toolu_${n}_${k}`,
              name: t.name,
              input: t.input,
            })),
          ],
        } as unknown as Anthropic.Message;
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

async function withClaude<T>(replies: Reply[], fn: (r: Anthropic.MessageCreateParams[]) => Promise<T>) {
  const { client, requests } = fakeClaude(replies);
  setChatClientForTests(client);
  try {
    return await fn(requests);
  } finally {
    setChatClientForTests(null);
  }
}

function toolResults(req: Anthropic.MessageCreateParams | undefined) {
  const last = req?.messages.at(-1);
  const blocks = (Array.isArray(last?.content) ? last.content : []) as Anthropic.ContentBlockParam[];
  return blocks.filter((b) => b.type === "tool_result") as Anthropic.ToolResultBlockParam[];
}

const asNewUser = <T>(fn: () => Promise<T>) =>
  runAsUser(randomUUID(), async () => {
    await withoutInstructions(store);
    return fn();
  });

const turns = (text: string): Anthropic.MessageParam[] => [{ role: "user", content: text }];

async function twoGoals() {
  const uni = await store.createGoal({
    category: "personal",
    title: "University",
    weekly_budget_minutes: 240,
    active: true,
  });
  const biz = await store.createGoal({
    category: "business",
    title: "Business",
    weekly_budget_minutes: 600,
    active: true,
  });
  return { uni, biz };
}

test("exams: Michael proposes raising University and lowering Business; nothing changes until Accept, undo puts it back", () =>
  asNewUser(async () => {
    const { uni, biz } = await twoGoals();
    const until = iso(Date.now() + 21 * DAY);
    const proposal = {
      name: "propose_goal_change",
      input: {
        changes: [
          { goal_id: uni.id, weekly_budget_minutes: 480 },
          { goal_id: biz.id, weekly_budget_minutes: 360 },
        ],
        until,
        title: "University 8h a week for 3 weeks, Business 6h",
        reason: "Exams from 1 December.",
      },
    };
    await withClaude(
      [
        { tools: [proposal] },
        { text: "University 4h to 8h a week for 3 weeks, Business 10h to 6h. Tap Accept." },
      ],
      async (requests) => {
        const { answer, actions } = await askMichael(turns("I have exams from 1 December"), "context");
        assert.match(answer, /Tap Accept/);
        assert.equal(actions.length, 1);
        const rec = Recommendation.parse(actions[0]);
        assert.equal(rec.status, "proposed");
        assert.equal(rec.source, "chat");
        assert.equal(rec.action?.kind, "change_goal");
        assert.match(
          String(toolResults(requests[1])[0]?.content),
          /Proposed, not applied: University: 4h to 8h a week; Business: 10h to 6h a week/,
        );

        // Never applied silently.
        assert.equal((await store.getGoal(uni.id))?.weekly_budget_minutes, 240);
      },
    );

    // One tap: the executor behind POST /v1/recommendations/:id/execute.
    const [rec] = (await store.listRecommendations({ status: "proposed" })).filter(
      (r) => r.action?.kind === "change_goal",
    );
    assert.ok(rec);
    const done = await executeRecommendation(rec.id);
    assert.equal(done.status, "done");
    assert.equal((await store.getGoal(uni.id))?.weekly_budget_minutes, 480);
    assert.equal((await store.getGoal(biz.id))?.weekly_budget_minutes, 360);
    await undoRecommendation(rec.id);
    assert.equal((await store.getGoal(uni.id))?.weekly_budget_minutes, 240);
    assert.equal((await store.getGoal(biz.id))?.weekly_budget_minutes, 600);
  }));

test("a temporary goal change goes back by itself once its end has passed", () =>
  asNewUser(async () => {
    const { uni } = await twoGoals();
    await withClaude(
      [
        {
          tools: [
            {
              name: "propose_goal_change",
              input: {
                changes: [{ goal_id: uni.id, weekly_budget_minutes: 480 }],
                until: iso(Date.now() + 7 * DAY),
                title: "University 8h a week this week",
                reason: "Exam on Friday.",
              },
            },
          ],
        },
        { text: "University 4h to 8h this week. Tap Accept." },
      ],
      async () => {
        const { actions } = await askMichael(turns("Exam on Friday"), "context");
        await executeRecommendation(actions[0]?.id as string);
      },
    );
    assert.equal(await revertExpiredGoalChanges(Date.now()), 0);
    assert.equal((await store.getGoal(uni.id))?.weekly_budget_minutes, 480);
    assert.equal(await revertExpiredGoalChanges(Date.now() + 8 * DAY), 1);
    assert.equal((await store.getGoal(uni.id))?.weekly_budget_minutes, 240);
  }));

test("one proposal per answer, and a declined proposal is not made again that week", () =>
  asNewUser(async () => {
    const { uni, biz } = await twoGoals();
    const raise = (id: string) => ({
      name: "propose_goal_change",
      input: {
        changes: [{ goal_id: id, weekly_budget_minutes: 480 }],
        title: "University 8h",
        reason: "Exams.",
      },
    });
    await withClaude(
      [{ tools: [raise(uni.id), raise(biz.id)] }, { text: "University 8h a week. Tap Accept." }],
      async (requests) => {
        const { actions } = await askMichael(turns("Exams soon"), "context");
        assert.equal(actions.length, 1);
        const [first, second] = toolResults(requests[1]);
        assert.equal(first?.is_error, undefined);
        assert.equal(second?.is_error, true);
        assert.match(String(second?.content), /One proposal per answer/);
        await store.updateRecommendationStatus(actions[0]?.id as string, "dismissed");
      },
    );
    await withClaude([{ tools: [raise(uni.id)] }, { text: "Understood." }], async (requests) => {
      const { actions } = await askMichael(turns("Exams soon, again"), "context");
      assert.equal(actions.length, 0);
      const [result] = toolResults(requests[1]);
      assert.equal(result?.is_error, true);
      assert.match(String(result?.content), /declined/);
    });
  }));

test("knee: runs become swims as one plan; accepted together, undone together, never with other people", () =>
  asNewUser(async () => {
    const t1 = Date.now() + DAY;
    const t2 = Date.now() + 2 * DAY;
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(t1),
        end_at: iso(t1 + HOUR),
        title: "Run",
        data: {},
      },
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(t2),
        end_at: iso(t2 + HOUR),
        title: "Run",
        data: {},
      },
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(t2 + 3 * HOUR),
        end_at: iso(t2 + 4 * HOUR),
        title: "Club run",
        data: { with_others: true, attendees: 6 },
      },
    ]);
    const [run1, run2, club] = inserted;
    assert.ok(run1 && run2 && club);
    const swap = (ids: string[]) => ({
      name: "propose_plan_change",
      input: {
        steps: ids.map((event_id) => ({ kind: "move_calendar_block", event_id, new_title: "Swim" })),
        title: "Swap 2 runs for swims this week",
        reason: "Knee hurts.",
      },
    });

    // The club run has other people in it: refused, the model advises instead.
    await withClaude(
      [{ tools: [swap([run1.id, club.id])] }, { text: "The club run is not mine to move." }],
      async (requests) => {
        const { actions } = await askMichael(turns("My knee hurts"), "context");
        assert.equal(actions.length, 0);
        assert.match(String(toolResults(requests[1])[0]?.content), /other people/);
      },
    );

    await withClaude(
      [{ tools: [swap([run1.id, run2.id])] }, { text: "2 runs become swims. Tap Accept." }],
      async () => {
        const { actions } = await askMichael(turns("My knee hurts"), "context");
        const rec = Recommendation.parse(actions[0]);
        assert.equal(rec.status, "proposed");
        assert.equal(rec.action?.kind, "plan_change");
        // Nothing moved yet.
        assert.equal((await store.getEvent(run1.id))?.title, "Run");

        const done = await executeRecommendation(rec.id);
        assert.equal(done.status, "done");
        assert.equal((await store.getEvent(run1.id))?.title, "Swim");
        assert.equal((await store.getEvent(run2.id))?.title, "Swim");
        await undoRecommendation(rec.id);
        assert.equal((await store.getEvent(run1.id))?.title, "Run");
        assert.equal((await store.getEvent(run2.id))?.title, "Run");
      },
    );
  }));
