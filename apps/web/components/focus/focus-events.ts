import type { FocusSession } from "@michael/shared";

// Focus now (#397): how a screen that starts a session tells the one session screen (FocusHost,
// mounted once in the layout) to show it. With a session it opens at once; without, the host
// reads the server again (a session started in chat or by Claude).

export const FOCUS_EVENT = "michael:focus";

/** FOCUS_LENGTHS in @michael/shared (repeated: client code takes only types from the index). */
export const LENGTHS = [25, 45, 60, 90];

export function announceFocus(session?: FocusSession): void {
  window.dispatchEvent(new CustomEvent<FocusSession | undefined>(FOCUS_EVENT, { detail: session }));
}

/** "32 min" left, rounded up, so the screen never says 0 while time is left. */
export const minutesLeft = (endAt: string, now: number) =>
  Math.max(0, Math.ceil((Date.parse(endAt) - now) / 60_000));

/** Whole minutes since the start, as End early counts them. */
export const minutesSoFar = (startAt: string, now: number) =>
  Math.max(0, Math.round((now - Date.parse(startAt)) / 60_000));

/** Share of the session still to run, 1 at the start and 0 at the end. */
export function shareLeft(s: Pick<FocusSession, "start_at" | "end_at">, now: number): number {
  const total = Date.parse(s.end_at) - Date.parse(s.start_at);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (Date.parse(s.end_at) - now) / total));
}

/** The promise's value, or null once `ms` have passed without one (a late answer is dropped). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const id = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}
