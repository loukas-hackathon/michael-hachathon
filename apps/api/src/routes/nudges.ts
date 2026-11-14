import {
  countsTowardsCap,
  type NudgeCheckResult,
  NudgesQuery,
  type NudgesResponse,
  type NudgeTestResult,
} from "@michael/shared";
import { Hono } from "hono";
import { HttpError, parse } from "../http";
import { momentNudge } from "../moments/nudge";
import { nudgePayload, primaryChannel } from "../nudges/channels";
import {
  candidates,
  DEFAULT_QUIET,
  decide,
  type EngineInput,
  engineWindow,
  momentDue,
  type QuietHours,
} from "../nudges/engine";
import { pushToCurrentUser } from "../nudges/push";
import { store } from "../store";
import { momentCoreFor } from "./moments";
import { readProfile } from "./profile";

const minutesOf = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** The night's quiet hours come from the user's profile; dinner and deep work keep their defaults. */
export function quietFrom(profile: { quiet_hours: { start: string; end: string } }): QuietHours {
  return {
    ...DEFAULT_QUIET,
    nightStart: minutesOf(profile.quiet_hours.start),
    nightEnd: minutesOf(profile.quiet_hours.end),
  };
}

/**
 * Runs the engine once for the current user: reads the week so far, decides, stores the nudge
 * (or the suppressed one) and hands it to the delivery channel. The engine itself stays pure.
 */
export async function checkNudges(): Promise<NudgeCheckResult> {
  const now = new Date().toISOString();
  const win = engineWindow(now);
  const [events, goals, today, privacy, profile] = await Promise.all([
    store.listEvents({ from: win.from, to: win.dayEnd }),
    store.listGoals(),
    store.listNudges({ from: win.dayStart, to: win.dayEnd }),
    store.privacyRules(),
    readProfile(),
  ]);
  const input: EngineInput = {
    now,
    goals,
    events,
    today,
    offTheRecord: privacy.offTheRecord,
    quiet: quietFrom(profile),
  };
  // A Morning or Evening moment that is due and not yet out today: its line joins the candidates.
  const due = privacy.offTheRecord ? null : momentDue(input);
  if (due && !today.some((n) => n.key === due)) {
    input.moment = { kind: due, ...momentNudge(await momentCoreFor(due, now)) };
  }
  const decision = decide(input);
  const counted = today.filter((n) => countsTowardsCap(n.status)).length;
  if (decision.action === "skip") {
    return { checked_at: now, nudge: null, skipped: decision.skipped, sent_today: counted };
  }

  const channel = primaryChannel();
  const { candidate } = decision;
  const created = await store.createNudge({
    recommendation_id: null,
    goal_id: candidate.goal_id,
    kind: candidate.kind,
    key: candidate.key,
    day: win.day,
    channel: channel.name,
    text: candidate.text,
    reason: candidate.reason,
    status: decision.action === "suppress" ? "suppressed" : "queued",
  });
  // Another check stored the same key a moment ago: nothing new to say.
  if (!created) return { checked_at: now, nudge: null, skipped: "nothing_to_say", sent_today: counted };
  if (decision.action === "suppress") {
    return { checked_at: now, nudge: created, skipped: decision.skipped, sent_today: counted };
  }

  let status: Awaited<ReturnType<typeof channel.deliver>>;
  try {
    status = await channel.deliver(created);
  } catch (err) {
    console.error("[nudge] delivery failed", err);
    status = "failed";
  }
  const nudge =
    status === created.status ? created : ((await store.updateNudgeStatus(created.id, status)) ?? created);
  return { checked_at: now, nudge, skipped: null, sent_today: counted + 1 };
}

// Said when the engine has nothing real to say right now. Under 15 words, no dashes.
export const SAMPLE_NUDGE = {
  kind: "goal_behind" as const,
  text: "Nudges are on. At most five a day, only when it matters.",
  reason: "A test nudge: nothing on your day needs a nudge right now.",
};

/**
 * The stage moment: push one nudge to the caller's devices now. Uses the engine's best current
 * candidate (real maths) when there is one, otherwise the sample. Ignores the cap, quiet hours
 * and dedupe. Stored with status `test` so GET /v1/nudges (the stage screen) shows the same line
 * at the same moment; `test` never counts towards the 5 a day or blocks a real nudge.
 */
export async function testNudge(): Promise<NudgeTestResult> {
  const now = new Date().toISOString();
  const win = engineWindow(now);
  const [events, goals] = await Promise.all([
    store.listEvents({ from: win.weekStart, to: win.dayEnd }),
    store.listGoals(),
  ]);
  const pick = candidates({ now, goals, events, today: [] })[0] ?? SAMPLE_NUDGE;
  // Stored first, so the screen can show it as the watch buzzes. A unique key per press keeps
  // the daily dedupe out of the way.
  const nudge = await store.createNudge({
    recommendation_id: null,
    goal_id: "goal_id" in pick ? pick.goal_id : null,
    kind: pick.kind,
    key: `test:${pick.kind}:${now}:${crypto.randomUUID().slice(0, 8)}`,
    day: win.day,
    channel: primaryChannel().name,
    text: pick.text,
    reason: pick.reason,
    status: "test",
  });
  if (!nudge) throw new HttpError("internal", "Could not store the test nudge");
  const { devices, delivered } = await pushToCurrentUser(nudgePayload(pick));
  console.log(`[nudge] test "${pick.text}" pushed to ${delivered} of ${devices} devices`);
  return { text: pick.text, reason: pick.reason, delivered, devices, nudge };
}

export const nudges = new Hono()
  // GET /v1/nudges?from=&to=  (default: today, local time)
  .get("/nudges", async (c) => {
    const q = parse(NudgesQuery, { from: c.req.query("from"), to: c.req.query("to") });
    const win = engineWindow(new Date().toISOString());
    const from = q.from ?? win.dayStart;
    const to = q.to ?? win.dayEnd;
    if (!(Date.parse(to) > Date.parse(from))) throw new HttpError("bad_request", "`to` must be after `from`");
    const body: NudgesResponse = { nudges: await store.listNudges({ from, to }) };
    return c.json(body);
  })
  // POST /v1/nudges/check: decide now, store and deliver at most one nudge.
  .post("/nudges/check", async (c) => c.json(await checkNudges()))
  // POST /v1/nudges/test: push one nudge to the caller's own devices now (stage demo).
  .post("/nudges/test", async (c) => c.json(await testNudge()));
