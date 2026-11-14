import {
  type NudgeCheckResult,
  NudgesQuery,
  type NudgesResponse,
  type NudgeTestResult,
} from "@michael/shared";
import { Hono } from "hono";
import { HttpError, parse } from "../http";
import { nudgePayload, primaryChannel } from "../nudges/channels";
import { candidates, decide, engineWindow, quietFromProfile } from "../nudges/engine";
import { pushToCurrentUser } from "../nudges/push";
import { store } from "../store";
import { readProfile } from "./profile";

/**
 * Runs the engine once for the current user: reads the week so far, decides, stores the nudge
 * (or the suppressed one) and hands it to the delivery channel. The engine itself stays pure.
 */
export async function checkNudges(): Promise<NudgeCheckResult> {
  const now = new Date().toISOString();
  const win = engineWindow(now);
  const [events, goals, today, privacy, profile] = await Promise.all([
    store.listEvents({ from: win.weekStart, to: win.dayEnd }),
    store.listGoals(),
    store.listNudges({ from: win.dayStart, to: win.dayEnd }),
    store.privacyRules(),
    // The user's own quiet hours (onboarding); 22:00 to 07:00 if unset or unreadable.
    readProfile().catch(() => null),
  ]);
  const decision = decide({
    now,
    goals,
    events,
    today,
    offTheRecord: privacy.offTheRecord,
    quiet: quietFromProfile(profile?.quiet_hours),
  });
  const counted = today.filter((n) => n.status !== "suppressed").length;
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
 * and dedupe, and stores nothing, so it never eats into the 5 a day.
 */
export async function testNudge(): Promise<NudgeTestResult> {
  const now = new Date().toISOString();
  const win = engineWindow(now);
  const [events, goals, profile] = await Promise.all([
    store.listEvents({ from: win.weekStart, to: win.dayEnd }),
    store.listGoals(),
    readProfile().catch(() => null),
  ]);
  const quiet = quietFromProfile(profile?.quiet_hours);
  const pick = candidates({ now, goals, events, today: [], quiet })[0] ?? SAMPLE_NUDGE;
  const { devices, delivered } = await pushToCurrentUser(nudgePayload(pick));
  console.log(`[nudge] test "${pick.text}" pushed to ${delivered} of ${devices} devices`);
  return { text: pick.text, reason: pick.reason, delivered, devices };
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
