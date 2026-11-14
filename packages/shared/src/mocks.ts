import type {
  AnalysisRun,
  Event,
  Goal,
  Instruction,
  Integration,
  Recommendation,
  Score,
  ScoreTick,
} from "./schemas";

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
    title: "Wants to be asleep by 00:30 during the hackathon",
    data: { category: "rest" },
  }),
  ev(10, {
    source: "macos_usage",
    type: "app_usage",
    start_at: "2026-11-14T11:02:10+02:00",
    end_at: "2026-11-14T11:13:40+02:00",
    title: "WhatsApp",
    data: { bundle_id: "net.whatsapp.WhatsApp", device: "mac", seconds: 690 },
  }),
  ev(11, {
    source: "iphone_usage",
    type: "app_usage",
    start_at: "2026-11-14T11:31:05+02:00",
    end_at: "2026-11-14T11:36:20+02:00",
    title: "Instagram",
    data: { bundle_id: "com.burbn.instagram", device: "iphone", seconds: 315, opened_from: "notification" },
  }),
  ev(12, {
    source: "chrome",
    type: "web_visit",
    start_at: "2026-11-14T11:40:00+02:00",
    end_at: "2026-11-14T11:52:00+02:00",
    title: "Flights from Athens to New York",
    data: { host: "www.skyscanner.net", category: "travel", seconds: 720 },
  }),
  ev(13, {
    source: "chrome",
    type: "search",
    start_at: "2026-11-14T11:39:40+02:00",
    end_at: null,
    title: "athens new york flights december",
    data: { engine: "google", term: "athens new york flights december" },
  }),
  ev(14, {
    source: "claude_code",
    type: "ai_session",
    start_at: "2026-11-14T12:20:00+02:00",
    end_at: "2026-11-14T13:05:00+02:00",
    title: "Build the timeline view",
    data: { tool: "claude_code", project: "michael", turns: 14, waiting_seconds: 540, output_tokens: 48200 },
  }),
];

const GOAL_IDS = {
  work: "10000000-0000-4000-8000-000000000001",
  gym: "10000000-0000-4000-8000-000000000002",
  rest: "10000000-0000-4000-8000-000000000003",
  food: "10000000-0000-4000-8000-000000000004",
  fun: "10000000-0000-4000-8000-000000000005",
} as const;

// One goal of each shape, in the three categories (docs/api.md, Goals). `target.kind` says what a
// goal measures; without it a goal is `time`.
export const mockGoals: Goal[] = [
  {
    id: GOAL_IDS.work,
    category: "business",
    title: "4h of deep work per day",
    description: "Uninterrupted focus blocks of 90 minutes or more.",
    // calendar_titles: the calendar event titles that count towards this goal.
    target: { kind: "time", deep_work_hours: 4, calendar_titles: ["Deep work", "Study"] },
    weekly_budget_minutes: 1200,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: GOAL_IDS.gym,
    category: "health",
    title: "70.3 training: 9 hours this week",
    description: null,
    target: { kind: "time", sessions_per_week: 4, calendar_titles: ["Gym", "Run", "Swim"] },
    weekly_budget_minutes: 540,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: GOAL_IDS.rest,
    category: "health",
    title: "Sleep 7.5h+",
    description: "In bed before 00:30.",
    // A value per day, not planned minutes: listed on the Goals screen, outside the time score.
    target: { kind: "target", sleep_hours: 7.5, screens_off: "23:30", bedtime_before: "00:30" },
    weekly_budget_minutes: 3150,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: GOAL_IDS.food,
    category: "health",
    title: "High-protein meals",
    description: null,
    target: { kind: "target", protein_g_per_day: 140 },
    weekly_budget_minutes: null,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: GOAL_IDS.fun,
    category: "personal",
    title: "Evenings out",
    description: null,
    // A personal goal carries a free label: fun, family, hobby.
    target: { kind: "time", label: "fun", calendar_titles: ["Night out", "Dinner out"] },
    weekly_budget_minutes: 180,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  },
];

