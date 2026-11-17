import { type PhoneCadence, type Recommendation, voiceDuration } from "@michael/shared";
import { MINUTE, type Zone } from "../patterns/time";
import type { NewRecommendation } from "../store";

// Do Not Disturb for the hours the phone pulls hardest (#432). The phone cadence already counts,
// hour by hour over the last 7 days, how often an app was opened. This finds the two hours of the
// working day with the most opens and offers Do Not Disturb for them the next time they come
// round, as one recommendation: one tap switches it on for that window (actions/dnd.ts, run by the
// Michael Focus shortcut on the Mac or the iPhone), undo ends it. Pure: the clock and the cadence
// are passed in.

export const DND_WINDOW = {
  /** How long the window is, in hours. */
  hours: 2,
  /** Days of phone data before an hour can be called the busiest. */
  minDays: 3,
  /** Opens a day inside the window before it is worth a tap. */
  minOpensPerDay: 3,
  /** A window that ends sooner than this from now is offered for tomorrow instead. */
  minLeftMs: 20 * MINUTE,
} as const;

/** Marks the recommendation as this offer, so one is made per day and the web can name it. */
export const WINDOW_MARK = "busiest_hours";

export interface BusiestWindow {
  startHour: number;
  endHour: number;
  /** Opens a day inside the window, on average over the days with data. */
  opensPerDay: number;
}

/** The two hours of the working day with the most phone opens, or null when there is too little. */
export function busiestWindow(cadence: PhoneCadence | null | undefined): BusiestWindow | null {
  if (!cadence || cadence.days_with_data < DND_WINDOW.minDays) return null;
  const { start_hour: from, end_hour: to } = cadence.window;
  const perHour = new Map(cadence.by_hour.map((h) => [h.hour, h.sessions_per_day]));
  let best: BusiestWindow | null = null;
  for (let start = from; start + DND_WINDOW.hours <= to; start++) {
    let opens = 0;
    for (let h = start; h < start + DND_WINDOW.hours; h++) opens += perHour.get(h) ?? 0;
    if (!best || opens > best.opensPerDay) {
      best = { startHour: start, endHour: start + DND_WINDOW.hours, opensPerDay: opens };
    }
  }
  if (!best || best.opensPerDay < DND_WINDOW.minOpensPerDay) return null;
  return { ...best, opensPerDay: Math.round(best.opensPerDay * 10) / 10 };
}

/** The next time the window comes round: today if enough of it is left, else tomorrow. */
export function nextWindow(
  win: BusiestWindow,
  now: number,
  zone: Zone,
): { day: string; start: number; end: number } {
  const today = zone.dayOf(now);
  const endToday = zone.at(today, win.endHour * 60);
  if (endToday - now >= DND_WINDOW.minLeftMs) {
    return { day: today, start: Math.max(zone.at(today, win.startHour * 60), now), end: endToday };
  }
  const tomorrow = zone.nextDay(today);
  return {
    day: tomorrow,
    start: zone.at(tomorrow, win.startHour * 60),
    end: zone.at(tomorrow, win.endHour * 60),
  };
}

const isWindowOffer = (r: Recommendation) =>
  r.action?.kind === "do_not_disturb" && r.action.payload.window === WINDOW_MARK;

/**
 * The offer for the next busiest window, or null: too little data, the window is too quiet, or an
 * offer for that day already exists (whatever became of it: one a day, never twice).
 */
export function planDndWindow(input: {
  cadence: PhoneCadence | null | undefined;
  now: number;
  zone: Zone;
  existing: Recommendation[];
}): NewRecommendation | null {
  const win = busiestWindow(input.cadence);
  if (!win) return null;
  const { zone, now } = input;
  const next = nextWindow(win, now, zone);
  const already = input.existing.some(
    (r) => isWindowOffer(r) && r.action?.payload.day === next.day && r.status !== "dismissed",
  );
  if (already) return null;
  const from = zone.clock(next.start);
  const until = zone.clock(next.end);
  const usual = `${zone.clock(zone.at(next.day, win.startHour * 60))} to ${until}`;
  const when = next.day === zone.dayOf(now) ? (next.start > now ? "today" : "now") : "tomorrow";
  const opens = Number.isInteger(win.opensPerDay) ? String(win.opensPerDay) : win.opensPerDay.toFixed(1);
  const every = Math.round((DND_WINDOW.hours * 60) / win.opensPerDay);
  return {
    goal_id: null,
    title:
      when === "now" ? `Do Not Disturb now, until ${until}.` : `Do Not Disturb ${when}, ${from} to ${until}.`,
    rationale: `${usual} is when your phone pulls hardest: ${opens} opens a day this week, one every ${voiceDuration(every)}. One tap and I switch on Do Not Disturb for those hours; it ends by itself at ${until}, and undo ends it sooner.`,
    action: {
      kind: "do_not_disturb",
      payload: {
        start_at: new Date(next.start).toISOString(),
        end_at: new Date(next.end).toISOString(),
        window: WINDOW_MARK,
        day: next.day,
      },
      involves_others: false,
      undo_until: new Date(next.end).toISOString(),
    },
    source: "analysis",
  };
}
