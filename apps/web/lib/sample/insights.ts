import { addDays } from "../athens";
import type { Insights, Series } from "../insights";

// The demo account's patterns (#432) until GET /v1/insights is live, and the early states a new
// account sees (?demo=studying, ?demo=watching). Figures follow Manolis' own weeks.

const T = true;
const F = false;

const LAST_DAY = "2026-11-14";
const DAYS = Array.from({ length: 84 }, (_, i) => addDays(LAST_DAY, i - 83));

/** Nights with 40 minutes or more of phone after 23:00, oldest first, and whether the chain held. */
const LATE_NIGHTS = [6, 13, 19, 27, 34, 41, 48, 55, 62, 70, 79].map((i) => DAYS[i] as string);

/** A fixed pseudo random walk, so the lines look lived in and never change between renders. */
function noise(seed: number) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647 - 0.5;
  };
}

function line(
  key: Series["key"],
  label: string,
  unit: string,
  base: number,
  spread: number,
  late: number,
  seed: number,
  gaps: number[] = [],
): Series {
  const r = noise(seed);
  const lateSet = new Set(LATE_NIGHTS.map((d) => DAYS.indexOf(d) + 1));
  // Each day leans on the one before, as bodies do: slow drifts with small daily wobble.
  const walk: number[] = [];
  let level = 0;
  for (let i = 0; i < DAYS.length; i++) {
    level = level * 0.8 + r() * 0.5;
    walk.push(level + r() * 0.25);
  }
  return {
    key,
    label,
    unit,
    points: DAYS.map((day, i) => ({
      day,
      value: gaps.includes(i)
        ? null
        : Math.round(base + (walk[i] ?? 0) * spread + (lateSet.has(i) ? late : 0)),
    })),
  };
}

const SERIES: Series[] = [
  line("sleep_score", "Sleep score", "score", 83, 10, -14, 7, [22, 23, 51]),
  line("hrv", "Heart rate variability", "ms", 58, 14, -11, 11, [22, 23, 51]),
  line("resting_hr", "Resting heart rate", "bpm", 54, 4, 4, 13, [22, 23, 51]),
  line("recovery", "Recovery", "pct", 72, 18, -20, 17, [22, 23, 51]),
];

