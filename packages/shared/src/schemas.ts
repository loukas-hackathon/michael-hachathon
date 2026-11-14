import { z } from "zod";

// ---------- primitives ----------

export const IsoDateTime = z.iso.datetime({ offset: true });

// ---------- enums ----------

export const Source = z.enum([
  "omi",
  "whoop",
  "health_auto_export",
  "ios_shortcuts",
  "activitywatch",
  "google_calendar",
  "owntracks",
  "manual",
  "agent",
  // Local collectors that run on the user's own Mac (apps/collector, apps/extension).
  "macos_usage",
  "iphone_usage",
  "chrome",
  "claude_code",
]);
export type Source = z.infer<typeof Source>;

export const EventType = z.enum([
  "sleep",
  "workout",
  "recovery",
  "biometric",
  "app_usage",
  "focus_session",
  "conversation",
  "memory",
  "calendar_event",
  "location",
  "meal",
  "note",
  // Attention detail from the local collectors. Payloads are documented in docs/api.md.
  "web_visit",
  "search",
  "notification",
  "screen",
  "ai_session",
  "ai_prompt",
]);
export type EventType = z.infer<typeof EventType>;

export const GoalCategory = z.enum(["work", "gym", "rest", "food"]);
export type GoalCategory = z.infer<typeof GoalCategory>;

// proposed -> accepted -> done (action executed) -> undone (reverted before the event started)
// proposed -> dismissed
export const RecommendationStatus = z.enum(["proposed", "accepted", "dismissed", "done", "undone"]);
export type RecommendationStatus = z.infer<typeof RecommendationStatus>;

// Michael acts on the user's own time: own calendar blocks and Mac only. He never touches events
// with other people, never deletes, and never sends in the user's name. Undo until the event starts.
export const ActionKind = z.enum([
  "move_calendar_block",
  "create_focus_block",
  "block_mac_app",
  "draft_follow_up",
  "reminder",
]);
export type ActionKind = z.infer<typeof ActionKind>;

export const AnalysisStatus = z.enum(["queued", "running", "succeeded", "failed"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

// morning = watch detects waking; evening = one hour before usual bedtime.
export const AnalysisTrigger = z.enum(["manual", "scheduled", "mcp", "morning", "evening"]);
export type AnalysisTrigger = z.infer<typeof AnalysisTrigger>;

export const IntegrationProvider = z.enum(["google_calendar", "whoop"]);
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

export const IntegrationStatus = z.enum(["connected", "disconnected", "error"]);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

// ---------- events (the timeline) ----------

export const Event = z.object({
  id: z.uuid(),
  source: Source,
  type: EventType,
  start_at: IsoDateTime,
  end_at: IsoDateTime.nullable(),
  title: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  // Provider-side id used to make ingest idempotent (unique per source).
  external_id: z.string().nullable(),
  created_at: IsoDateTime,
});
export type Event = z.infer<typeof Event>;

export const EventInput = z.object({
  source: Source,
  type: EventType,
  start_at: IsoDateTime,
  end_at: IsoDateTime.nullish(),
  title: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
  external_id: z.string().nullish(),
});
export type EventInput = z.input<typeof EventInput>;

export const EventBatchInput = z.object({
  events: z.array(EventInput).min(1).max(1000),
});
export type EventBatchInput = z.input<typeof EventBatchInput>;

export const TimelineQuery = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
  source: z.array(Source).optional(),
  type: z.array(EventType).optional(),
});
export type TimelineQuery = z.infer<typeof TimelineQuery>;

export const TimelineResponse = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
  events: z.array(Event),
});
export type TimelineResponse = z.infer<typeof TimelineResponse>;

export const IngestResponse = z.object({
  inserted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  // Dropped because the source is switched off or the user is off the record.
  ignored: z.number().int().nonnegative(),
  events: z.array(Event),
});
export type IngestResponse = z.infer<typeof IngestResponse>;

// ---------- goals ----------

