import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateFocusBlockPayload, MoveCalendarBlockPayload } from "@michael/shared";
import { T } from "../patterns/testkit";
import type { BriefContext } from "./brief";
import {
  ANSWER_JSON_SCHEMA,
  AnswerError,
  type CoachAnswer,
  enforce,
  lintCopy,
  lintText,
  MAX_RECOMMENDATIONS,
  type ModelAction,
  OFFER_RULE,
  parseAnswer,
} from "./output";
import type { PlanEvent } from "./plan";

// Everything here is made up.

const GOAL = "10000000-0000-4000-8000-0000000000a1";
const STUDY_ID = "00000000-0000-4000-8000-0000000000b1";
const GYM_ID = "00000000-0000-4000-8000-0000000000b2";
const ms = (local: string) => Date.parse(T(local));
const block = (id: string, title: string, start: string, end: string): PlanEvent => ({
  eventId: id,
  kind: "goal_block",
  goal: null,
  title,
  start: ms(start),
  end: ms(end),
});
const study = block(STUDY_ID, "Study: finance", "2026-11-11 10:00", "2026-11-11 12:00");
const gym = block(GYM_ID, "Gym", "2026-11-11 18:00", "2026-11-11 19:30");

const ctx: BriefContext = {
  timezone: "Europe/Athens",
  now: ms("2026-11-10 21:00"),
  goalIds: new Set([GOAL]),
  blocks: new Map([
    ["b1", study],
    ["b2", gym],
  ]),
  goalBlocks: [study, gym],
  // A meeting with other people tomorrow from 14:00 to 15:00.
  busy: [{ start: ms("2026-11-11 14:00"), end: ms("2026-11-11 15:00") }],
  blockTitles: new Map([[GOAL, "University study"]]),
  patterns: new Set(["phone_cadence", "repeat_offenders"]),
  actionsAre: "offers",
};

const action = (over: Partial<ModelAction>): ModelAction => ({
  kind: "move_calendar_block",
  block: null,
  day: null,
  start: null,
  end: null,
  app: null,
  text: null,
  ...over,
});
const answer = (
  recs: Partial<CoachAnswer["recommendations"][number]>[],
  over: Partial<CoachAnswer> = {},
): CoachAnswer => ({
  summary: "We got 97 of 120 minutes.",
  question: null,
  recommendations: recs.map((r) => ({
    goal_id: GOAL,
    title: "Instagram took 23 minutes of your study block.",
    rationale: "That is 23 of 120 minutes. Tomorrow the phone stays in the other room from 10:00.",
    action: null,
    evidence: ["repeat_offenders"],
    ...r,
  })),
  ...over,
});
const one = (a: ModelAction) => enforce(answer([{ action: a }]), ctx);

test("parseAnswer accepts the agreed shape and says why it refuses anything else", () => {
  const good = JSON.stringify(answer([{}]));
  assert.equal(parseAnswer(good).recommendations.length, 1);
  assert.throws(() => parseAnswer("Here is my answer: {"), AnswerError);
  assert.throws(() => parseAnswer(JSON.stringify({ summary: "x" })), /agreed shape/);
  assert.throws(() => parseAnswer(JSON.stringify({ ...answer([{}]), summary: "" })), /summary/);
  assert.throws(() => parseAnswer(JSON.stringify(answer([{ title: "" }]))), /title/);
  assert.throws(() => parseAnswer("null"), AnswerError);
});

test("the schema sent to the API closes every object and requires every key", () => {
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "object") {
      assert.equal(n.additionalProperties, false);
      assert.deepEqual([...(n.required as string[])].sort(), Object.keys(n.properties as object).sort());
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(ANSWER_JSON_SCHEMA);
  // The example answer the tests use passes the same shape through zod.
  assert.doesNotThrow(() => parseAnswer(JSON.stringify(answer([{ action: action({ kind: "reminder" }) }]))));
});

test("a goal that is not the person's becomes null, the recommendation stays", () => {
  const out = enforce(answer([{ goal_id: "not-a-goal" }, { goal_id: null }, {}]), ctx);
  assert.deepEqual(
    out.recommendations.map((r) => r.goal_id),
    [null, null, GOAL],
  );
  assert.deepEqual(
    out.corrections.map((c) => [c.kind, c.where]),
    [["goal_unknown", "recommendations[0].goal_id"]],
  );
});

