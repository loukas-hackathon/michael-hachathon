import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  Dnd,
  DndOffer,
  EventInput,
  FocusGuardsResponse,
  focusShortcutInput,
  type Nudge,
  nudgeBlockId,
  nudgeTrigger,
  nudgeUrl,
  voiceProblems,
} from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { DEMO_VISITOR_MESSAGE, demoVisitorMay } from "../demo/visitor";
import { env } from "../env";
import { withoutInstructions } from "../instructions/testkit";
import { actionsFor, actOnNudge, handleTelegramCallback, offeredActions } from "../nudges/actions";
import { nudgePayload } from "../nudges/channels";
import { wordCount } from "../nudges/engine";
import { callbackData, configureTelegram } from "../nudges/telegram";
import { store } from "../store";
import { undoRecommendation } from "./calendar";
import { activeDnd, macState, noteMac, resetDnd } from "./dnd";
import { dndOffer, dndOnLine, dndTapLine, startDnd, untilForNudge } from "./dnd-ask";

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const asNewUser = <T>(fn: (userId: string) => Promise<T>) => {
  const userId = randomUUID();
  return runAsUser(userId, async () => {
    await withoutInstructions(store);
    return fn(userId);
  });
};

/** A block running now (it ends in 40 minutes) and the phone nudge sent inside it. */
async function phoneNudge(endsIn = 40 * MIN): Promise<{ nudge: Nudge; end: string }> {
  const end = iso(Date.now() + endsIn);
  const { inserted } = await store.insertEvents([
    EventInput.parse({
      source: "google_calendar",
      type: "calendar_event",
      start_at: iso(Date.now() - 20 * MIN),
      end_at: end,
      title: "Deep work",
      external_id: `dnd-test-${randomUUID()}`,
    }),
  ]);
  const block = inserted[0];
  assert.ok(block);
  const nudge = await store.createNudge({
    recommendation_id: null,
    goal_id: null,
    kind: "focus_drift",
    key: `focus_drift:${block.id}:phone`,
    day: "2026-11-17",
    channel: "push",
    text: "Your phone opened 5 times in Deep work. Put it down until 14:00.",
    reason: "test",
    status: "sent",
  });
  assert.ok(nudge);
  return { nudge, end };
}

/** Every Do Not Disturb card of the current user, whatever its status. */
const dndCards = async () =>
  (await store.listRecommendations()).filter((r) => r.action?.kind === "do_not_disturb");

const lateNudge = async (): Promise<Nudge> => {
  const nudge = await store.createNudge({
    recommendation_id: null,
    goal_id: null,
    kind: "wind_down",
    key: "late_phone:2026-11-17",
    day: "2026-11-17",
    channel: "push",
    text: "40 minutes on your phone since 23:10. Stop here.",
    reason: "test",
    status: "sent",
  });
  assert.ok(nudge);
  return nudge;
};

test("the trigger is read from the key, never from the line, and the block is still found", () => {
  const id = randomUUID();
  const phone = { kind: "focus_drift" as const, key: `focus_drift:${id}:phone` };
  assert.equal(nudgeTrigger(phone), "phone_block");
  assert.equal(nudgeBlockId(phone), id);
  assert.equal(nudgeTrigger({ kind: "focus_drift", key: `test:abc:focus_drift:${id}:phone` }), "phone_block");
  assert.equal(nudgeTrigger({ kind: "focus_drift", key: `focus_drift:${id}` }), null);
  assert.equal(nudgeTrigger({ kind: "wind_down", key: "late_phone:2026-11-17" }), "late_phone");
  assert.equal(nudgeTrigger({ kind: "wind_down", key: "wind_down" }), null);
  // The tap on the app's own card still opens the block, without the suffix.
  assert.equal(
    nudgeUrl({ ...phone, day: "2026-11-17", recommendation_id: null }),
    `/timeline?day=2026-11-17&block=${id}`,
  );
});