export const Goal = z.object({
  id: z.uuid(),
  category: GoalCategory,
  title: z.string().min(1),
  description: z.string().nullable(),
  // Free-form measurable target, e.g. { "sleep_hours": 8 } or { "gym_sessions_per_week": 4 }.
  target: z.record(z.string(), z.unknown()).nullable(),
  // Weekly time budget, e.g. "70.3 training: 9 hours this week" = 540.
  weekly_budget_minutes: z.number().int().nonnegative().nullable(),
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type Goal = z.infer<typeof Goal>;

export const GoalCreate = z.object({
  category: GoalCategory,
  title: z.string().min(1),
  description: z.string().nullish(),
  target: z.record(z.string(), z.unknown()).nullish(),
  weekly_budget_minutes: z.number().int().nonnegative().nullish(),
  active: z.boolean().default(true),
});
export type GoalCreate = z.input<typeof GoalCreate>;

export const GoalUpdate = GoalCreate.partial();
export type GoalUpdate = z.input<typeof GoalUpdate>;

// ---------- recommendations ----------

export const RecommendationAction = z.object({
  kind: ActionKind,
  payload: z.record(z.string(), z.unknown()),
  // True when other people are affected (e.g. a meeting with attendees). Such actions are never
  // executed; Michael only advises on them.
  involves_others: z.boolean(),
  // Undo is allowed until this time (normally the affected event's start). Null = no deadline.
  undo_until: IsoDateTime.nullable(),
});
export type RecommendationAction = z.infer<typeof RecommendationAction>;

export const Recommendation = z.object({
  id: z.uuid(),
  analysis_run_id: z.uuid().nullable(),
  goal_id: z.uuid().nullable(),
  title: z.string().min(1),
  rationale: z.string(),
  action: RecommendationAction.nullable(),
  status: RecommendationStatus,
  executed_at: IsoDateTime.nullable(),
  undone_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type Recommendation = z.infer<typeof Recommendation>;

export const RecommendationStatusUpdate = z.object({
  status: RecommendationStatus,
});
export type RecommendationStatusUpdate = z.infer<typeof RecommendationStatusUpdate>;

// ---------- analysis ----------

export const AnalysisRun = z.object({
  id: z.uuid(),
  status: AnalysisStatus,
  trigger: AnalysisTrigger,
  range_start: IsoDateTime,
  range_end: IsoDateTime,
  model: z.string(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  started_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
});
export type AnalysisRun = z.infer<typeof AnalysisRun>;

export const AnalysisTriggerInput = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
});
export type AnalysisTriggerInput = z.infer<typeof AnalysisTriggerInput>;

export const AnalysisResult = z.object({
  run: AnalysisRun,
  recommendations: z.array(Recommendation),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

// ---------- integrations ----------

export const Integration = z.object({
  provider: IntegrationProvider,
  status: IntegrationStatus,
  // The connected account as the provider names it (Google: the calendar owner's address).
  account: z.string().nullable(),
  connected_at: IsoDateTime.nullable(),
  last_sync_at: IsoDateTime.nullable(),
  error: z.string().nullable(),
});
export type Integration = z.infer<typeof Integration>;

export const IntegrationsResponse = z.object({ integrations: z.array(Integration) });
export type IntegrationsResponse = z.infer<typeof IntegrationsResponse>;

// POST /v1/integrations/:provider/connect: the provider's consent screen, opened by the browser.
export const OAuthConnectResponse = z.object({ url: z.url() });
export type OAuthConnectResponse = z.infer<typeof OAuthConnectResponse>;

// POST /v1/integrations/google_calendar/sync and the sync that runs after connecting.
export const CalendarSyncResult = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
  fetched: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  // Mirrored events that were cancelled or deleted in the calendar since the last sync.
  removed: z.number().int().nonnegative(),
  last_sync_at: IsoDateTime,
});
export type CalendarSyncResult = z.infer<typeof CalendarSyncResult>;

// `data` of a google_calendar calendar_event. Michael never touches events where `with_others` is true.
export const CalendarEventData = z.object({
  calendar: z.string(),
  status: z.string(),
  all_day: z.boolean(),
  // People on the invite, the user included; meeting rooms are left out.
  attendees: z.number().int().nonnegative(),
  // True when anyone else is on the invite or someone else organised it.
  with_others: z.boolean(),
  organizer_self: z.boolean(),
  // True for blocks Michael created himself.
  michael: z.boolean(),
  // "transparent" = shows as free.
  transparency: z.string(),
  recurring: z.boolean(),
  location: z.string().nullable(),
  html_link: z.string().nullable(),
  updated: z.string().nullable(),
});
export type CalendarEventData = z.infer<typeof CalendarEventData>;

// ---------- privacy: sources and off the record ----------

export const SourceSetting = z.object({
  source: Source,
  enabled: z.boolean(),
  updated_at: IsoDateTime,
});
export type SourceSetting = z.infer<typeof SourceSetting>;

export const SourceSettingUpdate = z.object({ enabled: z.boolean() });
export type SourceSettingUpdate = z.infer<typeof SourceSettingUpdate>;

// One tap stops all collection.
export const PrivacyState = z.object({
  off_the_record: z.boolean(),
  since: IsoDateTime.nullable(),
  sources: z.array(SourceSetting),
});
export type PrivacyState = z.infer<typeof PrivacyState>;

export const OffTheRecordUpdate = z.object({ off_the_record: z.boolean() });
export type OffTheRecordUpdate = z.infer<typeof OffTheRecordUpdate>;

// ---------- Michael for agents ----------

export const AgentScope = z.enum(["timeline", "goals", "recommendations", "score", "write_events"]);
export type AgentScope = z.infer<typeof AgentScope>;

export const AgentStatus = z.enum(["pending", "approved", "revoked"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentClient = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  status: AgentStatus,
  scopes: z.array(AgentScope),
  created_at: IsoDateTime,
  last_seen_at: IsoDateTime.nullable(),
});
export type AgentClient = z.infer<typeof AgentClient>;

export const AgentClientUpdate = z.object({
  status: AgentStatus.optional(),
  scopes: z.array(AgentScope).optional(),
});
export type AgentClientUpdate = z.infer<typeof AgentClientUpdate>;

// Every query is logged and visible: "who asked about me today".
export const AgentQuery = z.object({
  id: z.uuid(),
  agent_id: z.uuid(),
  tool: z.string(),
  summary: z.string(),
  allowed: z.boolean(),
  created_at: IsoDateTime,
});
export type AgentQuery = z.infer<typeof AgentQuery>;

// Connecting an MCP client (claude.ai connector) with OAuth: the consent page reads the pending
// request, then the user allows or refuses with one tap.
export const ConnectRequest = z.object({
  id: z.uuid(),
  client_name: z.string(),
  redirect_host: z.string(), // shown on the consent page, e.g. "claude.ai"
  scopes: z.array(AgentScope),
  expires_at: IsoDateTime,
});
export type ConnectRequest = z.infer<typeof ConnectRequest>;

export const ConnectDecision = z.object({ allow: z.boolean() });
export type ConnectDecision = z.infer<typeof ConnectDecision>;

export const ConnectDecisionResponse = z.object({ redirect_to: z.url() });
export type ConnectDecisionResponse = z.infer<typeof ConnectDecisionResponse>;

// ---------- nudges ----------

export const NudgeChannel = z.enum(["watch", "push", "telegram"]);
export type NudgeChannel = z.infer<typeof NudgeChannel>;

export const NudgeStatus = z.enum(["queued", "sent", "failed", "suppressed"]);
export type NudgeStatus = z.infer<typeof NudgeStatus>;

// At most 5 per day, under 15 words, never during quiet hours.
export const Nudge = z.object({
  id: z.uuid(),
  recommendation_id: z.uuid().nullable(),
  channel: NudgeChannel,
  text: z.string().min(1),
  status: NudgeStatus,
  created_at: IsoDateTime,
  sent_at: IsoDateTime.nullable(),
});
export type Nudge = z.infer<typeof Nudge>;

// ---------- score ----------

export const GoalScore = z.object({
  goal_id: z.uuid(),
  budget_minutes: z.number().int().nonnegative(),
  planned_minutes: z.number().int().nonnegative(),
  spent_minutes: z.number().int().nonnegative(),
});
export type GoalScore = z.infer<typeof GoalScore>;

// Headline: share of planned goal time actually spent on goals; "time won back" beneath it.
export const WeeklyScore = z.object({
  week_start: IsoDateTime,
  planned_minutes: z.number().int().nonnegative(),
  spent_minutes: z.number().int().nonnegative(),
  score_pct: z.number().min(0).max(100),
  time_won_back_minutes: z.number().int().nonnegative(),
  goals: z.array(GoalScore),
});
export type WeeklyScore = z.infer<typeof WeeklyScore>;

// ---------- patterns (GET /v1/patterns) ----------
// Computed with plain rules by apps/api/src/patterns. Durations are minutes with one decimal unless
// the field name says seconds. Shares are 0..1. Days are local days in the report's timezone.

// One shared vocabulary for apps and sites. Unknown ids stay "other": the categoriser never guesses.
export const AppCategory = z.enum([
  "work",
  "communication",
  "social",
  "video",
  "news",
  "shopping",
  "travel",
  "ai",
  "music",
  "system",
  "other",
]);
export type AppCategory = z.infer<typeof AppCategory>;

export const PatternDevice = z.enum(["mac", "iphone"]);
export type PatternDevice = z.infer<typeof PatternDevice>;

export const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// What was in front: an app (key = bundle id) or a site (key = host, never a full address).
export const PatternSubject = z.object({
  kind: z.enum(["app", "site"]),
  key: z.string(),
  name: z.string(),
  category: AppCategory,
});
export type PatternSubject = z.infer<typeof PatternSubject>;

// Every detector answers in the same envelope. With too little data `data` and `summary` are null
// and `reason` says what is missing; a number is never made up. `evidence` is a capped list of
// event ids so the app can show the proof.
export const patternDetector = <T extends z.ZodType>(data: T) =>
  z.object({
    status: z.enum(["ok", "not_enough_data"]),
    reason: z.string().nullable(),
    minimum: z.string(),
    summary: z.string().nullable(),
    evidence: z.array(z.string()).max(20),
    data: data.nullable(),
  });

export const PhoneCadence = z.object({
  days_with_data: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  // Sessions in which no app was opened (lock screen or home screen only). Not in `sessions`.
  screen_only_sessions: z.number().int().nonnegative(),
  sessions_per_day: z.number().nonnegative(),
  // Sessions shorter than 30 seconds.
  checks_share: z.number().min(0).max(1),
  median_session_seconds: z.number().nonnegative(),
  // Waking gaps between sessions (sleep and gaps over 3 hours are left out).
  gaps: z.number().int().nonnegative(),
  median_gap_minutes: z.number().nonnegative(),
  typical_gap_minutes: z.object({ p25: z.number().nonnegative(), p75: z.number().nonnegative() }),
  // The working window (default 09:00 to 18:00). `median_gap_minutes` is null under 20 gaps.
  window: z.object({
    start_hour: z.number().int().min(0).max(23),
    end_hour: z.number().int().min(1).max(24),
    sessions_per_day: z.number().nonnegative(),
    // Window length divided by sessions per day: "once every N minutes" on average.
    average_interval_minutes: z.number().nonnegative().nullable(),
    gaps: z.number().int().nonnegative(),
    median_gap_minutes: z.number().nonnegative().nullable(),
  }),
  opened: z.object({
    notification: z.number().int().nonnegative(),
    own_hand: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    // notification / (notification + own_hand); null under 20 sessions with a known reason.
    notification_share: z.number().min(0).max(1).nullable(),
  }),
  first_apps: z.array(
    z.object({
      app: PatternSubject,
      sessions: z.number().int().nonnegative(),
      share: z.number().min(0).max(1),
    }),
  ),
  by_hour: z.array(
    z.object({
      hour: z.number().int().min(0).max(23),
      sessions: z.number().int().nonnegative(),
      sessions_per_day: z.number().nonnegative(),
      // Null under 5 gaps starting in this hour.
      median_gap_minutes: z.number().nonnegative().nullable(),
    }),
  ),
  daily: z.array(
    z.object({
      day: LocalDay,
      complete: z.boolean(),
      sessions: z.number().int().nonnegative(),
      checks: z.number().int().nonnegative(),
      // Session time: first app to last app, pauses under 30 seconds inside a session included.
      minutes: z.number().nonnegative(),
      median_gap_minutes: z.number().nonnegative().nullable(),
    }),
  ),
});
export type PhoneCadence = z.infer<typeof PhoneCadence>;

export const MacAppCadence = z.object({
  days_with_data: z.number().int().nonnegative(),
  apps: z.array(
    z.object({
      app: PatternSubject,
      activations: z.number().int().nonnegative(),
      days: z.number().int().nonnegative(),
      activations_per_day: z.number().nonnegative(),
      // Mac time in use divided by activations: "once every N minutes of Mac use" on average.
      minutes_of_mac_use_per_activation: z.number().nonnegative().nullable(),
      // Minutes of Mac use between leaving the app and bringing it back. Null under 5 gaps.
      median_gap_active_minutes: z.number().nonnegative().nullable(),
      checks_share: z.number().min(0).max(1),
      median_visit_seconds: z.number().nonnegative(),
      // Share of activations within 60 seconds after a Mac notification from the same app. Null
      // when the Mac logged no notification from this app at all.
      after_notification_share: z.number().min(0).max(1).nullable(),
    }),
  ),
});
export type MacAppCadence = z.infer<typeof MacAppCadence>;

export const Disruption = z.object({
  // calendar = inside a planned block that belongs to a goal; inferred = inside a focus stretch
  // found from the data itself.
  mode: z.enum(["calendar", "inferred"]),
  day: LocalDay,
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  device: PatternDevice,
  trigger: PatternSubject,
  // True when a notification opened it (iPhone: the open reason; Mac: a notification from the same
  // app in the 60 seconds before). Null when unknown.
  opened_by_notification: z.boolean().nullable(),
  // The work app that was in front before, when there was one.
  left: PatternSubject.nullable(),
  // Time in off purpose apps and sites during this disruption.
  minutes_lost: z.number().nonnegative(),
  // From the moment the distractor came up until `left` is in front again. Null when that did
  // not happen in the same stretch or block.
  minutes_until_back: z.number().nonnegative().nullable(),
  // True when the user did not return to work within the limit: the distractor ended the stretch.
  ended_stretch: z.boolean(),
  block_event_id: z.string().nullable(),
  goal_id: z.string().nullable(),
  event_ids: z.array(z.string()).max(5),
});
export type Disruption = z.infer<typeof Disruption>;

export const FocusDisruptions = z.object({
  mode: z.enum(["calendar", "inferred", "mixed"]),
  days_with_data: z.number().int().nonnegative(),
  // Share of screen time in apps and sites with no category. They can be neither work nor a
  // distraction, so the higher this is, the more focus goes unseen.
  uncategorised_share: z.number().min(0).max(1),
  blocks: z.number().int().nonnegative(),
  stretches: z.number().int().nonnegative(),
  focus_minutes: z.number().nonnegative(),
  disruptions: z.number().int().nonnegative(),
  disruptions_per_day: z.number().nonnegative(),
  minutes_lost: z.number().nonnegative(),
  minutes_lost_per_day: z.number().nonnegative(),
  longest_uninterrupted_minutes: z.number().nonnegative(),
  median_daily_longest_uninterrupted_minutes: z.number().nonnegative(),
  daily: z.array(
    z.object({
      day: LocalDay,
      complete: z.boolean(),
      focus_minutes: z.number().nonnegative(),
      stretches: z.number().int().nonnegative(),
      disruptions: z.number().int().nonnegative(),
      // Of `disruptions`, the ones that ended a stretch.
      ended_stretches: z.number().int().nonnegative(),
      minutes_lost: z.number().nonnegative(),
      longest_uninterrupted_minutes: z.number().nonnegative(),
    }),
  ),
  // The most recent disruptions, newest first, capped at 100.
  items: z.array(Disruption).max(100),
});
export type FocusDisruptions = z.infer<typeof FocusDisruptions>;

export const RecoveryCost = z.object({
  // Disruptions after which the user got back to the app they left.
  measured: z.number().int().nonnegative(),
  not_returned: z.number().int().nonnegative(),
  median_minutes_lost: z.number().nonnegative(),
  median_minutes_until_back: z.number().nonnegative(),
  // median_minutes_until_back / median_minutes_lost; null when the divisor is 0.
  multiplier: z.number().nonnegative().nullable(),
  // Union of the away spans, so nested disruptions are not counted twice.
  total_minutes_until_back: z.number().nonnegative(),
  minutes_until_back_per_day: z.number().nonnegative(),
  daily: z.array(
    z.object({
      day: LocalDay,
      measured: z.number().int().nonnegative(),
      total_minutes_until_back: z.number().nonnegative(),
      // Null under 3 measured disruptions that day.
      median_minutes_until_back: z.number().nonnegative().nullable(),
    }),
  ),
});
export type RecoveryCost = z.infer<typeof RecoveryCost>;

export const RepeatOffenders = z.object({
  days_with_focus: z.number().int().nonnegative(),
  offenders: z.array(
    z.object({
      subject: PatternSubject,
      devices: z.array(PatternDevice),
      disruptions: z.number().int().nonnegative(),
      minutes_lost: z.number().nonnegative(),
      days: z.number().int().nonnegative(),
      ended_stretches: z.number().int().nonnegative(),
    }),
  ),
});
export type RepeatOffenders = z.infer<typeof RepeatOffenders>;

export const Drift = z.object({
  minutes: z.number().nonnegative(),
  by_category: z.array(
    z.object({
      category: AppCategory,
      minutes: z.number().nonnegative(),
      visits: z.number().int().nonnegative(),
      days: z.number().int().nonnegative(),
    }),
  ),
  daily: z.array(z.object({ day: LocalDay, minutes: z.number().nonnegative() })),
  // Largest first, capped at 50. `search_event_id` points at the search that came just before;
  // the term itself is never copied into the report.
  items: z.array(
    z.object({
      day: LocalDay,
      start_at: IsoDateTime,
      site: PatternSubject,
      minutes: z.number().nonnegative(),
      during: z.enum(["focus_stretch", "work_block"]),
      search_event_id: z.string().nullable(),
      event_id: z.string(),
    }),
  ),
});
export type Drift = z.infer<typeof Drift>;

export const LateScreens = z.object({
  // Local wall time, "HH:MM".
  cutoff: z.string(),
  cutoff_source: z.enum(["default", "usual_bedtime"]),
  usual_bedtime: z.string().nullable(),
  nights_observed: z.number().int().nonnegative(),
  // Nights with at least 5 minutes of use after the cut off.
  late_nights: z.number().int().nonnegative(),
  median_late_minutes: z.number().nonnegative().nullable(),
  nights: z.array(
    z.object({
      // The local day the evening belongs to.
      night: LocalDay,
      minutes: z.number().nonnegative(),
      mac_minutes: z.number().nonnegative(),
      iphone_minutes: z.number().nonnegative(),
      top: PatternSubject.nullable(),
      top_minutes: z.number().nonnegative(),
      last_seen_at: IsoDateTime.nullable(),
      next_recovery_pct: z.number().nullable(),
      next_sleep_minutes: z.number().nullable(),
    }),
  ),
  // Average next morning recovery after late nights against the other nights. Null under 3 of each.
  recovery_comparison: z
    .object({
      late_nights: z.number().int().nonnegative(),
      late_avg_recovery_pct: z.number(),
      other_nights: z.number().int().nonnegative(),
      other_avg_recovery_pct: z.number(),
    })
    .nullable(),
});
export type LateScreens = z.infer<typeof LateScreens>;

export const ContextSwitching = z.object({
  days_with_data: z.number().int().nonnegative(),
  active_minutes: z.number().nonnegative(),
  switches: z.number().int().nonnegative(),
  switches_per_active_hour: z.number().nonnegative(),
  // Share of active time spent in stays shorter than 2 minutes.
  fragment_share: z.number().min(0).max(1),
  median_stay_seconds: z.number().nonnegative(),
  daily: z.array(
    z.object({
      day: LocalDay,
      complete: z.boolean(),
      active_minutes: z.number().nonnegative(),
      switches: z.number().int().nonnegative(),
      // Null under 30 active minutes that day.
      switches_per_active_hour: z.number().nonnegative().nullable(),
      fragment_share: z.number().min(0).max(1).nullable(),
    }),
  ),
});
export type ContextSwitching = z.infer<typeof ContextSwitching>;

export const TimeSlice = z.object({
  subject: PatternSubject,
  device: PatternDevice,
  seconds: z.number().int().nonnegative(),
});
export type TimeSlice = z.infer<typeof TimeSlice>;

export const CategoryTime = z.object({ category: AppCategory, seconds: z.number().int().nonnegative() });
export type CategoryTime = z.infer<typeof CategoryTime>;

// The simple totals every other number is checked against. Seconds are exact: per day,
// active_seconds = mac_seconds + iphone_seconds = sum(by_category) = sum(apps) + other_apps_seconds.
export const TimeTotals = z.object({
  active_seconds: z.number().int().nonnegative(),
  // Time counted once per person, not once per device: when the phone and the Mac overlap the
  // phone wins and the Mac time under it is reported here, not in mac_seconds.
  mac_seconds: z.number().int().nonnegative(),
  iphone_seconds: z.number().int().nonnegative(),
  overlap_seconds: z.number().int().nonnegative(),
  by_category: z.array(CategoryTime),
  apps: z.array(TimeSlice),
  other_apps_seconds: z.number().int().nonnegative(),
});
export type TimeTotals = z.infer<typeof TimeTotals>;

export const TimeByApp = z.object({
  days_with_data: z.number().int().nonnegative(),
  active_minutes_per_day: z.number().nonnegative(),
  totals: TimeTotals,
  daily: z.array(TimeTotals.extend({ day: LocalDay, complete: z.boolean() })),
});
export type TimeByApp = z.infer<typeof TimeByApp>;

export const AiToolUse = z.object({
  days_with_data: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  sessions_per_day: z.number().nonnegative(),
  // Sum of session lengths. Sessions that run side by side are counted once each.
  session_minutes: z.number().nonnegative(),
  // Time with at least one session open (overlaps counted once).
  wall_minutes: z.number().nonnegative(),
  waiting_minutes: z.number().nonnegative().nullable(),
  // waiting / session time, over sessions that report waiting. Null when none does.
  waiting_share: z.number().min(0).max(1).nullable(),
  by_tool: z.array(
    z.object({
      tool: z.string(),
      sessions: z.number().int().nonnegative(),
      session_minutes: z.number().nonnegative(),
      waiting_share: z.number().min(0).max(1).nullable(),
    }),
  ),
  daily: z.array(
    z.object({
      day: LocalDay,
      sessions: z.number().int().nonnegative(),
      session_minutes: z.number().nonnegative(),
      wall_minutes: z.number().nonnegative(),
    }),
  ),
});
export type AiToolUse = z.infer<typeof AiToolUse>;

export const PatternsQuery = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
});
export type PatternsQuery = z.infer<typeof PatternsQuery>;

export const PatternReport = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
  timezone: z.string(),
  generated_at: IsoDateTime,
  // Local days touched by the range. `complete` is false when the range cuts the day short.
  days: z.array(z.object({ day: LocalDay, complete: z.boolean() })),
  // How many events of each kind the report was built from.
  inputs: z.object({
    mac_app_usage: z.number().int().nonnegative(),
    iphone_app_usage: z.number().int().nonnegative(),
    web_visits: z.number().int().nonnegative(),
    // History visits left out because the extension covered the same window.
    web_visits_superseded: z.number().int().nonnegative(),
    // History visits left out because Chrome did not measure their time in front.
    web_visits_unmeasured: z.number().int().nonnegative(),
    searches: z.number().int().nonnegative(),
    goal_blocks: z.number().int().nonnegative(),
    sleeps: z.number().int().nonnegative(),
    ai_sessions: z.number().int().nonnegative(),
  }),
  // The summaries of every detector that had enough data, most important first. This is what the
  // analysis prompt gets instead of raw events.
  headlines: z.array(z.string()),
  phone_cadence: patternDetector(PhoneCadence),
  mac_app_cadence: patternDetector(MacAppCadence),
  focus_disruptions: patternDetector(FocusDisruptions),
  recovery_cost: patternDetector(RecoveryCost),
  repeat_offenders: patternDetector(RepeatOffenders),
  drift: patternDetector(Drift),
  late_screens: patternDetector(LateScreens),
  context_switching: patternDetector(ContextSwitching),
  time_by_app: patternDetector(TimeByApp),
  ai_tool_use: patternDetector(AiToolUse),
});
export type PatternReport = z.infer<typeof PatternReport>;