test("at most three recommendations, the first stays the lead", () => {
  const out = enforce(
    answer([{ title: "One." }, { title: "Two." }, { title: "Three." }, { title: "Four." }]),
    ctx,
  );
  assert.equal(out.recommendations.length, MAX_RECOMMENDATIONS);
  assert.equal(out.recommendations[0]?.title, "One.");
  assert.equal(out.corrections[0]?.kind, "too_many");
});

test("evidence keeps only patterns that had data in the brief", () => {
  const out = enforce(
    answer([{ evidence: ["phone_cadence", "made_up", "phone_cadence", "late_screens"] }]),
    ctx,
  );
  assert.deepEqual(out.recommendations[0]?.evidence, ["phone_cadence"]);
  assert.equal(out.corrections[0]?.kind, "evidence_unknown");
});

test("evidence may also be the plan or the score, when the finding comes from those", () => {
  const out = enforce(answer([{ evidence: ["plan", "score", "phone_cadence", "calendar"] }]), ctx);
  assert.deepEqual(out.recommendations[0]?.evidence, ["plan", "score", "phone_cadence"]);
  const items = ANSWER_JSON_SCHEMA.properties.recommendations.items.properties.evidence.items;
  assert.ok(
    items.enum.includes("plan") && items.enum.includes("score") && items.enum.includes("late_screens"),
  );
});

test("moving the person's own block is stored with the event behind the ref", () => {
  const out = one(action({ block: "b2", day: "2026-11-11", start: "07:00" }));
  assert.deepEqual(out.corrections, []);
  assert.deepEqual(out.recommendations[0]?.action, {
    kind: "move_calendar_block",
    // Exactly the payload POST /v1/recommendations/:id/execute takes. The length is kept.
    payload: {
      event_id: GYM_ID,
      start_at: new Date(ms("2026-11-11 07:00")).toISOString(),
      end_at: new Date(ms("2026-11-11 08:30")).toISOString(),
    },
    involves_others: false,
    // Undo until the earlier of the old and the new start.
    undo_until: new Date(ms("2026-11-11 07:00")).toISOString(),
  });
});

test("an action on anything that is not the person's own block is dropped, the advice stays", () => {
  const dropped = (a: ModelAction, reason: RegExp) => {
    const out = one(a);
    assert.equal(out.recommendations.length, 1, "the recommendation itself stays");
    assert.equal(out.recommendations[0]?.action, null);
    assert.equal(out.corrections[0]?.kind, "action_dropped");
    assert.match(out.corrections[0]?.detail ?? "", reason);
  };
  // Someone else's event has no ref, so nothing the model writes can name it.
  dropped(action({ block: "b9", day: "2026-11-11", start: "16:00" }), /own blocks/);
  dropped(action({ block: "evt-meeting", day: "2026-11-11", start: "16:00" }), /own blocks/);
  dropped(action({ block: null, day: "2026-11-11", start: "16:00" }), /own blocks/);
  // The person's own block, moved on top of a meeting.
  dropped(action({ block: "b1", day: "2026-11-11", start: "13:30" }), /other people/);
  // Into the past, or with a time that is not a time.
  dropped(action({ block: "b1", day: "2026-11-10", start: "09:00" }), /past/);
  dropped(action({ block: "b1", day: "tomorrow", start: "7am" }), /valid/);
  // A kind that does not exist (a model that slipped past the schema).
  dropped(action({ kind: "delete_event", block: "b1" }), /not an action/);
  dropped(action({ kind: "send_message", text: "On my way" }), /not an action/);
});

test("a new focus block must be in the future and clear of other people", () => {
  const good = one(action({ kind: "create_focus_block", day: "2026-11-11", start: "08:00", end: "09:30" }));
  assert.deepEqual(good.recommendations[0]?.action, {
    kind: "create_focus_block",
    // Named like the goal's own blocks, so the score counts it towards the goal.
    payload: {
      start_at: new Date(ms("2026-11-11 08:00")).toISOString(),
      end_at: new Date(ms("2026-11-11 09:30")).toISOString(),
      title: "University study",
      goal_id: GOAL,
    },
    involves_others: false,
    undo_until: new Date(ms("2026-11-11 08:00")).toISOString(),
  });
  const overlap = one(
    action({ kind: "create_focus_block", day: "2026-11-11", start: "14:30", end: "16:00" }),
  );
  assert.equal(overlap.recommendations[0]?.action, null);
  const past = one(action({ kind: "create_focus_block", day: "2026-11-10", start: "20:00", end: "20:30" }));
  assert.equal(past.recommendations[0]?.action, null);
  const noEnd = one(action({ kind: "create_focus_block", day: "2026-11-11", start: "08:00" }));
  assert.equal(noEnd.recommendations[0]?.action, null);
});