test("the offer: a drift and the phone before sleep carry Do Not Disturb, the line before the night does not", () => {
  const id = randomUUID();
  assert.deepEqual(
    actionsFor({ kind: "focus_drift", key: `focus_drift:${id}:phone` }).map((a) => a.id),
    ["dnd", "open"],
  );
  assert.deepEqual(
    actionsFor({ kind: "focus_drift", key: `focus_drift:${id}`, mac_app: "Slack" }).map((a) => a.id),
    ["mute_app", "dnd"],
  );
  assert.deepEqual(
    actionsFor({ kind: "wind_down", key: "late_phone:2026-11-17" }).map((a) => a.label),
    ["Do Not Disturb", "Open"],
  );
  assert.deepEqual(actionsFor({ kind: "wind_down", key: "wind_down" }), []);
  // A stored nudge gets the same buttons back when one is tapped.
  assert.deepEqual(
    offeredActions({
      kind: "wind_down",
      key: "late_phone:2026-11-17",
      text: "x",
      recommendation_id: null,
    }).map((a) => a.id),
    ["dnd", "open"],
  );
});

test("an iPhone shows no buttons: the tap on either real time line opens the hand over page", () =>
  asNewUser(async () => {
    const { nudge } = await phoneNudge();
    assert.equal(nudgePayload({ ...nudge, actions: offeredActions(nudge) }).url, `/dnd?nudge=${nudge.id}`);
    const late = await lateNudge();
    assert.equal(nudgePayload(late).url, `/dnd?nudge=${late.id}`);
  }));

test("until: the end of the nudge's block, or the end of the night's quiet hours", () =>
  asNewUser(async () => {
    const { nudge, end } = await phoneNudge();
    assert.equal(await untilForNudge(nudge), end);
    // 23:50 in Athens on 17 November: the night ends at 07:00 (the default), on the 18th.
    const late = await lateNudge();
    assert.equal(await untilForNudge(late, Date.parse("2026-11-17T21:50:00Z")), "2026-11-18T05:00:00.000Z");
    // 00:30 on the 18th: the same morning.
    assert.equal(await untilForNudge(late, Date.parse("2026-11-17T22:30:00Z")), "2026-11-18T05:00:00.000Z");
    // A block that is over offers nothing.
    const over = await phoneNudge(30_000);
    assert.equal(await untilForNudge(over.nudge), null);
    assert.equal(await untilForNudge({ kind: "block_soon", key: "block_soon:x" }), null);
  }));

test("asked then done: with a Mac that has the shortcut one tap switches it on, logged and undoable", () =>
  asNewUser(async () => {
    resetDnd();
    const { nudge, end } = await phoneNudge();
    noteMac(true);
    assert.equal(macState(), "ready");
    const res = await actOnNudge(nudge.id, "dnd");
    assert.equal(res.action, "dnd");
    assert.equal(res.text, dndOnLine(end));
    assert.match(res.text, /^Do Not Disturb is on until \d\d:\d\d\. Tap to end it\.$/);
    assert.deepEqual(voiceProblems(res.text), []);
    assert.ok(wordCount(res.text) < 15);
    assert.equal(res.undo_until, end);

    // What the Mac reads on its next look.
    const on = await activeDnd();
    assert.equal(on?.until, end);
    assert.equal(res.url, `/dnd?id=${on?.id}`);

    // Logged the way other actions are: a done recommendation, on Today, with until when.
    const rec = await store.getRecommendation(on?.id as string);
    assert.equal(rec?.status, "done");
    assert.equal(rec?.action?.kind, "do_not_disturb");
    assert.equal(rec?.action?.undo_until, end);
    assert.match(rec?.title ?? "", /^Do Not Disturb until \d\d:\d\d$/);
    assert.deepEqual(voiceProblems(`${rec?.title}. ${rec?.rationale}`), []);

    // Once per nudge.
    await assert.rejects(actOnNudge(nudge.id, "dnd"), /Already done/);

    // Undo ends it: the Mac's next look finds nothing and switches it off.
    const undone = await undoRecommendation(on?.id as string);
    assert.equal(undone.status, "undone");
    assert.equal(await activeDnd(), null);
  }));

test("no Mac to do it: nothing is switched on, the answer opens the page that hands over", () =>
  asNewUser(async () => {
    resetDnd();
    const { nudge, end } = await phoneNudge();
    assert.equal(macState(), "away");
    const res = await actOnNudge(nudge.id, "dnd");
    assert.equal(res.text, dndTapLine(end));
    assert.match(res.text, /^Tap to switch on Do Not Disturb until \d\d:\d\d\.$/);
    assert.deepEqual(voiceProblems(res.text), []);
    assert.equal(res.undo_until, null);
    assert.equal(res.url, `/dnd?nudge=${nudge.id}`);
    assert.equal(await activeDnd(), null);
    assert.equal((await dndCards()).length, 0);
    // The button may be tapped again: nothing happened yet.
    assert.equal((await actOnNudge(nudge.id, "dnd")).url, `/dnd?nudge=${nudge.id}`);

    // A Mac that looks in without the shortcut is the same, and the page will offer the install.
    noteMac(false);
    assert.equal(macState(), "no_shortcut");
    assert.equal((await actOnNudge(nudge.id, "dnd")).undo_until, null);
    // A Mac that stopped looking two minutes ago is away.
    noteMac(true, Date.now() - 3 * MIN);
    assert.equal(macState(), "away");
  }));