// ---------- score (GET /v1/score) ----------

// The rule lives in apps/api/src/score/score.ts and docs/api.md ("Score"). All minutes are whole
// minutes, rounded per block and then added up, so every total is the sum of its parts:
// spent = elapsed - lost, ahead = planned - elapsed, unverified = spent - verified.

export const ScoreQuery = z.object({
  date: LocalDay.optional(),
  now: IsoDateTime.optional(),
});
export type ScoreQuery = z.infer<typeof ScoreQuery>;

// One tick is 5 minutes of a planned block. `unverified` is spent time the data cannot prove
// (no device data and no workout): it counts as spent, and is never shown as proven.
export const ScoreTick = z.enum(["spent", "lost", "ahead", "unverified"]);
export type ScoreTick = z.infer<typeof ScoreTick>;

const Minutes = z.number().int().nonnegative();
// Null when nothing has elapsed yet: there is no score before the first block, not 0 and not 100.
const ScorePct = z.number().min(0).max(100).nullable();

// The same seven numbers at every level: a block, a day, a goal's week, the week.
const scoreTotals = {
  planned_minutes: Minutes,
  elapsed_minutes: Minutes,
  spent_minutes: Minutes,
  lost_minutes: Minutes,
  ahead_minutes: Minutes,
  // The part of spent_minutes the data does not positively show.
  unverified_minutes: Minutes,
  score_pct: ScorePct,
};