test("stored payloads are the ones the execute route accepts", () => {
  const moved = one(action({ block: "b1", day: "2026-11-11", start: "08:00", end: "09:00" }));
  assert.ok(MoveCalendarBlockPayload.safeParse(moved.recommendations[0]?.action?.payload).success);
  // No goal on the recommendation: the model's own short name is used, or none at all.
  const named = enforce(
    answer([
      {
        goal_id: null,
        action: action({
          kind: "create_focus_block",
          day: "2026-11-11",
          start: "08:00",
          end: "09:00",
          text: "Deep work",
        }),
      },
      {
        goal_id: null,
        action: action({ kind: "create_focus_block", day: "2026-11-11", start: "20:00", end: "21:00" }),
      },
    ]),
    ctx,
  );
  const [first, second] = named.recommendations.map((r) => r.action?.payload);
  assert.equal(first?.title, "Deep work");
  assert.equal(second?.title, undefined);
  assert.ok(CreateFocusBlockPayload.safeParse(first).success);
  assert.ok(CreateFocusBlockPayload.safeParse(second).success);
});

test("closing a Mac app needs an app and a window inside a planned block", () => {
  const good = one(
    action({
      kind: "block_mac_app",
      block: "b1",
      day: "2026-11-11",
      start: "10:00",
      end: "12:00",
      app: "WhatsApp",
    }),
  );
  assert.equal(good.recommendations[0]?.action?.kind, "block_mac_app");
  assert.deepEqual(good.recommendations[0]?.action?.payload, {
    app: "WhatsApp",
    start_at: new Date(study.start).toISOString(),
    end_at: new Date(study.end).toISOString(),
    block_event_id: STUDY_ID,
  });
  // No ref, but the window sits inside a block: fine.
  const inferred = one(
    action({ kind: "block_mac_app", day: "2026-11-11", start: "18:15", end: "19:00", app: "WhatsApp" }),
  );
  assert.equal(inferred.recommendations[0]?.action?.payload.block_event_id, GYM_ID);
  for (const bad of [
    action({
      kind: "block_mac_app",
      block: "b1",
      day: "2026-11-11",
      start: "09:00",
      end: "12:00",
      app: "WhatsApp",
    }),
    action({ kind: "block_mac_app", day: "2026-11-11", start: "15:00", end: "16:00", app: "WhatsApp" }),
    action({ kind: "block_mac_app", block: "b1", day: "2026-11-11", start: "10:00", end: "12:00", app: " " }),
    action({
      kind: "block_mac_app",
      block: "b7",
      day: "2026-11-11",
      start: "10:00",
      end: "12:00",
      app: "WhatsApp",
    }),
  ]) {
    assert.equal(one(bad).recommendations[0]?.action, null);
  }
});

test("a draft is only ever a draft, a reminder needs a time ahead", () => {
  const draft = one(action({ kind: "draft_follow_up", text: " Can we move Thursday to 16:00? " }));
  assert.deepEqual(draft.recommendations[0]?.action, {
    kind: "draft_follow_up",
    payload: { text: "Can we move Thursday to 16:00?" },
    involves_others: false,
    undo_until: null,
  });
  assert.equal(one(action({ kind: "draft_follow_up" })).recommendations[0]?.action, null);
  const reminder = one(
    action({ kind: "reminder", day: "2026-11-11", start: "09:45", text: "Phone in the other room." }),
  );
  assert.deepEqual(reminder.recommendations[0]?.action?.payload, {
    at: new Date(ms("2026-11-11 09:45")).toISOString(),
    text: "Phone in the other room.",
  });
  assert.equal(
    one(action({ kind: "reminder", day: "2026-11-10", start: "09:45", text: "Late." })).recommendations[0]
      ?.action,
    null,
  );
});

test("lintText finds dashes used as punctuation and lets hyphens inside words pass", () => {
  const rules = (text: string) => lintText(text).map((v) => v.rule);
  assert.deepEqual(rules("We got 2 of 6 hours. Most of it went between 11:00 and 14:00."), []);
  assert.deepEqual(rules("A follow-up for the 70.3, well-earned."), []);
  for (const text of [
    "We lost 40 minutes — mostly to Instagram.",
    "We lost 40 minutes – mostly to Instagram.",
    "We lost 40 minutes - mostly to Instagram.",
    "We lost 40 minutes -- mostly to Instagram.",
    "Most of it went 11:00-14:00.",
    "- one fix",
  ]) {
    assert.match(rules(text).join(), /no dashes/, text);
  }
});

