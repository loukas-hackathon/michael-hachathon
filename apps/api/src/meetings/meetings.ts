import {
  type ChecklistItem,
  type Event,
  MEETING_MAX_MINUTES,
  MEETING_RECAP_HOURS,
  type MeetingRecap,
  type MeetingSession,
  type MeetingsState,
} from "@michael/shared";
import { addItem } from "../checklist/items";
import { HttpError } from "../http";
import { MEETING_GRACE_MS } from "../privacy";
import { outcomesGoal } from "../ritual/ritual";
import { isRunning, meetingWindows, store } from "../store";

// Meetings mode (#400). Conversations are kept only while the user has started it (the gate is
// privacy.ts decideEvent, applied by Store.insertEvents on every ingest path). Only the user
// starts it, after a one time consent notice; it ends when they say so, after 2 hours, at the end
// of the calendar block it began in, or when they go off the record (store.setOffTheRecord).
// After it, Today shows one recap: the user's own commitments and a lesson line, never anyone
// else's words (Omi's mapper keeps only the summary and the user's action items).

const MIN = 60_000;
// A block that ends sooner than this is not the meeting: it is the tail of whatever came before.
const BLOCK_TAIL_MS = 10 * MIN;
// A block starting this soon is the meeting the user is about to walk into.
const BLOCK_SOON_MS = 15 * MIN;

export const CONSENT_NEEDED = "Read the notice first: only you start this, and the room should know.";
export const OFF_THE_RECORD = "You are off the record. Turn it off first to start a meeting.";

/**
 * When a session started at `now` ends by itself: the end of the calendar block it began in (or
 * one starting within 15 minutes), never later than 2 hours. All day events do not count.
 */
export function plannedEnd(now: number, calendar: Pick<Event, "start_at" | "end_at" | "data">[]): string {
  const cap = now + MEETING_MAX_MINUTES * MIN;
  let end = cap;
  for (const e of calendar) {
    if (!e.end_at || (e.data as { all_day?: unknown } | null)?.all_day === true) continue;
    const s = Date.parse(e.start_at);
    const t = Date.parse(e.end_at);
    const current = s <= now && t - now >= BLOCK_TAIL_MS;
    const soon = s > now && s - now <= BLOCK_SOON_MS;
    if ((current || soon) && t < end) end = t;
  }
  return new Date(end).toISOString();
}

/** The recap of one ended session from the conversations kept inside it. */
export function recapOf(
  session: MeetingSession,
  conversations: Pick<Event, "id" | "start_at" | "data">[],
): MeetingRecap {
  const [w] = meetingWindows([session]);
  const from = Date.parse(session.started_at) - MEETING_GRACE_MS;
  const to = Date.parse(w?.end ?? session.ends_at);
  const inside = conversations
    .filter((e) => {
      const t = Date.parse(e.start_at);
      return t >= from && t <= to;
    })
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const commitments: MeetingRecap["commitments"] = [];
  let lesson: string | null = null;
  for (const e of inside) {
    const d = (e.data ?? {}) as { action_items?: unknown; lesson?: unknown };
    for (const a of Array.isArray(d.action_items) ? d.action_items : []) {
      const text = typeof a === "string" ? a.trim().slice(0, 200) : "";
      if (text && !commitments.some((c) => c.text === text)) commitments.push({ text, event_id: e.id });
    }
    if (!lesson && typeof d.lesson === "string" && d.lesson.trim()) lesson = d.lesson.trim().slice(0, 200);
  }
  return {
    session_id: session.id,
    started_at: session.started_at,
    ended_at: w?.end ?? session.ends_at,
    conversation_ids: inside.map((e) => e.id),
    commitments,
    lesson,
  };
}

/** GET /v1/meetings/active: consent given, the running session, and the last one's recap. */
export async function meetingsState(now = Date.now()): Promise<MeetingsState> {
  const sessions = await store.listMeetingSessions({ limit: 5 });
  const active = sessions.find((m) => isRunning(m, now)) ?? null;
  const since = now - MEETING_RECAP_HOURS * 3600_000;
  const ended = sessions.find((m) => {
    if (isRunning(m, now)) return false;
    const [w] = meetingWindows([m]);
    return Boolean(w) && Date.parse(w?.end as string) >= since;
  });
  let last: MeetingRecap | null = null;
  if (ended) {
    const [w] = meetingWindows([ended]);
    const conversations = await store.listEvents({
      from: new Date(Date.parse(ended.started_at) - MEETING_GRACE_MS).toISOString(),
      to: w?.end ?? ended.ends_at,
      type: ["conversation"],
    });
    last = recapOf(ended, conversations);
  }
  return { consented: sessions.length > 0, active, last };
}

/**
 * POST /v1/meetings/start. Idempotent while one runs. The first time needs `consent: true` (the
 * user read the notice); off the record refuses, since nothing would be kept anyway.
 */
export async function startMeeting(consent: boolean | undefined, now = Date.now()): Promise<MeetingsState> {
  const rules = await store.privacyRules();
  if (rules.offTheRecord) throw new HttpError("conflict", OFF_THE_RECORD);
  const sessions = await store.listMeetingSessions({ limit: 5 });
  if (sessions.some((m) => isRunning(m, now))) return meetingsState(now);
  if (!sessions.length && consent !== true) throw new HttpError("conflict", CONSENT_NEEDED);
  const calendar = await store.listEvents({
    from: new Date(now - 12 * 3600_000).toISOString(),
    to: new Date(now + MEETING_MAX_MINUTES * MIN).toISOString(),
    type: ["calendar_event"],
  });
  await store.createMeetingSession({
    started_at: new Date(now).toISOString(),
    ends_at: plannedEnd(now, calendar),
  });
  return meetingsState(now);
}

/** POST /v1/meetings/end. Ends the running session now; with none running, nothing changes. */
export async function endMeeting(now = Date.now()): Promise<MeetingsState> {
  const sessions = await store.listMeetingSessions({ limit: 5 });
  for (const m of sessions.filter((x) => isRunning(x, now))) {
    await store.updateMeetingSession(m.id, { ended_at: new Date(now).toISOString() });
  }
  return meetingsState(now);
}

/** POST /v1/meetings/commitments: one of the user's commitments onto today's outcomes. */
export async function addCommitment(text: string, now = Date.now()): Promise<ChecklistItem> {
  const goal = await outcomesGoal(true);
  if (!goal) throw new HttpError("internal", "No checklist for today's outcomes");
  return addItem({ goal_id: goal.id, text }, now);
}