// A stretch of lost time inside a block and what took it. `what` is an app name, a well known
// public site, or a site category ("a travel site"): never a full address.
export const ScoreLostStretch = z.object({
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  // Time in distracting apps and sites inside the stretch, one decimal.
  minutes: z.number().nonnegative(),
  what: z.string(),
  kind: z.enum(["app", "site"]),
  category: AppCategory,
  device: PatternDevice,
});
export type ScoreLostStretch = z.infer<typeof ScoreLostStretch>;

export const ScoreBlock = z.object({
  // The calendar event. A block that crosses local midnight appears once on each day.
  event_id: z.string(),
  goal_id: z.uuid(),
  goal_title: z.string(),
  // The calendar event's own title ("Cold Outreach / Sales").
  title: z.string(),
  // Which rule tied the event to the goal.
  matched_by: z.enum(["goal_id", "calendar_titles", "goal_category", "goal_title", "category_word"]),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  ...scoreTotals,
  // One per 5 minutes from start_at; the last one is shorter when the block is not a multiple of 5.
  ticks: z.array(ScoreTick),
  lost: z.array(ScoreLostStretch),
});
export type ScoreBlock = z.infer<typeof ScoreBlock>;

export const ScoreDay = z.object({
  date: LocalDay,
  ...scoreTotals,
  time_won_back_minutes: Minutes,
});
export type ScoreDay = z.infer<typeof ScoreDay>;

