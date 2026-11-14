import type { AnalysisRun, Event, Goal, Integration, Recommendation } from "./schemas";

// Deterministic mock day (Athens, UTC+02:00) used by apps/web until real endpoints exist,
// and by apps/api's in-memory store when Supabase is not configured.

const CREATED = "2026-11-14T00:00:00.000Z";

const ev = (
  n: number,
  e: Omit<Event, "id" | "created_at" | "external_id"> & { external_id?: string | null },
): Event => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  created_at: CREATED,
  external_id: e.external_id ?? null,
  ...e,
});

export const mockEvents: Event[] = [
  ev(1, {
    source: "whoop",
    type: "sleep",
    start_at: "2026-11-13T23:40:00+02:00",
    end_at: "2026-11-14T06:55:00+02:00",
    title: "Sleep 7h15m (82% performance)",
    data: { duration_min: 435, performance_pct: 82, rem_min: 95, deep_min: 70 },
  }),
  ev(2, {
    source: "whoop",
    type: "recovery",
    start_at: "2026-11-14T07:00:00+02:00",
    end_at: null,
    title: "Recovery 64% (yellow)",
    data: { recovery_pct: 64, hrv_ms: 58, resting_hr: 54 },
  }),
  ev(3, {
    source: "google_calendar",
    type: "calendar_event",
    start_at: "2026-11-14T09:30:00+02:00",
    end_at: "2026-11-14T10:00:00+02:00",
    title: "Hackathon kickoff call",
    data: { attendees: 2, location: "Google Meet" },
  }),
  ev(4, {
    source: "omi",
    type: "conversation",
    start_at: "2026-11-14T09:31:00+02:00",
    end_at: "2026-11-14T09:58:00+02:00",
    title: "Planned Michael architecture with Manolis",
    data: {
      summary: "Agreed on one shared timeline, Hono API on Railway, Next.js web on Vercel.",
      action_items: ["Scaffold repo", "Write API contract"],
    },
  }),
  ev(5, {
    source: "activitywatch",
    type: "focus_session",
    start_at: "2026-11-14T10:05:00+02:00",
    end_at: "2026-11-14T12:20:00+02:00",
    title: "Deep work: VS Code + Terminal (2h15m)",
    data: { apps: { Code: 98, Terminal: 27, Chrome: 10 }, switches: 14 },
  }),
  ev(6, {
    source: "ios_shortcuts",
    type: "app_usage",
    start_at: "2026-11-14T12:22:00+02:00",
    end_at: "2026-11-14T12:47:00+02:00",
    title: "Instagram 25m",
    data: { app: "Instagram" },
  }),
  ev(7, {
    source: "manual",
    type: "meal",
    start_at: "2026-11-14T13:00:00+02:00",
    end_at: "2026-11-14T13:30:00+02:00",
    title: "Lunch: souvlaki + salad",
    data: { estimated_kcal: 850 },
  }),
  ev(8, {
    source: "google_calendar",
    type: "calendar_event",
    start_at: "2026-11-14T18:00:00+02:00",
    end_at: "2026-11-14T19:00:00+02:00",
    title: "Gym: upper body",
    data: { location: "Local gym" },
  }),
  ev(9, {
    source: "omi",
    type: "memory",
    start_at: "2026-11-14T14:10:00+02:00",
    end_at: null,
    title: "Wants to sleep before 00:30 during the hackathon",
    data: { category: "rest" },
  }),
];

const GOAL_IDS = {
  work: "10000000-0000-4000-8000-000000000001",
  gym: "10000000-0000-4000-8000-000000000002",
  rest: "10000000-0000-4000-8000-000000000003",
  food: "10000000-0000-4000-8000-000000000004",
} as const;

export const mockGoals: Goal[] = [
  {
    id: GOAL_IDS.work,
    category: "work",
    title: "4h of deep work per day",
    description: "Uninterrupted focus blocks of 90 minutes or more.",
    target: { deep_work_hours: 4 },
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: GOAL_IDS.gym,
    category: "gym",
    title: "Train 4x per week",
    description: null,
    target: { sessions_per_week: 4 },
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: GOAL_IDS.rest,
    category: "rest",
    title: "Sleep 7.5h+",
    description: "In bed before 00:30.",
    target: { sleep_hours: 7.5, bedtime_before: "00:30" },
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: GOAL_IDS.food,
    category: "food",
    title: "High-protein meals",
    description: null,
    target: { protein_g_per_day: 140 },
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
];

export const mockAnalysisRun: AnalysisRun = {
  id: "20000000-0000-4000-8000-000000000001",
  status: "succeeded",
  trigger: "manual",
  range_start: "2026-11-14T00:00:00+02:00",
  range_end: "2026-11-14T23:59:59+02:00",
  model: "gemini (mock)",
  summary: "Solid morning focus block, recovery is yellow, and a 25-minute social media dip after lunch.",
  error: null,
  started_at: "2026-11-14T14:30:00+02:00",
  finished_at: "2026-11-14T14:30:08+02:00",
};

export const mockRecommendations: Recommendation[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    analysis_run_id: mockAnalysisRun.id,
    goal_id: GOAL_IDS.rest,
    title: "Swap tonight's heavy gym session for mobility",
    rationale: "Recovery is 64% (yellow). A lighter session protects tomorrow's build day.",
    action: {
      kind: "move_calendar_block",
      payload: { event_id: "00000000-0000-4000-8000-000000000008", new_title: "Gym: mobility 40m" },
    },
    status: "proposed",
    created_at: "2026-11-14T14:30:08+02:00",
    updated_at: "2026-11-14T14:30:08+02:00",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    analysis_run_id: mockAnalysisRun.id,
    goal_id: GOAL_IDS.work,
    title: "Block 15:00-16:30 for a second deep-work session",
    rationale: "You have 2h15m of focus so far. One more 90-minute block hits the 4h goal.",
    action: {
      kind: "create_calendar_block",
      payload: { start_at: "2026-11-14T15:00:00+02:00", end_at: "2026-11-14T16:30:00+02:00" },
    },
    status: "proposed",
    created_at: "2026-11-14T14:30:08+02:00",
    updated_at: "2026-11-14T14:30:08+02:00",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    analysis_run_id: mockAnalysisRun.id,
    goal_id: GOAL_IDS.food,
    title: "Add a protein snack before the gym",
    rationale: "Lunch was carb-heavy. About 30g of protein around 16:30 keeps you on target.",
    action: null,
    status: "proposed",
    created_at: "2026-11-14T14:30:08+02:00",
    updated_at: "2026-11-14T14:30:08+02:00",
  },
];

export const mockIntegrations: Integration[] = [
  {
    provider: "google_calendar",
    status: "disconnected",
    connected_at: null,
    last_sync_at: null,
    error: null,
  },
  { provider: "whoop", status: "disconnected", connected_at: null, last_sync_at: null, error: null },
];
