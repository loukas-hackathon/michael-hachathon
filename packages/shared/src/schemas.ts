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
]);
export type EventType = z.infer<typeof EventType>;

export const GoalCategory = z.enum(["work", "gym", "rest", "food"]);
export type GoalCategory = z.infer<typeof GoalCategory>;

export const RecommendationStatus = z.enum(["proposed", "accepted", "dismissed", "done"]);
export type RecommendationStatus = z.infer<typeof RecommendationStatus>;

// Actions are modelled now but NOT executed in the MVP (advise-only).
export const ActionKind = z.enum([
  "move_calendar_block",
  "create_calendar_block",
  "draft_message",
  "reminder",
]);
export type ActionKind = z.infer<typeof ActionKind>;

export const AnalysisStatus = z.enum(["queued", "running", "succeeded", "failed"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

export const AnalysisTrigger = z.enum(["manual", "scheduled", "mcp"]);
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
  active: z.boolean().default(true),
});
export type GoalCreate = z.input<typeof GoalCreate>;

export const GoalUpdate = GoalCreate.partial();
export type GoalUpdate = z.input<typeof GoalUpdate>;

// ---------- recommendations ----------

export const RecommendationAction = z.object({
  kind: ActionKind,
  payload: z.record(z.string(), z.unknown()),
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

// ---------- errors ----------

export const ErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "not_found",
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