// How "time won back" was worked out for the day, so the maths can be shown.
export const TimeWonBack = z.object({
  minutes: Minutes,
  // Lost / elapsed over the goal blocks of the previous 28 days, 0..1. Null without enough history.
  usual_loss_rate: z.number().min(0).max(1).nullable(),
  // Days with goal blocks among the previous 28.
  history_days: z.number().int().nonnegative(),
  // Set when the value is 0 because there is not enough history to know the usual day.
  reason: z.string().nullable(),
});
export type TimeWonBack = z.infer<typeof TimeWonBack>;

export const ScoreDayDetail = ScoreDay.extend({
  // The instant the day was scored at: the boundary between past and ahead on the tape.
  now: IsoDateTime,
  time_won_back: TimeWonBack,
  blocks: z.array(ScoreBlock),
});
export type ScoreDayDetail = z.infer<typeof ScoreDayDetail>;

export const ScoreGoal = GoalScore.extend({
  title: z.string(),
  category: GoalCategory,
  // False for sleep (a rest goal whose target describes sleep): listed with its budget for the
  // Goals screen, outside the score. Its planned and spent minutes are 0 and mean nothing.
  scored: z.boolean(),
  elapsed_minutes: Minutes,
  lost_minutes: Minutes,
  ahead_minutes: Minutes,
  unverified_minutes: Minutes,
  score_pct: ScorePct,
  // Monday to Sunday.
  daily: z.array(z.object({ date: LocalDay, planned_minutes: Minutes, spent_minutes: Minutes })),
});
export type ScoreGoal = z.infer<typeof ScoreGoal>;