// Standing instructions: the user's ground rules, not goals (docs/api.md, Standing instructions).
export const mockInstructions: Instruction[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    text: "Keep Sundays clear",
    kind: "clear_day",
    days: [0],
    // The Sunday recovery session is the one thing allowed on a clear Sunday.
    exceptions: ["Rhefuel"],
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
  question: null,
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
      involves_others: false,
      undo_until: "2026-11-14T18:00:00+02:00",
    },
    evidence: [],
    status: "proposed",
    executed_at: null,
    undone_at: null,
    created_at: "2026-11-14T14:30:08+02:00",
    updated_at: "2026-11-14T14:30:08+02:00",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    analysis_run_id: mockAnalysisRun.id,
    goal_id: GOAL_IDS.work,
    title: "Block 15:00 to 16:30 for a second deep work session",
    rationale: "You have 2h15m of focus so far. One more 90-minute block hits the 4h goal.",
    action: {
      kind: "create_focus_block",
      payload: { start_at: "2026-11-14T15:00:00+02:00", end_at: "2026-11-14T16:30:00+02:00" },
      involves_others: false,
      undo_until: "2026-11-14T15:00:00+02:00",
    },
    evidence: ["focus_disruptions"],
    status: "proposed",
    executed_at: null,
    undone_at: null,
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
    evidence: [],
    status: "proposed",
    executed_at: null,
    undone_at: null,
    created_at: "2026-11-14T14:30:08+02:00",
    updated_at: "2026-11-14T14:30:08+02:00",
  },
];

export const mockIntegrations: Integration[] = [
  {
    provider: "google_calendar",
    status: "disconnected",
    account: null,
    connected_at: null,
    last_sync_at: null,
    error: null,
  },
  {
    provider: "whoop",
    status: "disconnected",
    account: null,
    connected_at: null,
    last_sync_at: null,
    error: null,
  },
];

// ---------- score (GET /v1/score) ----------
// A made up Wednesday at 15:20, the same day the web app's sample tells: planned 310 minutes, spent
// 213, lost 47, 50 ahead, 82% so far, 64% for the week, 47 minutes won back. It is exactly what the
// API returns for the synthetic week in apps/api/src/score/mock-scenario.ts (a test keeps the two
// equal), so it has the real shape down to the ticks.

const TICKS = { s: "spent", l: "lost", a: "ahead", u: "unverified" } as const;
/** One letter per 5 minute tick: s spent, l lost, a ahead, u unverified. */
const tape = (pattern: string): ScoreTick[] => [...pattern].map((c) => TICKS[c as keyof typeof TICKS]);