test("the page: the offer before the tap, the tap, and the one that is on", () =>
  asNewUser(async () => {
    resetDnd();
    const { nudge, end } = await phoneNudge();
    const before = DndOffer.parse(await dndOffer(nudge.id));
    assert.equal(before.active, null);
    assert.equal(before.mac, "away");
    assert.equal(before.offer?.until, end);
    assert.equal(before.offer?.text, nudge.text);
    assert.equal(before.offer?.shortcut_input, focusShortcutInput(end));
    assert.match(before.offer?.shortcut_input ?? "", /^\d{4}-\d\d-\d\d \d\d:\d\d$/);

    const on = Dnd.parse(await startDnd({ until: end, requested_by: "the app" }));
    assert.equal(on.mac, false);
    assert.equal(on.until, end);
    assert.equal(on.text, dndOnLine(end));
    const after = DndOffer.parse(await dndOffer(nudge.id));
    assert.equal(after.active?.id, on.id);

    // A newer one replaces it; undoing the older one changes nothing.
    const longer = iso(Date.now() + 90 * MIN);
    const second = await startDnd({ until: longer, requested_by: "the app" });
    await undoRecommendation(on.id);
    assert.equal((await activeDnd())?.id, second.id);

    // Not for the past, not for more than 12 hours; nothing is left behind.
    await assert.rejects(
      startDnd({ until: iso(Date.now() - MIN), requested_by: "the app" }),
      /already passed/,
    );
    await assert.rejects(
      startDnd({ until: iso(Date.now() + 13 * 60 * MIN), requested_by: "the app" }),
      /12 hours/,
    );
    assert.equal((await dndCards()).filter((r) => r.status === "proposed").length, 0);
    // An unknown nudge offers nothing.
    assert.equal((await dndOffer(randomUUID())).offer, null);
  }));

test("after a restart the one that is on is read back from the log", () =>
  asNewUser(async () => {
    resetDnd();
    const end = iso(Date.now() + 30 * MIN);
    const on = await startDnd({ until: end, requested_by: "the app" });
    resetDnd();
    assert.deepEqual(await activeDnd(), { id: on.id, until: end });
    // Past its time it is simply gone.
    assert.equal(await activeDnd(Date.parse(end) + 1000), null);
  }));

test("the demo week: a button on its nudge is refused with the standard line", async () => {
  resetDnd();
  await runAsUser(env.DEMO_USER_ID, async () => {
    const { nudge } = await phoneNudge();
    noteMac(true);
    await assert.rejects(actOnNudge(nudge.id, "dnd"), (err: Error) => err.message === DEMO_VISITOR_MESSAGE);
    assert.equal(await activeDnd(), null);
    // Refused, so the button is not used up.
    await assert.rejects(actOnNudge(nudge.id, "dnd"), (err: Error) => err.message === DEMO_VISITOR_MESSAGE);
  });
  // A visitor of the web app is refused by the route itself.
  const res = await app.request("/v1/dnd", {
    method: "POST",
    headers: {
      Authorization: "Bearer dev-key",
      "x-michael-demo-visitor": randomUUID(),
      "content-type": "application/json",
    },
    body: JSON.stringify({ until: iso(Date.now() + 30 * MIN) }),
  });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: { message: string } }).error.message, DEMO_VISITOR_MESSAGE);
});

