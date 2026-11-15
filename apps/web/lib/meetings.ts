"use client";

import type { MeetingsState } from "@michael/shared";
import { useSyncExternalStore } from "react";
import { endMeetingAction, readMeetings, startMeetingAction } from "./meetings-actions";

// Meetings mode (#400) in the browser: one copy of the state for every screen (the pill, the You
// row), read from the API once per page load and whenever the app comes back to the front.

const NONE: MeetingsState = { consented: false, active: null, last: null };
let state: MeetingsState | null = null;
let syncing = false;
const listeners = new Set<() => void>();

function set(next: MeetingsState) {
  state = next;
  for (const l of listeners) l();
}

/** Asks the API again (on mount, on return to the app, after off the record). */
export function syncMeetings() {
  if (syncing) return;
  syncing = true;
  readMeetings()
    .then((r) => {
      if (r.ok) set(r.state);
    })
    .catch(() => {})
    .finally(() => {
      syncing = false;
    });
}

/** Starts it. Resolves true, or Michael's line when it did not start. */
export async function startMeeting(consent: boolean): Promise<true | string> {
  const r = await startMeetingAction(consent).catch(() => null);
  if (!r) return "I could not reach the server. Nothing changed.";
  if (!r.ok) return r.message;
  set(r.state);
  return true;
}

/** Ends it now. Hides the pill at once and puts it back if the end did not reach the server. */
export async function endMeeting(): Promise<true | string> {
  const before = state ?? NONE;
  set({ ...before, active: null });
  const r = await endMeetingAction().catch(() => null);
  if (r?.ok) {
    set(r.state);
    return true;
  }
  set(before);
  return r && !r.ok ? r.message : "I could not reach the server. Nothing changed.";
}

/** Drops the running session locally (off the record ended it on the server). */
export function forgetActiveMeeting() {
  if (state?.active) set({ ...state, active: null });
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!state) syncMeetings();
  return () => listeners.delete(l);
}

/** The state, or null until the first read lands. */
export function useMeetings(): MeetingsState | null {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}

/** The session's end in ms: when the user ended it, or when it runs out by itself. */
export const meetingEndsAt = (m: { ends_at: string; ended_at: string | null }) =>
  Math.min(Date.parse(m.ends_at), m.ended_at ? Date.parse(m.ended_at) : Number.POSITIVE_INFINITY);