export const mockScore: Score = {
  week_start: "2026-11-08T22:00:00.000Z",
  planned_minutes: 1000,
  elapsed_minutes: 650,
  spent_minutes: 416,
  lost_minutes: 234,
  ahead_minutes: 350,
  unverified_minutes: 0,
  score_pct: 64,
  time_won_back_minutes: 47,
  lost_causes: [
    { what: "Instagram", category: "social", minutes: 148 },
    { what: "WhatsApp", category: "communication", minutes: 81 },
    { what: "Mail", category: "communication", minutes: 5 },
  ],
  goals: [
    {
      goal_id: "10000000-0000-4000-8000-000000000001",
      title: "4h of deep work per day",
      category: "business",
      area: "business",
      kind: "time",
      scored: true,
      budget_minutes: 1200,
      planned_minutes: 840,
      elapsed_minutes: 590,
      spent_minutes: 366,
      lost_minutes: 224,
      ahead_minutes: 250,
      unverified_minutes: 0,
      score_pct: 62,
      daily: [
        {
          date: "2026-11-09",
          planned_minutes: 120,
          spent_minutes: 43,
        },
        {
          date: "2026-11-10",
          planned_minutes: 210,
          spent_minutes: 110,
        },
        {
          date: "2026-11-11",
          planned_minutes: 270,
          spent_minutes: 213,
        },
        {
          date: "2026-11-12",
          planned_minutes: 120,
          spent_minutes: 0,
        },
        {
          date: "2026-11-13",
          planned_minutes: 120,
          spent_minutes: 0,
        },
        {
          date: "2026-11-14",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-15",
          planned_minutes: 0,
          spent_minutes: 0,
        },
      ],
      minutes_left: 834,
      open_blocks: 3,
    },
    {
      goal_id: "10000000-0000-4000-8000-000000000002",
      title: "70.3 training: 9 hours this week",
      category: "health",
      area: "health",
      kind: "time",
      scored: true,
      budget_minutes: 540,
      planned_minutes: 160,
      elapsed_minutes: 60,
      spent_minutes: 50,
      lost_minutes: 10,
      ahead_minutes: 100,
      unverified_minutes: 0,
      score_pct: 83,
      daily: [
        {
          date: "2026-11-09",
          planned_minutes: 60,
          spent_minutes: 50,
        },
        {
          date: "2026-11-10",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-11",
          planned_minutes: 40,
          spent_minutes: 0,
        },
        {
          date: "2026-11-12",
          planned_minutes: 60,
          spent_minutes: 0,
        },
        {
          date: "2026-11-13",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-14",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-15",
          planned_minutes: 0,
          spent_minutes: 0,
        },
      ],
      minutes_left: 490,
      open_blocks: 2,
    },
    {
      goal_id: "10000000-0000-4000-8000-000000000003",
      title: "Sleep 7.5h+",
      category: "health",
      area: "health",
      kind: "target",
      scored: false,
      budget_minutes: 3150,
      planned_minutes: 0,
      elapsed_minutes: 0,
      spent_minutes: 0,
      lost_minutes: 0,
      ahead_minutes: 0,
      unverified_minutes: 0,
      score_pct: null,
      daily: [
        {
          date: "2026-11-09",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-10",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-11",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-12",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-13",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-14",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-15",
          planned_minutes: 0,
          spent_minutes: 0,
        },
      ],
      minutes_left: 0,
      open_blocks: 0,
    },
    {
      goal_id: "10000000-0000-4000-8000-000000000004",
      title: "High-protein meals",
      category: "health",
      area: "health",
      kind: "target",
      scored: false,
      budget_minutes: 0,
      planned_minutes: 0,
      elapsed_minutes: 0,
      spent_minutes: 0,
      lost_minutes: 0,
      ahead_minutes: 0,
      unverified_minutes: 0,
      score_pct: null,
      daily: [
        {
          date: "2026-11-09",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-10",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-11",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-12",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-13",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-14",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-15",
          planned_minutes: 0,
          spent_minutes: 0,
        },
      ],
      minutes_left: 0,
      open_blocks: 0,
    },
    {
      goal_id: "10000000-0000-4000-8000-000000000005",
      title: "Evenings out",
      category: "personal",
      area: "personal",
      kind: "time",
      scored: true,
      budget_minutes: 180,
      planned_minutes: 0,
      elapsed_minutes: 0,
      spent_minutes: 0,
      lost_minutes: 0,
      ahead_minutes: 0,
      unverified_minutes: 0,
      score_pct: null,
      daily: [
        {
          date: "2026-11-09",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-10",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-11",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-12",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-13",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-14",
          planned_minutes: 0,
          spent_minutes: 0,
        },
        {
          date: "2026-11-15",
          planned_minutes: 0,
          spent_minutes: 0,
        },
      ],
      minutes_left: 180,
      open_blocks: 0,
    },
  ],
  timezone: "Europe/Athens",
  generated_at: "2026-11-11T13:20:00.000Z",
  date: "2026-11-11",
  areas: [
    {
      area: "business",
      goal_ids: ["10000000-0000-4000-8000-000000000001"],
      planned_minutes: 840,
      elapsed_minutes: 590,
      spent_minutes: 366,
      lost_minutes: 224,
      ahead_minutes: 250,
      unverified_minutes: 0,
      score_pct: 62,
      target_pct: null,
      floor_pct: 50,
      meets_floor: true,
    },
    {
      area: "health",
      goal_ids: [
        "10000000-0000-4000-8000-000000000002",
        "10000000-0000-4000-8000-000000000003",
        "10000000-0000-4000-8000-000000000004",
      ],
      planned_minutes: 160,
      elapsed_minutes: 60,
      spent_minutes: 50,
      lost_minutes: 10,
      ahead_minutes: 100,
      unverified_minutes: 0,
      score_pct: 83,
      target_pct: null,
      floor_pct: 50,
      meets_floor: true,
    },
    {
      area: "personal",
      goal_ids: ["10000000-0000-4000-8000-000000000005"],
      planned_minutes: 0,
      elapsed_minutes: 0,
      spent_minutes: 0,
      lost_minutes: 0,
      ahead_minutes: 0,
      unverified_minutes: 0,
      score_pct: null,
      target_pct: null,
      floor_pct: 50,
      meets_floor: false,
    },
  ],
  days: [
    {
      date: "2026-11-09",
      planned_minutes: 180,
      elapsed_minutes: 180,
      spent_minutes: 93,
      lost_minutes: 87,
      ahead_minutes: 0,
      unverified_minutes: 0,
      score_pct: 52,
      time_won_back_minutes: 0,
    },
    {
      date: "2026-11-10",
      planned_minutes: 210,
      elapsed_minutes: 210,
      spent_minutes: 110,
      lost_minutes: 100,
      ahead_minutes: 0,
      unverified_minutes: 0,
      score_pct: 52,
      time_won_back_minutes: 0,
    },
    {
      date: "2026-11-11",
      planned_minutes: 310,
      elapsed_minutes: 260,
      spent_minutes: 213,
      lost_minutes: 47,
      ahead_minutes: 50,
      unverified_minutes: 0,
      score_pct: 82,
      time_won_back_minutes: 47,
    },
    {
      date: "2026-11-12",
      planned_minutes: 180,
      elapsed_minutes: 0,
      spent_minutes: 0,
      lost_minutes: 0,
      ahead_minutes: 180,
      unverified_minutes: 0,
      score_pct: null,
      time_won_back_minutes: 0,
    },
    {
      date: "2026-11-13",
      planned_minutes: 120,
      elapsed_minutes: 0,
      spent_minutes: 0,
      lost_minutes: 0,
      ahead_minutes: 120,
      unverified_minutes: 0,
      score_pct: null,
      time_won_back_minutes: 0,
    },
    {
      date: "2026-11-14",
      planned_minutes: 0,
      elapsed_minutes: 0,
      spent_minutes: 0,
      lost_minutes: 0,
      ahead_minutes: 0,
      unverified_minutes: 0,
      score_pct: null,
      time_won_back_minutes: 0,
    },
    {
      date: "2026-11-15",
      planned_minutes: 0,
      elapsed_minutes: 0,
      spent_minutes: 0,
      lost_minutes: 0,
      ahead_minutes: 0,
      unverified_minutes: 0,
      score_pct: null,
      time_won_back_minutes: 0,
    },
  ],
  day: {
    date: "2026-11-11",
    planned_minutes: 310,
    elapsed_minutes: 260,
    spent_minutes: 213,
    lost_minutes: 47,
    ahead_minutes: 50,
    unverified_minutes: 0,
    score_pct: 82,
    time_won_back_minutes: 47,
    now: "2026-11-11T13:20:00.000Z",
    time_won_back: {
      minutes: 47,
      usual_loss_rate: 0.362,
      history_days: 4,
      reason: null,
    },
    blocks: [
      {
        event_id: "40000000-0000-4000-8000-000000000021",
        goal_id: "10000000-0000-4000-8000-000000000001",
        goal_title: "4h of deep work per day",
        title: "Deep work",
        matched_by: "calendar_titles",
        start_at: "2026-11-11T07:00:00.000Z",
        end_at: "2026-11-11T09:00:00.000Z",
        record_id: null,
        planned_minutes: 120,
        elapsed_minutes: 120,
        spent_minutes: 111,
        lost_minutes: 9,
        ahead_minutes: 0,
        unverified_minutes: 0,
        score_pct: 93,
        ticks: tape("sssssssslssssssssslsssss"),
        lost: [
          {
            start_at: "2026-11-11T07:42:00.000Z",
            end_at: "2026-11-11T07:46:00.000Z",
            minutes: 4,
            what: "WhatsApp",
            kind: "app",
            category: "communication",
            device: "iphone",
          },
          {
            start_at: "2026-11-11T08:31:00.000Z",
            end_at: "2026-11-11T08:36:00.000Z",
            minutes: 5,
            what: "Mail",
            kind: "app",
            category: "communication",
            device: "mac",
          },
        ],
        instructions_broken: [],
      },
      {
        event_id: "40000000-0000-4000-8000-000000000025",
        goal_id: "10000000-0000-4000-8000-000000000001",
        goal_title: "4h of deep work per day",
        title: "Deep work",
        matched_by: "calendar_titles",
        start_at: "2026-11-11T09:30:00.000Z",
        end_at: "2026-11-11T10:30:00.000Z",
        record_id: null,
        planned_minutes: 60,
        elapsed_minutes: 60,
        spent_minutes: 41,
        lost_minutes: 19,
        ahead_minutes: 0,
        unverified_minutes: 0,
        score_pct: 68,
        ticks: tape("ssssssslllls"),
        lost: [
          {
            start_at: "2026-11-11T10:05:00.000Z",
            end_at: "2026-11-11T10:24:00.000Z",
            minutes: 19,
            what: "Instagram",
            kind: "app",
            category: "social",
            device: "iphone",
          },
        ],
        instructions_broken: [],
      },
      {
        event_id: "40000000-0000-4000-8000-000000000028",
        goal_id: "10000000-0000-4000-8000-000000000001",
        goal_title: "4h of deep work per day",
        title: "Study",
        matched_by: "calendar_titles",
        start_at: "2026-11-11T12:00:00.000Z",
        end_at: "2026-11-11T13:30:00.000Z",
        record_id: null,
        planned_minutes: 90,
        elapsed_minutes: 80,
        spent_minutes: 61,
        lost_minutes: 19,
        ahead_minutes: 10,
        unverified_minutes: 0,
        score_pct: 76,
        ticks: tape("ssssssllssssssssaa"),
        lost: [
          {
            start_at: "2026-11-11T12:12:00.000Z",
            end_at: "2026-11-11T12:14:00.000Z",
            minutes: 2,
            what: "WhatsApp",
            kind: "app",
            category: "communication",
            device: "iphone",
          },
          {
            start_at: "2026-11-11T12:31:00.000Z",
            end_at: "2026-11-11T12:42:00.000Z",
            minutes: 11,
            what: "WhatsApp",
            kind: "app",
            category: "communication",
            device: "iphone",
          },
          {
            start_at: "2026-11-11T12:50:00.000Z",
            end_at: "2026-11-11T12:52:00.000Z",
            minutes: 2,
            what: "Instagram",
            kind: "app",
            category: "social",
            device: "iphone",
          },
          {
            start_at: "2026-11-11T13:02:00.000Z",
            end_at: "2026-11-11T13:03:00.000Z",
            minutes: 1,
            what: "WhatsApp",
            kind: "app",
            category: "communication",
            device: "iphone",
          },
          {
            start_at: "2026-11-11T13:09:00.000Z",
            end_at: "2026-11-11T13:11:00.000Z",
            minutes: 2,
            what: "Instagram",
            kind: "app",
            category: "social",
            device: "iphone",
          },
          {
            start_at: "2026-11-11T13:15:00.000Z",
            end_at: "2026-11-11T13:16:00.000Z",
            minutes: 1,
            what: "WhatsApp",
            kind: "app",
            category: "communication",
            device: "iphone",
          },
        ],
        instructions_broken: [],
      },
      {
        event_id: "40000000-0000-4000-8000-000000000036",
        goal_id: "10000000-0000-4000-8000-000000000002",
        goal_title: "70.3 training: 9 hours this week",
        title: "Run",
        matched_by: "calendar_titles",
        start_at: "2026-11-11T16:00:00.000Z",
        end_at: "2026-11-11T16:40:00.000Z",
        record_id: null,
        planned_minutes: 40,
        elapsed_minutes: 0,
        spent_minutes: 0,
        lost_minutes: 0,
        ahead_minutes: 40,
        unverified_minutes: 0,
        score_pct: null,
        ticks: tape("aaaaaaaa"),
        lost: [],
        instructions_broken: [],
      },
    ],
    areas: [
      {
        area: "business",
        goal_ids: ["10000000-0000-4000-8000-000000000001"],
        planned_minutes: 270,
        elapsed_minutes: 260,
        spent_minutes: 213,
        lost_minutes: 47,
        ahead_minutes: 10,
        unverified_minutes: 0,
        score_pct: 82,
      },
      {
        area: "health",
        goal_ids: [
          "10000000-0000-4000-8000-000000000002",
          "10000000-0000-4000-8000-000000000003",
          "10000000-0000-4000-8000-000000000004",
        ],
        planned_minutes: 40,
        elapsed_minutes: 0,
        spent_minutes: 0,
        lost_minutes: 0,
        ahead_minutes: 40,
        unverified_minutes: 0,
        score_pct: null,
      },
      {
        area: "personal",
        goal_ids: ["10000000-0000-4000-8000-000000000005"],
        planned_minutes: 0,
        elapsed_minutes: 0,
        spent_minutes: 0,
        lost_minutes: 0,
        ahead_minutes: 0,
        unverified_minutes: 0,
        score_pct: null,
      },
    ],
  },
  data_until: {
    mac: "2026-11-11T13:30:00.000Z",
    iphone: "2026-11-11T13:16:00.000Z",
  },
  target: null,
  on_target: null,
  records: [],
  free_minutes_left: 4390,
  sleep: { goal_minutes: 450, nightly: [431, 388, 452, null, null, null, null] },
};

