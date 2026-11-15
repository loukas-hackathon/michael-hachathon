import {
  type Dnd,
  type DndOffer,
  focusShortcutInput,
  type Nudge,
  nudgeBlockId,
  nudgeOffersDnd,
  nudgeTrigger,
} from "@michael/shared";
import { currentAuthMethod, currentDemoVisitor, currentUserId } from "../context";
import { DEMO_VISITOR_MESSAGE } from "../demo/visitor";
import { env } from "../env";
import { HttpError } from "../http";
import { quietFromProfile } from "../nudges/engine";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { Zone } from "../patterns/time";
import { readProfile } from "../routes/profile";
import { store } from "../store";
import { executeRecommendation } from "./calendar";
import { activeDnd, MIN_DND_MS, macState } from "./dnd";

// The asking side of Do Not Disturb (#447): until when a nudge's offer runs, the tap that switches
// it on, and what the hand over page shows. The doing side is actions/dnd.ts.

const zone = () => new Zone(DEFAULT_TIMEZONE);
const clock = (iso: string) => zone().clock(Date.parse(iso));

/** Michael's line once it is on. */
export const dndOnLine = (until: string) => `Do Not Disturb is on until ${clock(until)}. Tap to end it.`;
/** His line when one more tap is needed (no Mac with the shortcut: the iPhone does it). */
export const dndTapLine = (until: string) => `Tap to switch on Do Not Disturb until ${clock(until)}.`;

/**
 * The demo week belongs to everyone who looks at it: a visitor, or a button on a nudge of the demo
 * account, never switches anything on. The API key itself (our own tools, a local run) still may.
 */
const isDemo = () =>
  currentDemoVisitor() !== null ||
  (currentUserId() === env.DEMO_USER_ID && currentAuthMethod() !== "api_key");

/** The standard line of the demo week, as a refusal (403). */
export function refuseDemoDnd(): void {
  if (isDemo()) throw new HttpError("forbidden", DEMO_VISITOR_MESSAGE);
}

const asDnd = (id: string, until: string, mac: boolean): Dnd => ({
  id,
  until,
  until_label: clock(until),
  shortcut_input: focusShortcutInput(until, DEFAULT_TIMEZONE),
  mac,
  text: dndOnLine(until),
});

/**
 * Until when a nudge's Do Not Disturb runs: the end of its block (a drift), or the end of the
 * night's quiet hours, the user's wake time (the phone before sleep). Null when the nudge offers
 * none or the block is over.
 */
export async function untilForNudge(
  nudge: Pick<Nudge, "kind" | "key">,
  now = Date.now(),
): Promise<string | null> {
  if (!nudgeOffersDnd(nudge)) return null;
  if (nudgeTrigger(nudge) === "late_phone") {
    const z = zone();
    const profile = await readProfile().catch(() => null);
    const wake = quietFromProfile(profile?.quiet_hours).nightEnd;
    const today = z.dayOf(now);
    const at = [today, z.nextDay(today)].map((day) => z.at(day, wake)).find((t) => t - now >= MIN_DND_MS);
    return at ? new Date(at).toISOString() : null;
  }
  const eventId = nudgeBlockId(nudge);
  const block = eventId ? await store.getEvent(eventId).catch(() => null) : null;
  if (!block?.end_at || Date.parse(block.end_at) - now < MIN_DND_MS) return null;
  return block.end_at;
}

export interface DndRequest {
  until: string;
  goal_id?: string | null;
  /** Where the tap came from, for the line the user reads on Today ("a nudge", "the app"). */
  requested_by: string;
}

/**
 * The tap: Do Not Disturb until `until`, as a do_not_disturb recommendation carried out at once.
 * A Mac with the shortcut switches it on within seconds; `mac` says whether one is there.
 */
export async function startDnd(req: DndRequest): Promise<Dnd> {
  refuseDemoDnd();
  const goal = req.goal_id ? await store.getGoal(req.goal_id).catch(() => null) : null;
  const at = clock(req.until);
  const rec = await store.createRecommendation({
    goal_id: goal?.id ?? null,
    title: `Do Not Disturb until ${at}`,
    rationale: `You asked for it from ${req.requested_by}. It ends by itself at ${at}. Undo ends it now.`,
    action: {
      kind: "do_not_disturb",
      // No start: it is on from the tap. `end_at` is where the app reads until when it can be undone.
      payload: { end_at: req.until },
      involves_others: false,
      undo_until: req.until,
    },
    source: "chat",
  });
  try {
    await executeRecommendation(rec.id);
  } catch (err) {
    // Nothing was switched on: do not leave a half made card behind.
    await store.updateRecommendationStatus(rec.id, "dismissed").catch(() => null);
    throw err;
  }
  const on = await activeDnd();
  return asDnd(rec.id, on?.until ?? req.until, macState() === "ready");
}

/** Do Not Disturb for a nudge the current user was sent. 404 unknown nudge, 409 when it offers none. */
export async function startDndForNudge(nudgeId: string, now = Date.now()): Promise<Dnd> {
  const nudge = await store.getNudge(nudgeId);
  if (!nudge) throw new HttpError("not_found", "Nudge not found");
  const until = await untilForNudge(nudge, now);
  if (!until) throw new HttpError("conflict", "That block is over. Nothing to protect now.");
  return startDnd({ until, goal_id: nudge.goal_id, requested_by: "a nudge" });
}

/** GET /v1/dnd: what the hand over page shows before the tap. */
export async function dndOffer(nudgeId?: string, now = Date.now()): Promise<DndOffer> {
  const [on, nudge] = await Promise.all([activeDnd(now), nudgeId ? store.getNudge(nudgeId) : null]);
  const until = nudge ? await untilForNudge(nudge, now) : null;
  return {
    active: on ? asDnd(on.id, on.until, macState(now) === "ready") : null,
    offer:
      nudge && until
        ? {
            nudge_id: nudge.id,
            until,
            until_label: clock(until),
            shortcut_input: focusShortcutInput(until, DEFAULT_TIMEZONE),
            text: nudge.text,
          }
        : null,
    mac: macState(now),
  };
}

/** The page a nudge's tap opens when the iPhone has to do it: it hands over to the shortcut. */
export const dndUrl = (nudgeId: string) => `/dnd?nudge=${nudgeId}`;
