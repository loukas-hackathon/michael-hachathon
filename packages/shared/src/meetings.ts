import { z } from "zod";
import { IsoDateTime } from "./schemas";

// Meetings mode (#400): conversations are kept only while the user has started it. Only the user
// starts it, after a one time consent notice; it ends when they say so, after 2 hours, at the end
// of the calendar block it started in, or when they go off the record. Contract: docs/api.md.

/** The longest a meeting session runs before it ends by itself. */
export const MEETING_MAX_MINUTES = 120;

/** How long after it ends a meeting's recap (its commitments) stays on Today. */
export const MEETING_RECAP_HOURS = 12;

export const MeetingSession = z.object({
  id: z.uuid(),
  started_at: IsoDateTime,
  // When it ends by itself: 2 hours after the start, or the end of the calendar block it began in.
  ends_at: IsoDateTime,
  // When the user ended it (or off the record did); null while it runs or once it ran out.
  ended_at: IsoDateTime.nullable(),
});
export type MeetingSession = z.infer<typeof MeetingSession>;

export const MeetingStart = z.object({
  // Required (true) the first time: the user has read the consent notice and starts it themself.
  consent: z.boolean().optional(),
});
export type MeetingStart = z.infer<typeof MeetingStart>;

export const MeetingCommitment = z.object({
  text: z.string().min(1).max(200),
  // The conversation it came from (a timeline event id).
  event_id: z.uuid(),
});
export type MeetingCommitment = z.infer<typeof MeetingCommitment>;

export const MeetingRecap = z.object({
  session_id: z.uuid(),
  started_at: IsoDateTime,
  ended_at: IsoDateTime,
  // Conversations kept from it (each is a timeline event).
  conversation_ids: z.array(z.uuid()),
  // The user's own commitments, as the conversation source extracted them. Never other speakers.
  commitments: z.array(MeetingCommitment),
  // One coaching lesson, when the conversation carried one; else null.
  lesson: z.string().nullable(),
});
export type MeetingRecap = z.infer<typeof MeetingRecap>;

export const MeetingsState = z.object({
  // The user has read the consent notice (started a meeting before).
  consented: z.boolean(),
  active: MeetingSession.nullable(),
  // The latest meeting that ended in the last 12 hours, or null.
  last: MeetingRecap.nullable(),
});
export type MeetingsState = z.infer<typeof MeetingsState>;

export const MeetingCommitmentAdd = z.object({ text: z.string().trim().min(1).max(200) });
export type MeetingCommitmentAdd = z.infer<typeof MeetingCommitmentAdd>;