// ---------- demo recommendations, relative to now ----------
// The fixed recommendations above sit on 14 Nov and go stale once their times pass. These three are
// placed on the next sensible slot after `now`, so the demo always has something Michael can carry
// out: two solo blocks he can create (and undo), and one with other people that stays advice.

const DEMO_TZ = "Europe/Athens";

/** "2026-11-15T09:30:00+02:00": a wall clock time in Athens, `days` after now's Athens date. */
function athensAt(now: Date, days: number, hhmm: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: DEMO_TZ }).format(
    new Date(now.getTime() + days * 86_400_000),
  );
  const noon = new Date(`${day}T12:00:00Z`);
  const name =
    new Intl.DateTimeFormat("en-GB", { timeZone: DEMO_TZ, timeZoneName: "longOffset" })
      .formatToParts(noon)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+02:00";
  const offset = name.replace("GMT", "") || "+00:00";
  return `${day}T${hhmm}:00${offset}`;
}

const athensHour = (now: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: DEMO_TZ, hour: "2-digit", hourCycle: "h23" }).format(now),
  );

export const DEMO_RECOMMENDATION_IDS = [
  "30000000-0000-4000-8000-000000000004",
  "30000000-0000-4000-8000-000000000005",
  "30000000-0000-4000-8000-000000000006",
] as const;

