import {
  type BlockableMacApp,
  BlockMacAppPayload,
  type FocusGuard,
  findBlockableMacApp,
  type Recommendation,
  type RecommendationAction,
} from "@michael/shared";
import { HttpError, parse } from "../http";
import { store } from "../store";

// block_mac_app (#41): a focus guard on the user's own Mac. Executing creates the guard; the Mac
// collector reads it (GET /v1/focus-guards/active) and closes the named apps when they come to the
// front, with a notification. Undo deletes the guard at once. Only allowlisted apps (mac-apps.ts in
// @michael/shared) can be named, so a guard can never close the system, a terminal or Michael.

/** At most this long: a guard is for a block of focus, not for the week. */
export const MAX_GUARD_MS = 12 * 3600_000;
export const MIN_GUARD_MS = 5 * 60_000;

/** The allowlisted apps a payload names, deduplicated. Refuses (409) any app not on the list. */
export function resolveApps(p: BlockMacAppPayload): BlockableMacApp[] {
  const asked = [p.app, ...(p.apps ?? []), ...(p.bundle_ids ?? [])].filter((x): x is string => Boolean(x));
  const out = new Map<string, BlockableMacApp>();
  for (const name of asked) {
    const app = findBlockableMacApp(name);
    if (!app) {
      throw new HttpError(
        "conflict",
        `I only close distracting apps such as WhatsApp, Slack or Spotify. ${name} is not on my list.`,
      );
    }
    out.set(app.name, app);
  }
  if (out.size === 0) throw new HttpError("bad_request", "Name at least one app");
  return [...out.values()];
}

/** What the notification sends the person back to: the given words, the goal or the block. */
async function backTo(p: BlockMacAppPayload, goalId: string | null): Promise<string | null> {
  if (p.back_to) return p.back_to;
  const goal = goalId ? await store.getGoal(goalId) : null;
  if (goal) return goal.title.length <= 40 ? goal.title : goal.title.slice(0, 40).trim();
  const block = p.block_event_id ? await store.getEvent(p.block_event_id) : null;
  return block?.title ?? null;
}

export interface GuardExecution {
  kind: "block_mac_app";
  focus_guard_id: string;
  undo_until: string;
}

/** Carries out a block_mac_app action: creates the focus guard. Undo is possible until it ends. */
export async function startFocusGuard(
  rec: Recommendation,
  action: RecommendationAction,
): Promise<{ execution: GuardExecution; guard: FocusGuard }> {
  const p = parse(BlockMacAppPayload, action.payload);
  const apps = resolveApps(p);
  const now = Date.now();
  const end = Date.parse(p.end_at);
  // A window that has begun starts now: the rest of it is still worth guarding.
  const start = Math.max(Date.parse(p.start_at), now);
  if (end <= now) throw new HttpError("conflict", "That window has already ended");
  if (end - start > MAX_GUARD_MS) throw new HttpError("bad_request", "A guard is at most 12 hours");
  const goalId = p.goal_id ?? rec.goal_id ?? null;
  const guard = await store.createFocusGuard({
    recommendation_id: rec.id,
    apps: apps.map((a) => a.name),
    bundle_ids: [...new Set(apps.flatMap((a) => a.bundle_ids))],
    start_at: new Date(start).toISOString(),
    end_at: new Date(end).toISOString(),
    goal_id: goalId && (await store.getGoal(goalId)) ? goalId : null,
    back_to: await backTo(p, goalId),
  });
  return {
    guard,
    execution: { kind: "block_mac_app", focus_guard_id: guard.id, undo_until: guard.end_at },
  };
}

/** Undo: the guard goes at once, so the apps open again. Already gone counts as undone. */
export async function stopFocusGuard(ex: GuardExecution): Promise<void> {
  await store.deleteFocusGuard(ex.focus_guard_id);
}

const LOOKAHEAD_MS = 10 * 60_000;

/** For GET /v1/focus-guards/active: guards running now or starting in the next 10 minutes. */
export async function activeFocusGuards(now = Date.now()) {
  const rules = await store.privacyRules();
  if (rules.offTheRecord) return { now: new Date(now).toISOString(), off_the_record: true, guards: [] };
  const guards = await store.listFocusGuards({
    endsAfter: new Date(now).toISOString(),
    startsBefore: new Date(now + LOOKAHEAD_MS).toISOString(),
  });
  return { now: new Date(now).toISOString(), off_the_record: false, guards };
}
