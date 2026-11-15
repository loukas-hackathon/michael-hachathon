import type { Moment, MomentGoal } from "@michael/shared";

// SAMPLE DATA, not the user's. The same Wednesday as sample/day.ts, shaped like GET /v1/moments/:kind
// so the card can be built before the API is wired. Numbers add up: 310 minutes planned today.

const d = (hhmm: string) => `2026-11-11T${hhmm}:00+02:00`;
const WORK = "10000000-0000-4000-8000-000000000001";
const GYM = "10000000-0000-4000-8000-000000000002";

const goals = (today: Partial<MomentGoal>[]): MomentGoal[] => [
  {
    goal_id: WORK,
    title: "The company",
    category: "work",
    budget_minutes: 1200,
    spent_week_minutes: 410,
    planned_today_minutes: 270,
    spent_today_minutes: 0,
    lost_today_minutes: 0,
    planned_ahead_minutes: 540,
    unplanned_minutes: 250,
    ...today[0],
  },
  {
    goal_id: GYM,
    title: "70.3 training",
    category: "gym",
    budget_minutes: 540,
    spent_week_minutes: 150,
    planned_today_minutes: 40,
    spent_today_minutes: 0,
    lost_today_minutes: 0,
    planned_ahead_minutes: 200,
    unplanned_minutes: 190,
    ...today[1],
  },
];

export const sampleMorningMoment: Moment = {
  kind: "morning",
  day: "2026-11-11",
  timezone: "Europe/Athens",
  generated_at: d("07:24"),
  headline: "Today holds 5h 10 of goal time. Yesterday the 11:00 block lost 41 minutes to WhatsApp.",
  phrased_by: "template",
  goals: goals([{}, {}]),
  totals: {
    planned_minutes: 310,
    spent_minutes: 0,
    lost_minutes: 0,
    baseline_lost_minutes: 47,
    won_back_minutes: 0,
  },
  at_risk: {
    start_at: d("11:00"),
    end_at: d("13:00"),
    title: "The company",
    goal_id: WORK,
    block_event_id: null,
    expected_lost_minutes: 34,
    history_days: 7,
    usual_trigger: "WhatsApp",
    last_time: { day: "2026-11-10", lost_minutes: 41, trigger: "WhatsApp" },
  },
  suggestions: [
    {
      title: "Phone in another room from 11:00 to 13:00",
      rationale: "Yesterday this block lost 41 minutes to WhatsApp.",
      action_kind: "reminder",
      start_at: d("11:00"),
      end_at: d("13:00"),
      goal_id: WORK,
    },
    {
      title: "Book 60 minutes of training at 07:45",
      rationale:
        "390 of 540 minutes for 70.3 training left this week and 200 planned, so 190 are not booked.",
      action_kind: "create_focus_block",
      start_at: d("07:45"),
      end_at: d("08:45"),
      goal_id: GYM,
    },
  ],
  lesson: null,
  first_move: null,
};

export const sampleEveningMoment: Moment = {
  ...sampleMorningMoment,
  kind: "evening",
  generated_at: d("21:30"),
  headline: "You held 4h 23 of 5h 10 planned goal time. 47 minutes got away.",
  goals: goals([
    { spent_week_minutes: 643, spent_today_minutes: 233, lost_today_minutes: 37 },
    { spent_week_minutes: 190, spent_today_minutes: 40 },
  ]),
  totals: {
    planned_minutes: 310,
    spent_minutes: 263,
    lost_minutes: 47,
    baseline_lost_minutes: 47,
    won_back_minutes: 0,
  },
  at_risk: null,
  suggestions: [],
  lesson: "WhatsApp cost 31 minutes in 6 interruptions today.",
  first_move: {
    title: "Start The company at 09:00",
    rationale: "First goal block tomorrow: 180 minutes for The company. Put WhatsApp away before it starts.",
    action_kind: "reminder",
    start_at: "2026-11-12T09:00:00+02:00",
    end_at: "2026-11-12T12:00:00+02:00",
    goal_id: WORK,
  },
};
