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
  connected_at: IsoDateTime.nullable(),
  last_sync_at: IsoDateTime.nullable(),
  error: z.string().nullable(),
});
export type Integration = z.infer<typeof Integration>;

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

// ---------- errors ----------

export const ErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "not_found",
  "forbidden",
  "conflict",
  "upstream_error",
  "not_implemented",
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
});
export type Health = z.infer<typeof Health>;