test("the demo week: only the presenter may say yes, a visitor and a nudge's button may not", async () => {
  resetDnd();
  // The route decides for a web visitor: refused, except with the presenter key.
  assert.equal(demoVisitorMay("POST", "/v1/dnd"), false);
  assert.equal(demoVisitorMay("POST", "/v1/dnd", true), true);
  const until = iso(Date.now() + 30 * MIN);
  // Past the route (so: the presenter), the tap switches it on for the stage account.
  const on = await runAsUser(
    env.DEMO_USER_ID,
    () => startDnd({ until, requested_by: "a nudge" }),
    "demo_visitor",
    undefined,
    randomUUID(),
  );
  assert.equal(on.until, until);
  await runAsUser(env.DEMO_USER_ID, async () => {
    assert.deepEqual(await activeDnd(), { id: on.id, until });
    // A signed button on the same account still may not.
    await assert.rejects(
      startDnd({ until, requested_by: "a nudge" }),
      (err: Error) => err.message === DEMO_VISITOR_MESSAGE,
    );
    await undoRecommendation(on.id);
    assert.equal(await activeDnd(), null);
  });
  resetDnd();
});

test("over HTTP: the Mac's look reports the shortcut and reads what to switch on; the page reads and taps", async () => {
  resetDnd();
  const headers = { Authorization: "Bearer dev-key", "content-type": "application/json" };
  const look = async (query = "") =>
    FocusGuardsResponse.parse(
      await (await app.request(`/v1/focus-guards/active${query}`, { headers })).json(),
    );
  assert.equal((await look()).dnd, null);

  const offer = DndOffer.parse(await (await app.request("/v1/dnd", { headers })).json());
  assert.equal(offer.mac, "away");
  assert.equal((await look("?dnd=missing")).dnd, null);
  assert.equal(DndOffer.parse(await (await app.request("/v1/dnd", { headers })).json()).mac, "no_shortcut");
  await look("?dnd=ready");

  const until = iso(Date.now() + 25 * MIN);
  const res = await app.request("/v1/dnd", { method: "POST", headers, body: JSON.stringify({ until }) });
  assert.equal(res.status, 201);
  const on = Dnd.parse(await res.json());
  assert.equal(on.mac, true);
  assert.deepEqual((await look("?dnd=ready")).dnd, { id: on.id, until });

  // Ending it is the recommendation's own undo.
  const undo = await app.request(`/v1/recommendations/${on.id}/undo`, { method: "POST", headers });
  assert.equal(undo.status, 200);
  assert.equal((await look("?dnd=ready")).dnd, null);

  // nudge_id and until together, or neither, is a bad request.
  const bad = await app.request("/v1/dnd", { method: "POST", headers, body: JSON.stringify({}) });
  assert.equal(bad.status, 400);
  resetDnd();
});

test("telegram: with no Mac to do it the tap answers with the page that hands over, and the button stays", async () => {
  resetDnd();
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: String(input).split("/").pop() ?? "",
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return Response.json({ ok: true, result: true });
  }) as typeof globalThis.fetch;
  configureTelegram({ config: { token: "123:abc", username: "michael_coach_bot", secret: "s" }, fetch });
  const web = env.WEB_URL;
  env.WEB_URL = "https://michael.example";
  try {
    const { nudge, userId } = await asNewUser(async (userId) => {
      await store.bindTelegramChat({ chat_id: "4470", username: "manolis" }, `link-${randomUUID()}`);
      return { ...(await phoneNudge()), userId };
    });
    const tap = () =>
      handleTelegramCallback({
        id: "cb1",
        data: callbackData(nudge.id, "dnd"),
        message: { message_id: 9, chat: { id: 4470, type: "private" } },
      });
    assert.match(await tap(), /^Tap to switch on Do Not Disturb until \d\d:\d\d\.$/);
    // Nothing was switched on, so the buttons stay; the line comes with the link to the page.
    assert.deepEqual(
      calls.map((c) => c.method),
      ["sendMessage"],
    );
    assert.deepEqual(calls[0]?.body.reply_markup, {
      inline_keyboard: [[{ text: "Switch it on", url: `https://michael.example/dnd?nudge=${nudge.id}` }]],
    });

    // With a Mac that has the shortcut the same tap does it, and the buttons go.
    calls.length = 0;
    await runAsUser(userId, async () => noteMac(true));
    assert.match(await tap(), /^Do Not Disturb is on until \d\d:\d\d\. Tap to end it\.$/);
    assert.deepEqual(
      calls.map((c) => c.method),
      ["editMessageReplyMarkup", "sendMessage"],
    );
    assert.equal(calls[1]?.body.reply_markup, undefined);
  } finally {
    env.WEB_URL = web;
    configureTelegram({ config: null });
    resetDnd();
  }
});
