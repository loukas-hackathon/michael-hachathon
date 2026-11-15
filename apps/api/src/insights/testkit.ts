import type { Event, EventInput, Goal } from "@michael/shared";
import { APPS, goal } from "../patterns/testkit";
import { Zone } from "../patterns/time";
import { seeded } from "./stats";

// A hand made month for the tests and for trying the engine on a local API: one person, one
// business goal with a block every weekday morning, a phone, a watch. Every figure is made up.
// With `planted`, three things are tied together the way the founder described: a late night on
// the phone, a worse night's sleep, and a first block that loses more time the next day. Without
// it the same columns are filled independently, so nothing should be found.

export const PLANTED_GOAL_ID = "00000000-0000-4000-8000-00000000a001";

export interface MonthOptions {
  /** First local day, "YYYY-MM-DD". */
  firstDay: string;
  days: number;
  seed: number;
  /** Tie late phone, sleep and the first block together. Default true. */
  planted?: boolean;
  timezone?: string;
}

export interface Month {
  inputs: EventInput[];
  goals: Goal[];
  /** The nights (by the day of their evening) the phone stayed on late. */
  lateNights: string[];
  /** One instant after the last day, for `to` and `now`. */
  end: string;
}

export function plantedMonth(options: MonthOptions): Month {
  const zone = new Zone(options.timezone ?? "Europe/Athens");
  const next = seeded(options.seed);
  const planted = options.planted ?? true;
  const between = (lo: number, hi: number) => lo + next() * (hi - lo);
  const inputs: EventInput[] = [];
  const at = (day: string, minutes: number) => new Date(zone.at(day, minutes)).toISOString();
  const push = (e: Omit<EventInput, "start_at" | "end_at">, day: string, from: number, to: number | null) =>
    inputs.push({ ...e, start_at: at(day, from), end_at: to === null ? null : at(day, to) });
  const phone = (bundle: string, title: string, day: string, from: number, to: number) =>
    push(
      {
        source: "iphone_usage",
        type: "app_usage",
        title,
        data: { bundle_id: bundle, device: "iphone", seconds: Math.round((to - from) * 60) },
      },
      day,
      from,
      to,
    );
  const mac = (bundle: string, title: string, day: string, from: number, to: number) =>
    push(
      {
        source: "macos_usage",
        type: "app_usage",
        title,
        data: { bundle_id: bundle, device: "mac", seconds: Math.round((to - from) * 60) },
      },
      day,
      from,
      to,
    );

  const lateNights: string[] = [];
  let lateBefore = false;
  let day = options.firstDay;
  for (let i = 0; i < options.days; i++, day = zone.nextDay(day)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const workday = weekday >= 1 && weekday <= 5;
    // What last night does to today, when the three are tied together; a coin each otherwise.
    const roughMorning = planted ? lateBefore : next() < 0.35;
    const roughBlock = planted ? lateBefore : next() < 0.35;

    // The morning's reading.
    push(
      {
        source: "whoop",
        type: "recovery",
        title: "Recovery",
        data: {
          recovery_pct: Math.round(roughMorning ? between(34, 50) : between(58, 76)),
          hrv_ms: Math.round(roughMorning ? between(40, 50) : between(54, 64)),
          resting_hr: Math.round(roughMorning ? between(56, 60) : between(51, 55)),
        },
      },
      day,
      7 * 60 + 30,
      null,
    );

    // A few looks at the phone through the day.
    const looks = 6 + Math.floor(next() * 8);
    for (let k = 0; k < looks; k++) {
      const start = 11 * 60 + k * 45 + Math.floor(next() * 20);
      phone(APPS.chat, "WhatsApp", day, start, start + 1 + next() * 3);
    }

    // The first block of a working day, and what it loses.
    if (workday) {
      const lost = roughBlock ? between(21, 33) : between(4, 12);
      push(
        {
          source: "google_calendar",
          type: "calendar_event",
          title: "Deep work",
          data: { goal_id: PLANTED_GOAL_ID, attendees: 0 },
        },
        day,
        9 * 60,
        10 * 60 + 30,
      );
      mac(APPS.editor, "VS Code", day, 9 * 60, 9 * 60 + 20);
      phone(APPS.social, "Instagram", day, 9 * 60 + 20, 9 * 60 + 20 + lost);
      mac(APPS.editor, "VS Code", day, 9 * 60 + 20 + lost, 10 * 60 + 30);
      if (next() < 0.5) {
        push(
          { source: "google_calendar", type: "calendar_event", title: "Meeting", data: { attendees: 2 } },
          day,
          14 * 60,
          14 * 60 + 30 + Math.floor(next() * 3) * 15,
        );
      }
    }
    if (next() < 0.4) {
      push(
        { source: "health_auto_export", type: "workout", title: "Run", data: { duration_min: 45 } },
        day,
        18 * 60,
        18 * 60 + 45,
      );
    }

    // The evening: a late night on the phone about one night in three.
    const late = next() < 0.36;
    if (late) lateNights.push(day);
    phone(APPS.chat, "WhatsApp", day, 22 * 60 + 35, 22 * 60 + 38 + next() * 3);
    if (late) phone(APPS.social, "Instagram", day, 23 * 60 + 40, 24 * 60 + between(18, 34));

    // The night, which ends tomorrow morning.
    const roughNight = planted ? late : next() < 0.35;
    const start = late ? 24 * 60 + 40 : 23 * 60 + 30 + Math.floor(next() * 10);
    const duration = Math.round(roughNight ? between(315, 350) : between(435, 465));
    push(
      {
        source: "health_auto_export",
        type: "sleep",
        title: "Sleep",
        data: {
          duration_min: duration,
          deep_min: Math.round(roughNight ? between(34, 46) : between(72, 88)),
          rem_min: Math.round(roughNight ? between(52, 66) : between(96, 112)),
          awake_min: Math.round(roughNight ? between(32, 44) : between(8, 16)),
        },
      },
      day,
      start,
      start + duration + (roughNight ? 38 : 12),
    );
    lateBefore = late;
  }
  return {
    inputs,
    goals: [{ ...goal("business", PLANTED_GOAL_ID, "Deep work"), weekly_budget_minutes: 450 }],
    lateNights,
    end: at(day, 12 * 60),
  };
}

/** The same inputs as stored events, for the pure functions. */
export const asEvents = (inputs: EventInput[]): Event[] =>
  inputs.map((e, i) => ({
    id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`,
    external_id: null,
    created_at: "2026-01-01T00:00:00Z",
    source: e.source,
    type: e.type,
    start_at: e.start_at,
    end_at: e.end_at ?? null,
    title: e.title ?? "",
    data: e.data ?? {},
  }));