export const sampleInsights: Insights = {
  studied: {
    days: 84,
    nights: 81,
    data_points: 31204,
    sources: [
      "apple-watch",
      "iphone",
      "mac",
      "google-calendar",
      "chrome",
      "claude-code",
      "location",
      "telegram",
    ],
    needed_days: 14,
  },
  insights: [
    {
      id: "late-phone",
      kind: "chain",
      status: "pattern",
      title: "Late phone costs you the next day.",
      line: "40 minutes of phone after 23:00, then 14 points less sleep score and 31 more minutes lost the day after.",
      steps: [
        { label: "Phone after 23:00", value: "40 min or more" },
        { label: "Sleep score", value: "71 against 85", value_num: 71, usual_num: 85 },
        { label: "Lost the next day", value: "58 min against 27", value_num: 58, usual_num: 27 },
      ],
      evidence: {
        times_held: 9,
        times_seen: 11,
        needed: 4,
        history: [T, T, F, T, T, T, T, F, T, T, T],
        days: LATE_NIGHTS,
      },
      fix: {
        text: "Phone on the charger outside the bedroom at 23:00.",
        action: { kind: "nudge", label: "Nudge me at 22:50", done_label: "Set. I nudge you at 22:50." },
        applied_at: null,
      },
      found_by: "rule",
      last_seen: "2026-11-13T23:41:00+02:00",
      sources: ["iphone", "apple-watch", "mac"],
      strength: 0.91,
    },
    {
      id: "early-calls",
      kind: "link",
      status: "pattern",
      title: "Calls before 10:00 eat your deep work.",
      line: "A call before 10:00, then 52 minutes less deep work that day.",
      steps: [
        { label: "Call before 10:00", value: "Any length" },
        { label: "Deep work that day", value: "1h 34 against 2h 26", value_num: 94, usual_num: 146 },
      ],
      evidence: { times_held: 7, times_seen: 9, needed: 4, history: [T, T, T, F, T, T, F, T, T] },
      fix: {
        text: "Keep 09:00 to 11:00 free of calls on Tuesday and Thursday.",
        action: {
          kind: "block",
          label: "Hold 09:00 to 11:00",
          done_label: "Held on Tuesday and Thursday. Undo any time before it starts.",
        },
        applied_at: null,
      },
      found_by: "rule",
      last_seen: "2026-11-12T09:30:00+02:00",
      sources: ["google-calendar", "mac"],
      strength: 0.78,
    },
    {
      id: "swim-mornings",
      kind: "discovered",
      status: "pattern",
      title: "Swim days give you sharper mornings.",
      line: "On days you swim, the next morning's first goal block loses 18 minutes less to the phone.",
      steps: [
        { label: "Swim", value: "Before 20:00" },
        { label: "Lost next morning", value: "9 min against 27", value_num: 9, usual_num: 27 },
      ],
      evidence: { times_held: 6, times_seen: 7, needed: 4, history: [T, T, T, F, T, T, T] },
      fix: {
        text: "Swim on Monday, Wednesday and Friday at 18:00.",
        action: {
          kind: "block",
          label: "Book the three swims",
          done_label: "Booked. Undo any time before each one starts.",
        },
        applied_at: null,
      },
      found_by: "model",
      last_seen: "2026-11-11T19:00:00+02:00",
      sources: ["apple-watch", "iphone", "google-calendar"],
      strength: 0.7,
    },
    {
      id: "short-sundays",
      kind: "link",
      status: "watching",
      title: "Short Sunday nights, weak Mondays.",
      line: "Under 6 hours of sleep on Sunday, then a Monday score 20 points lower.",
      steps: [
        { label: "Sleep on Sunday", value: "Under 6h" },
        { label: "Monday score", value: "48% against 68%", value_num: 48, usual_num: 68 },
      ],
      evidence: { times_held: 3, times_seen: 3, needed: 4, history: [T, T, T] },
      fix: null,
      found_by: "rule",
      last_seen: "2026-11-09T07:10:00+02:00",
      sources: ["apple-watch", "google-calendar"],
    },
    {
      id: "whatsapp-lunch",
      kind: "discovered",
      status: "watching",
      title: "WhatsApp after lunch spills into the afternoon.",
      line: "WhatsApp opened within 10 minutes of lunch, then the 14:00 block starts 22 minutes late.",
      steps: [
        { label: "WhatsApp after lunch", value: "Within 10 min" },
        { label: "Start of the 14:00 block", value: "22 min late" },
      ],
      evidence: { times_held: 2, times_seen: 3, needed: 4, history: [T, F, T] },
      fix: null,
      found_by: "model",
      last_seen: "2026-11-13T14:22:00+02:00",
      sources: ["iphone", "google-calendar"],
    },
  ],
  series: SERIES,
};

/** A new account on night 3: nothing to show yet but the count. */
export const sampleInsightsStudying: Insights = {
  studied: {
    days: 3,
    nights: 3,
    data_points: 1184,
    sources: ["apple-watch", "iphone", "google-calendar"],
    needed_days: 14,
  },
  insights: [],
};

/** Week two: first things seen, nothing held often enough yet. */
export const sampleInsightsWatching: Insights = {
  studied: {
    days: 9,
    nights: 9,
    data_points: 3612,
    sources: ["apple-watch", "iphone", "mac", "google-calendar"],
    needed_days: 14,
  },
  insights: sampleInsights.insights
    .filter((i) => i.id === "late-phone" || i.id === "whatsapp-lunch")
    .map((i) =>
      i.id === "late-phone"
        ? {
            ...i,
            status: "watching" as const,
            fix: null,
            evidence: { times_held: 2, times_seen: 2, needed: 4, history: [T, T] },
          }
        : i,
    ),
};