test("lintText finds emoji, exclamation marks and the words Michael never uses", () => {
  const rules = (text: string) => lintText(text).map((v) => v.rule);
  assert.match(rules("6 of 6 hours. Third day running!").join(), /exclamation/);
  assert.match(rules("6 of 6 hours \u{1F4AA}").join(), /emoji/);
  assert.match(rules("6 of 6 hours ✅").join(), /emoji/);
  for (const [text, word] of [
    ["Your productivity dipped after lunch.", "productivity"],
    ["Keep up the hustle.", "hustle"],
    ["You crushed it.", "crush"],
    ["A long journey.", "journey"],
    ["Wellness first.", "wellness"],
    ["This unlocks 40 minutes.", "unlock"],
    ["You have the potential.", "potential"],
    ["Amazing day.", "amazing"],
    ["Great job today.", "great job"],
  ] as const) {
    assert.ok(rules(text).includes(`never use the word "${word}"`), text);
  }
  // The shared voice sheet's own words are caught too.
  assert.ok(rules("31 pickups before noon.").includes('never use the word "pickups"'));
  // Words that only look like them.
  assert.deepEqual(rules("The brush is in the bathroom. A productive 104 minutes."), []);
  const hit = lintText("You crushed it!")[0];
  assert.match(hit?.found ?? "", /crushed/);
});

test("while actions are offers, a line that says it is already done is a violation", () => {
  const withLine = (rationale: string, summary = "University has 2 of its 6 hours planned.") =>
    enforce(answer([{ rationale }], { summary }), ctx);
  const rules = (rationale: string, summary?: string, mode?: "offers" | "applied") =>
    lintCopy(withLine(rationale, summary), mode).map((v) => [v.where, v.rule]);

  for (const claim of [
    "I've set a reminder for 20:30.",
    "I've added a University block at 08:00.",
    "I have moved your run to 07:00.",
    "I moved your run to 07:00. Undo until 07:00.",
    "I set a reminder for 20:30.",
    "I closed WhatsApp until 12:00.",
    "Tomorrow the hardest work goes first. Already moved.",
    "Both are already set.",
  ]) {
    assert.deepEqual(rules(claim), [["recommendations[0].rationale", OFFER_RULE]], claim);
  }
  assert.deepEqual(
    rules("Phone in the bag from 20:30.", "We got 2 of 6 hours. I've moved your run to 07:00."),
    [["summary", OFFER_RULE]],
  );

  // Offers, and plain facts about the person's own day, pass.
  for (const fine of [
    "I can move your run to 07:00. One tap.",
    "I can add a University block at 08:00 tomorrow. One tap.",
    "I'll hold it until you tap.",
    "The run is set for 08:30 on your calendar.",
    "You moved Thursday's gym hour twice.",
    "A reminder at 20:30 helps: phone in the bag.",
  ]) {
    assert.deepEqual(rules(fine), [], fine);
  }

  // When actions are applied as the answer is written, saying so is the rule, not a violation.
  assert.deepEqual(rules("I moved your run to 07:00. Undo until 07:00.", undefined, "applied"), []);
  // A title is the finding, not the fix: it is not checked for this.
  assert.deepEqual(lintCopy(enforce(answer([{ title: "I moved 3 blocks this week." }]), ctx)), []);
});

test("lintCopy checks every line the person reads and says where", () => {
  const enforced = enforce(
    answer(
      [
        { title: "Instagram took 23 minutes!" },
        { rationale: "That is 23 of 120 minutes — a lot." },
        { action: action({ kind: "draft_follow_up", text: "Great job on Thursday!" }) },
      ],
      { summary: "Rough one. We got 97 of 120 minutes.", question: "Was the 18:00 block training or rest?" },
    ),
    ctx,
  );
  assert.deepEqual(
    lintCopy(enforced).map((v) => [v.where, v.rule.split(":")[0]]),
    [
      ["recommendations[0].title", "no exclamation marks"],
      ["recommendations[1].rationale", "no dashes as punctuation"],
    ],
    "a draft is the person's own words to someone else: it is not Michael's copy",
  );
  assert.deepEqual(lintCopy(enforce(answer([{}]), ctx)), []);
});