// GET /v1/score. The week has the WeeklyScore fields (score_pct may be null here), then the day.
export const Score = WeeklyScore.extend({
  score_pct: ScorePct,
  goals: z.array(ScoreGoal),
  timezone: z.string(),
  generated_at: IsoDateTime,
  // The local day asked for.
  date: LocalDay,
  elapsed_minutes: Minutes,
  lost_minutes: Minutes,
  ahead_minutes: Minutes,
  unverified_minutes: Minutes,
  // Monday to Sunday of the week that holds `date`.
  days: z.array(ScoreDay),
  day: ScoreDayDetail,
  // The last instant each device reported anything, up to the end of the week (null: nothing).
  // Lost time after that instant is not known yet: phone data can arrive hours late.
  data_until: z.object({ mac: IsoDateTime.nullable(), iphone: IsoDateTime.nullable() }),
});
export type Score = z.infer<typeof Score>;

// ---------- chat (POST /v1/chat, GET /v1/chat) ----------
// Typed chat with Michael. The API keeps the history per user; the client sends only the new line.

export const ChatRole = z.enum(["user", "assistant"]);
export type ChatRole = z.infer<typeof ChatRole>;

export const ChatMessage = z.object({
  id: z.uuid(),
  role: ChatRole,
  content: z.string().min(1),
  created_at: IsoDateTime,
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatRequest = z.object({
  message: z.string().trim().min(1).max(2000),
});
export type ChatRequest = z.input<typeof ChatRequest>;

export const ChatResponse = z.object({
  // The user's line as stored, then Michael's answer.
  message: ChatMessage,
  reply: ChatMessage,
});
export type ChatResponse = z.infer<typeof ChatResponse>;

export const ChatHistory = z.object({
  // Oldest first.
  messages: z.array(ChatMessage),
});
export type ChatHistory = z.infer<typeof ChatHistory>;

// ---------- errors ----------

export const ErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "not_found",
  "forbidden",
  "conflict",
  "upstream_error",
  "not_implemented",
  // A dependency is not configured (for example no model key): try again once it is set up.
  "unavailable",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Health = z.object({
  status: z.literal("ok"),
  version: z.string(),
  time: IsoDateTime,
  storage: z.enum(["memory", "supabase"]),
  // Git commit of the running deploy (Railway sets RAILWAY_GIT_COMMIT_SHA); null locally.
  commit: z.string().nullable(),
});
export type Health = z.infer<typeof Health>;
