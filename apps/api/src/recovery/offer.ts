import type { Event, Goal, Nudge, Recommendation } from "@michael/shared";
import type { EngineInput } from "../nudges/engine";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { DAY, Zone } from "../patterns/time";
import { store } from "../store";
import { offerDay, planRecovery, recoveryFor } from "./plan";

// Where the recovery rule runs: inside the nudge check (routes/nudges.ts), which the scheduler runs
// every few minutes for every active user, so a block is looked at minutes after it ends. It
// creates the offer through the store's createRecommendation (the guard applies), then hands the
// newest offer that has not been nudged yet to the nudge engine, which decides whether it goes
// out now: it counts towards the 5 a day like any other nudge.

export interface RecoveryCheck {
  now: string;
  timezone?: string;
  /** The events the nudge check already read (they reach back past last night). */
  events: Event[];
  goals: Goal[];
  /** Today's nudges, for the ones already sent. */
  today: Pick<Nudge, "key">[];
  quiet: { start: string; end: string } | null;
  offTheRecord?: boolean;
}

/** The nudge key of a recovery offer: one nudge per offer. */
export const recoveryKey = (recommendationId: string) => `recovery_block:${recommendationId}`;

/** Creates a recovery offer when a block just slipped, and returns the offer to nudge about, if any. */
export async function recoveryOffer(check: RecoveryCheck): Promise<EngineInput["recovery"]> {
  if (check.offTheRecord) return undefined;
  const zone = new Zone(check.timezone ?? DEFAULT_TIMEZONE);
  const now = Date.parse(check.now);
  const day = zone.dayOf(now);
  // Today and the night before are all the rule reads.
  const from = zone.startOfDay(day) - DAY;
  const events = check.events.filter((e) => Date.parse(e.end_at ?? e.start_at) >= from);
  const [instructions, recommendations] = await Promise.all([
    store.listInstructions(),
    store.listRecommendations(),
  ]);

  const plan = planRecovery({
    now: check.now,
    timezone: zone.name,
    events,
    goals: check.goals,
    instructions,
    quiet: check.quiet,
    recommendations,
  });
  const all: Recommendation[] = [...recommendations];
  if (plan) {
    const created = await store.createRecommendation(plan.recommendation);
    console.log(
      `[recovery] ${plan.cause} on ${plan.block.event_id}: offered ${zone.clock(plan.slot.start)}${created.action ? "" : " (refused by the guard)"}`,
    );
    all.push(created);
  }

  // The newest offer for today, still open and still ahead, that has not been nudged yet.
  const sent = new Set(check.today.map((n) => n.key));
  const open = all
    .filter((r) => {
      if (!recoveryFor(r) || r.status !== "proposed" || sent.has(recoveryKey(r.id))) return false;
      const start = r.action?.payload.start_at;
      return typeof start === "string" && Date.parse(start) > now && offerDay(r, zone) === day;
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!open?.action) return undefined;
  return {
    recommendation_id: open.id,
    goal_id: open.goal_id,
    text: open.title,
    reason: open.rationale,
    start_at: String(open.action.payload.start_at),
  };
}