export function demoRecommendations(now: Date = new Date()): Recommendation[] {
  const hour = athensHour(now);
  // Today if the slot is still comfortably ahead, otherwise tomorrow.
  const focusDay = hour < 8 ? 0 : 1;
  const runDay = hour < 17 ? 0 : 1;
  const focusStart = athensAt(now, focusDay, "09:30");
  const runStart = athensAt(now, runDay, "18:30");
  const syncStart = athensAt(now, 1, "11:00");
  const stamp = now.toISOString();
  const base = {
    analysis_run_id: mockAnalysisRun.id,
    status: "proposed" as const,
    executed_at: null,
    undone_at: null,
    created_at: stamp,
    updated_at: stamp,
  };
  const [focusId, runId, syncId] = DEMO_RECOMMENDATION_IDS;
  return [
    {
      ...base,
      id: focusId,
      goal_id: GOAL_IDS.work,
      title: "Block 09:30 to 11:00 for cold outreach",
      rationale:
        "Your longest focus runs start before 11:00 and the phone is quiet until 10:00. Ninety minutes there is the cheapest company time of the day.",
      action: {
        kind: "create_focus_block",
        payload: { start_at: focusStart, end_at: athensAt(now, focusDay, "11:00"), title: "Cold Outreach" },
        involves_others: false,
        undo_until: focusStart,
      },
    },
    {
      ...base,
      id: runId,
      goal_id: GOAL_IDS.gym,
      title: "Book 45 minutes for an easy run at 18:30",
      rationale:
        "Training is two sessions behind for the 70.3. Your calendar is clear after 18:00 and an easy run keeps tomorrow's legs fresh.",
      action: {
        kind: "create_focus_block",
        payload: { start_at: runStart, end_at: athensAt(now, runDay, "19:15"), title: "Run: easy 45m" },
        involves_others: false,
        undo_until: runStart,
      },
    },
    {
      ...base,
      id: syncId,
      goal_id: GOAL_IDS.work,
      title: "Ask to move the 11:00 sync to the afternoon",
      rationale:
        "It cuts your best focus window in two and costs about 40 minutes of focus either side. It has other people in it, so the call is yours.",
      action: {
        kind: "move_calendar_block",
        payload: {
          event_id: "00000000-0000-4000-8000-000000000099",
          start_at: athensAt(now, 1, "15:00"),
          end_at: athensAt(now, 1, "15:30"),
        },
        involves_others: true,
        undo_until: syncStart,
      },
    },
  ];
}
