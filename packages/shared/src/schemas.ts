import { z } from "zod";

// ---------- primitives ----------

export const IsoDateTime = z.iso.datetime({ offset: true });
// "YYYY-MM-DD", a day in the user's timezone.
export const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
  // Travel times from Google Maps, computed by the API between the user's places (opt in).
  "maps",
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
  // A planned trip between two places, with traffic (source maps). Payload in docs/api.md.
  "travel",
]);
export type EventType = z.infer<typeof EventType>;

// Goals sit in three categories: business, health, personal. The four older values are still
// accepted and readable until every client has moved: `work` means business; `gym`, `rest` and
// `food` mean health. Group and reason with `goalArea`, never with the raw value.
export const GoalCategory = z.enum(["business", "health", "personal", "work", "gym", "rest", "food"]);
export type GoalCategory = z.infer<typeof GoalCategory>;

export const GoalArea = z.enum(["business", "health", "personal"]);
export type GoalArea = z.infer<typeof GoalArea>;

const GOAL_AREA: Record<GoalCategory, GoalArea> = {
  business: "business",
  health: "health",
  personal: "personal",
  work: "business",
  gym: "health",
  rest: "health",
  food: "health",
};

/** The one of the three categories a goal category belongs to, for any of the seven values. */
export const goalArea = (category: GoalCategory): GoalArea => GOAL_AREA[category];

// What a goal measures. `time`: weekly minutes in planned blocks (the default). `target`: a value
// per day (sleep 7.5 hours, screens off at 23:00). `count`: times a week. `checklist`: the day's
// one to three business outcomes. Only `time` goals take part in the time score.
export const GoalKind = z.enum(["time", "target", "count", "checklist"]);
export type GoalKind = z.infer<typeof GoalKind>;

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
  // Free form record. The keys the API understands are in `GoalTarget` below: kind, label,
  // calendar_titles, work_categories and the values of a target or count goal.
  target: z.record(z.string(), z.unknown()).nullable(),
  // Weekly time budget, e.g. "70.3 training: 9 hours this week" = 540.
  weekly_budget_minutes: z.number().int().nonnegative().nullable(),
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type Goal = z.infer<typeof Goal>;

// "HH:MM", 24 hour, local wall clock (Europe/Athens). Also used by the profile below.
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
export type ClockTime = z.infer<typeof ClockTime>;

// The keys of `goal.target` the API understands. The record stays free form: unknown keys are kept
// as they are, known keys must have the right type. Checked on create and update; goals already
// stored are read leniently (`goalKind`, and the readers in apps/api, skip what they cannot use).
export const GoalTarget = z.looseObject({
  kind: GoalKind.optional(),
  // A free label for a personal goal: "fun", "family", "hobby".
  label: z.string().min(1).max(40).optional(),
  // Calendar event titles that count towards the goal (docs/api.md, Goals).
  calendar_titles: z.array(z.string().min(1)).optional(),
  // Attention categories that count as this goal's work inside its blocks, for example
  // ["communication"] on a sales goal: there they are spent and verified, not lost.
  work_categories: z.array(AppCategory).optional(),
  // kind `target`: a value per day.
  sleep_hours: z.number().positive().max(24).optional(),
  screens_off: ClockTime.optional(),
  // kind `count`: times a week.
  per_week: z.number().int().positive().optional(),
});
export type GoalTarget = z.infer<typeof GoalTarget>;

type GoalLike = { category?: GoalCategory; title?: string; target?: Record<string, unknown> | null };

/** A target with a sleep or bed key, or the word in the title. */
const describesSleep = (goal: GoalLike) =>
  Object.keys(goal.target ?? {}).some((k) => /sleep|bed/i.test(k)) || /\bsleep\b/i.test(goal.title ?? "");

/**
 * What a goal measures: `target.kind` when it holds one of the kinds, otherwise `time`. One
 * fallback for goals saved before kinds existed: a `rest` goal that describes sleep is a target.
 */
export function goalKind(goal: GoalLike): GoalKind {
  const kind = GoalKind.safeParse(goal.target?.kind);
  if (kind.success) return kind.data;
  if (goal.category === "rest" && describesSleep(goal)) return "target";
  return "time";
}

/** A health goal of kind `target` that describes sleep. Sleep is measured by nights, not blocks. */
export const isSleepGoal = (goal: GoalLike & { category: GoalCategory }): boolean =>
  goalArea(goal.category) === "health" && goalKind(goal) === "target" && describesSleep(goal);

export const GoalCreate = z.object({
  category: GoalCategory,
  title: z.string().min(1),
  description: z.string().nullish(),
  target: GoalTarget.nullish(),
  weekly_budget_minutes: z.number().int().nonnegative().nullish(),
  active: z.boolean().default(true),
});
export type GoalCreate = z.input<typeof GoalCreate>;

export const GoalUpdate = GoalCreate.partial();
export type GoalUpdate = z.input<typeof GoalUpdate>;

// ---------- standing instructions ----------
// Not goals: the user's ground rules ("keep Sundays clear", "home every day by 21:00"). Given at
// setup, changed any time. Michael never plans into the time they protect.

// clear_day: nothing planned on `days`. home_by: nothing planned after `time` (on `days`, or every
// day). quiet_hours: nothing between `time` and `end_time`. custom: text for the coach only.
export const InstructionKind = z.enum(["clear_day", "home_by", "quiet_hours", "custom"]);
export type InstructionKind = z.infer<typeof InstructionKind>;

// 0 = Sunday .. 6 = Saturday, as in JavaScript's getDay().
const Weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);

export const Instruction = z.object({
  id: z.uuid(),
  // The user's own words, kept exactly as written.
  text: z.string().min(1),
  kind: InstructionKind,
  days: Weekdays.optional(),
  time: ClockTime.optional(),
  end_time: ClockTime.optional(),
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type Instruction = z.infer<typeof Instruction>;

const instructionText = z
  .string()
  .max(500)
  .refine((t) => t.trim().length > 0, "Text must not be blank");

/** What a kind needs before it can protect any time, or null when the shape is complete. */
export function instructionShapeError(i: {
  kind: InstructionKind;
  days?: number[] | null;
  time?: string | null;
  end_time?: string | null;
}): string | null {
  if (i.kind === "clear_day" && !i.days?.length) return "clear_day needs `days`";
  if (i.kind === "home_by" && !i.time) return "home_by needs `time`";
  if (i.kind === "quiet_hours" && !(i.time && i.end_time)) return "quiet_hours needs `time` and `end_time`";
  return null;
}

export const InstructionCreate = z
  .object({
    text: instructionText,
    kind: InstructionKind.default("custom"),
    days: Weekdays.nullish(),
    time: ClockTime.nullish(),
    end_time: ClockTime.nullish(),
    active: z.boolean().default(true),
  })
  .superRefine((i, ctx) => {
    const message = instructionShapeError(i);
    if (message) ctx.addIssue({ code: "custom", message });
  });
export type InstructionCreate = z.input<typeof InstructionCreate>;

// Every field optional; null clears `days`, `time` or `end_time`. The API checks the shape of the
// result (the stored instruction with the change applied), not of the change alone.
export const InstructionUpdate = z.object({
  text: instructionText.optional(),
  kind: InstructionKind.optional(),
  days: Weekdays.nullish(),
  time: ClockTime.nullish(),
  end_time: ClockTime.nullish(),
  active: z.boolean().optional(),
});
export type InstructionUpdate = z.input<typeof InstructionUpdate>;

// ---------- recommendations ----------

// Payloads of the actions POST /v1/recommendations/:id/execute can carry out.
// move_calendar_block: one of the user's own solo blocks (a timeline event id). Give a new start
// (the length is kept unless `end_at` is given), a new title, or both.
export const MoveCalendarBlockPayload = z
  .object({
    event_id: z.uuid(),
    start_at: IsoDateTime.optional(),
    end_at: IsoDateTime.optional(),
    new_title: z.string().min(1).max(200).optional(),
  })
  .refine((p) => p.start_at || p.end_at || p.new_title, { message: "Give start_at, end_at or new_title" });
export type MoveCalendarBlockPayload = z.infer<typeof MoveCalendarBlockPayload>;

// create_focus_block: a new block on the user's calendar, tagged as Michael's.
export const CreateFocusBlockPayload = z
  .object({
    start_at: IsoDateTime,
    end_at: IsoDateTime,
    title: z.string().min(1).max(200).optional(),
  })
  .refine((p) => Date.parse(p.end_at) > Date.parse(p.start_at), { message: "end_at must be after start_at" });
export type CreateFocusBlockPayload = z.infer<typeof CreateFocusBlockPayload>;

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

// Where a recommendation came from: the analysis run, or the user asking in chat (or by voice), in
// which case Michael carried it out straight away.
export const RecommendationSource = z.enum(["analysis", "chat"]);
export type RecommendationSource = z.infer<typeof RecommendationSource>;

export const Recommendation = z.object({
  id: z.uuid(),
  analysis_run_id: z.uuid().nullable(),
  goal_id: z.uuid().nullable(),
  title: z.string().min(1),
  rationale: z.string(),
  action: RecommendationAction.nullable(),
  // What supports this recommendation, so the app can show the proof next to the claim: names of
  // patterns (keys of PatternReport, e.g. "phone_cadence"), "plan" (the goals and their blocks) or
  // "score". Absent on older rows.
  evidence: z.array(z.string()).optional(),
  status: RecommendationStatus,
  executed_at: IsoDateTime.nullable(),
  undone_at: IsoDateTime.nullable(),
  // Absent on older rows: read as "analysis".
  source: RecommendationSource.optional(),
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
  // Michael's short brief for the moment (at most four lines).
  summary: z.string().nullable(),
  // One short question about a missing fact that would change the advice. Usually null.
  question: z.string().nullable().optional(),
  error: z.string().nullable(),
  started_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
});
export type AnalysisRun = z.infer<typeof AnalysisRun>;

export const AnalysisTriggerInput = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  // Which moment this run is for. Default: manual.
  trigger: AnalysisTrigger.optional(),
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

// ---------- profile: the onboarding answers (GET/PUT /v1/profile) ----------

// `ClockTime` ("HH:MM", 24 hour, Europe/Athens wall clock) is defined with the goals above.

export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof Weekday>;

// Where the user says their time leaks. Analysis and nudges can look for these first.
export const WeakSpot = z.enum([
  "phone_in_bed",
  "late_nights",
  "context_switching",
  "skipped_lunch",
  "doomscrolling",
  "back_to_back_meetings",
  "inbox_all_day",
  "late_caffeine",
]);
export type WeakSpot = z.infer<typeof WeakSpot>;

export const TimeWindow = z.object({ start: ClockTime, end: ClockTime });
export type TimeWindow = z.infer<typeof TimeWindow>;

export const Profile = z.object({
  // No nudges inside this window. May cross midnight (22:00 to 07:00 is the default).
  quiet_hours: TimeWindow,
  // The usual week: work hours on work days, and the days the user trains.
  work_hours: TimeWindow,
  work_days: z.array(Weekday),
  gym_days: z.array(Weekday),
  weak_spots: z.array(WeakSpot),
  // Set when onboarding is finished or skipped; null means Today should offer onboarding.
  onboarded_at: IsoDateTime.nullable(),
  // null until the user saves anything (the response is then the defaults).
  updated_at: IsoDateTime.nullable(),
});
export type Profile = z.infer<typeof Profile>;

// Partial: only the fields sent change. Arrays are replaced, not merged.
export const ProfileUpdate = Profile.omit({ updated_at: true }).partial();
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const DEFAULT_PROFILE: Profile = {
  quiet_hours: { start: "22:00", end: "07:00" },
  work_hours: { start: "09:00", end: "18:00" },
  work_days: ["mon", "tue", "wed", "thu", "fri"],
  gym_days: [],
  weak_spots: [],
  onboarded_at: null,
  updated_at: null,
};

// ---------- places and travel (GET/PUT /v1/places, POST /v1/travel/plan) ----------

// The user's saved places. `key` is a short slug ("home", "work", "gym", "university").
export const PlaceKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, "lower case letters, digits and underscores");
export type PlaceKey = z.infer<typeof PlaceKey>;

export const Place = z.object({
  key: PlaceKey,
  label: z.string().min(1).max(80),
  // What the user typed. Null when the place was set from coordinates only.
  address: z.string().nullable(),
  // Null until geocoded (no maps key yet, or the address was not found).
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  updated_at: IsoDateTime,
});
export type Place = z.infer<typeof Place>;

export const PlaceInput = z
  .object({
    key: PlaceKey,
    label: z.string().min(1).max(80).optional(),
    address: z.string().min(1).max(300).nullish(),
    lat: z.number().min(-90).max(90).nullish(),
    lng: z.number().min(-180).max(180).nullish(),
  })
  .refine((p) => p.address || (typeof p.lat === "number" && typeof p.lng === "number"), {
    message: "Give an address, or both lat and lng",
  });
export type PlaceInput = z.input<typeof PlaceInput>;

// PUT replaces the whole list. Saving places is the user's opt in to travel times (source maps).
export const PlacesUpdate = z.object({ places: z.array(PlaceInput).max(20) });
export type PlacesUpdate = z.input<typeof PlacesUpdate>;

export const PlacesResponse = z.object({
  places: z.array(Place),
  // True when the server has a maps key; without it places are kept but nothing is computed.
  maps_available: z.boolean(),
  // The user's switch for source maps (privacy). Travel is computed only when true.
  travel_enabled: z.boolean(),
});
export type PlacesResponse = z.infer<typeof PlacesResponse>;

// One sampled departure for a trip.
export const TravelOption = z.object({
  depart_at: IsoDateTime,
  arrive_at: IsoDateTime,
  minutes: z.number().int().nonnegative(),
});
export type TravelOption = z.infer<typeof TravelOption>;

// `data` of an event with source maps and type travel.
export const TravelData = z.object({
  calendar_event_id: z.string(),
  from: z.object({ label: z.string(), place_key: PlaceKey.nullable() }),
  to: z.object({ label: z.string(), place_key: PlaceKey.nullable() }),
  mode: z.literal("drive"),
  // The planned trip (the event's start and end).
  minutes: z.number().int().nonnegative(),
  // The same trip with empty roads; minutes minus this is time lost to traffic.
  free_flow_minutes: z.number().int().nonnegative(),
  distance_km: z.number().nonnegative(),
  // Leaving as soon as the user is free, and what that would cost.
  naive_depart_at: IsoDateTime,
  naive_minutes: z.number().int().nonnegative(),
  won_minutes: z.number().int().nonnegative(),
  options: z.array(TravelOption),
});
export type TravelData = z.infer<typeof TravelData>;

export const TravelPlanInput = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
});
export type TravelPlanInput = z.infer<typeof TravelPlanInput>;

export const TravelPlanStatus = z.enum(["ok", "maps_unavailable", "travel_off"]);
export type TravelPlanStatus = z.infer<typeof TravelPlanStatus>;

export const TravelPlanResult = z.object({
  status: TravelPlanStatus,
  from: IsoDateTime,
  to: IsoDateTime,
  travel: z.array(Event),
  recommendations: z.array(Recommendation),
  // Calendar events with a location that got no trip, and why.
  skipped: z.array(z.object({ calendar_event_id: z.string(), reason: z.string() })),
});
export type TravelPlanResult = z.infer<typeof TravelPlanResult>;

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

// `test`: sent by POST /v1/nudges/test (the stage moment). Stored so screens can show it, but it
// never counts towards the cap, the gap between nudges or the daily dedupe.
export const NudgeStatus = z.enum(["queued", "sent", "failed", "suppressed", "test"]);
export type NudgeStatus = z.infer<typeof NudgeStatus>;

/** Whether a nudge counts towards the 5 a day (and the 20 minute gap). */
export const countsTowardsCap = (status: NudgeStatus) => status !== "suppressed" && status !== "test";

// What a nudge is about. Each kind is one rule of the engine (apps/api/src/nudges).
// morning and evening carry the Morning and Evening moments (GET /v1/moments/:kind), once each a day.
export const NudgeKind = z.enum([
  "focus_drift",
  "block_soon",
  "wind_down",
  "goal_behind",
  "morning",
  "evening",
]);
export type NudgeKind = z.infer<typeof NudgeKind>;

// At most 5 per day, under 15 words, never during quiet hours, each tied to a goal.
export const Nudge = z.object({
  id: z.uuid(),
  recommendation_id: z.uuid().nullable(),
  goal_id: z.uuid().nullable(),
  kind: NudgeKind,
  // Dedupe key: the same key never nudges twice on one local day.
  key: z.string(),
  // Local day (user's timezone) the nudge belongs to.
  day: LocalDay,
  channel: NudgeChannel,
  text: z.string().min(1),
  // The maths behind it, one line, e.g. "3h 10m of 9h done; the pace by now is 5h 20m."
  reason: z.string(),
  status: NudgeStatus,
  created_at: IsoDateTime,
  sent_at: IsoDateTime.nullable(),
});
export type Nudge = z.infer<typeof Nudge>;

export const NudgesQuery = z.object({ from: IsoDateTime.optional(), to: IsoDateTime.optional() });
export type NudgesQuery = z.infer<typeof NudgesQuery>;

export const NudgesResponse = z.object({ nudges: z.array(Nudge) });
export type NudgesResponse = z.infer<typeof NudgesResponse>;

// Why the engine stayed silent (or suppressed) on a check.
export const NudgeSkip = z.enum(["nothing_to_say", "quiet_hours", "daily_cap", "too_soon", "off_the_record"]);
export type NudgeSkip = z.infer<typeof NudgeSkip>;

// POST /v1/nudges/check: runs the engine once for the caller.
export const NudgeCheckResult = z.object({
  checked_at: IsoDateTime,
  // The nudge created by this check (sent, queued or suppressed), or null.
  nudge: Nudge.nullable(),
  // Set when no nudge went out.
  skipped: NudgeSkip.nullable(),
  // Nudges today that count towards the cap of 5 (everything but suppressed and test).
  sent_today: z.number().int().nonnegative(),
});
export type NudgeCheckResult = z.infer<typeof NudgeCheckResult>;

// POST /v1/nudges/test: one nudge now, for the stage moment. Stored with status `test` (so
// GET /v1/nudges shows it), ignores the cap and never counts towards it.
export const NudgeTestResult = z.object({
  text: z.string().min(1),
  reason: z.string(),
  // Devices that accepted it (push devices plus the Telegram chat, when bound). 0 when nothing
  // is configured or connected.
  delivered: z.number().int().nonnegative(),
  devices: z.number().int().nonnegative(),
  // The stored nudge (status `test`).
  nudge: Nudge,
});
export type NudgeTestResult = z.infer<typeof NudgeTestResult>;

// ---------- web push (iPhone, Apple Watch mirror, desktop browsers) ----------

// What the browser's PushSubscription.toJSON() gives. Only https push services are accepted.
export const PushSubscriptionInput = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(128) }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;

export const PushUnsubscribe = z.object({ endpoint: z.url().max(2048) });
export type PushUnsubscribe = z.infer<typeof PushUnsubscribe>;

// GET /v1/push: what the app needs to subscribe, and whether this user has a device on.
export const PushConfig = z.object({
  // False until the API has VAPID keys.
  enabled: z.boolean(),
  // VAPID public key (base64url) for pushManager.subscribe, null when not enabled.
  public_key: z.string().nullable(),
  devices: z.number().int().nonnegative(),
});
export type PushConfig = z.infer<typeof PushConfig>;

// ---------- telegram (a backup channel for nudges) ----------

// GET /v1/telegram and DELETE /v1/telegram: whether the bot is set up and this user's chat is bound.
export const TelegramStatus = z.object({
  // False until the API has a bot token: the button explains it is not set up yet.
  enabled: z.boolean(),
  connected: z.boolean(),
  // The Telegram @username of the bound chat, when it has one.
  username: z.string().nullable(),
  connected_at: IsoDateTime.nullable(),
});
export type TelegramStatus = z.infer<typeof TelegramStatus>;

// POST /v1/telegram/link: https://t.me/<bot>?start=<one-time token>, opened by the browser.
export const TelegramLinkResponse = z.object({ url: z.url() });
export type TelegramLinkResponse = z.infer<typeof TelegramLinkResponse>;

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

// `AppCategory`, the shared vocabulary for apps and sites, is defined with the enums above.

export const PatternDevice = z.enum(["mac", "iphone"]);
export type PatternDevice = z.infer<typeof PatternDevice>;

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
  // Time inside the stretch that was off purpose for the block's goal, one decimal.
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
  // Ids of the active standing instructions this block's time falls under (a work block planned
  // on a clear Sunday). Empty when it breaks none. It never changes the block's minutes.
  instructions_broken: z.array(z.uuid()),
});
export type ScoreBlock = z.infer<typeof ScoreBlock>;

// The same totals for one of the three categories, so a strong business week with no personal
// time does not read as a win. Always three entries, in the order business, health, personal.
export const ScoreArea = z.object({
  area: GoalArea,
  // Every active goal in the category, scored or not.
  goal_ids: z.array(z.uuid()),
  ...scoreTotals,
});
export type ScoreArea = z.infer<typeof ScoreArea>;

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
  // The day per category. The three add up to the day.
  areas: z.array(ScoreArea),
});
export type ScoreDayDetail = z.infer<typeof ScoreDayDetail>;

export const ScoreGoal = GoalScore.extend({
  title: z.string(),
  category: GoalCategory,
  // The one of the three categories the goal belongs to, and what it measures.
  area: GoalArea,
  kind: GoalKind,
  // True only for goals of kind `time`. A `target`, `count` or `checklist` goal (sleep is a
  // target) is listed with its budget for the Goals screen, outside the score: its planned and
  // spent minutes are 0 and mean nothing.
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
  // The week per category. The three add up to the week.
  areas: z.array(ScoreArea),
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
  // What Michael did on the user's own calendar while answering (source "chat"): status "done"
  // with `action.undo_until` as the undo deadline, or "undone" when the user asked to take one back.
  actions: z.array(Recommendation).default([]),
});
export type ChatResponse = z.infer<typeof ChatResponse>;

export const ChatHistory = z.object({
  // Oldest first.
  messages: z.array(ChatMessage),
});
export type ChatHistory = z.infer<typeof ChatHistory>;

// ---------- device keys (personal tokens for collectors and webhooks) ----------

// A revocable key that acts for one user. The secret ("mk_...") is shown once, at creation.
export const PersonalToken = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  prefix: z.string(), // first characters, so the user can tell keys apart
  created_at: IsoDateTime,
  last_used_at: IsoDateTime.nullable(),
});
export type PersonalToken = z.infer<typeof PersonalToken>;

export const PersonalTokenCreate = z.object({ name: z.string().min(1).max(60) });
export type PersonalTokenCreate = z.infer<typeof PersonalTokenCreate>;

export const PersonalTokenCreated = z.object({ token: PersonalToken, secret: z.string() });
export type PersonalTokenCreated = z.infer<typeof PersonalTokenCreated>;
// ---------- voice (POST /v1/voice/speak) ----------
// Michael's reply read aloud by ElevenLabs. Text in, audio/mpeg out; nothing is stored.

export const VoiceSpeakRequest = z.object({
  text: z.string().trim().min(1).max(1000),
});
export type VoiceSpeakRequest = z.input<typeof VoiceSpeakRequest>;

// ---------- your data: deletion and retention (DELETE /v1/me/data) ----------

// Full detail is kept this many days; older events become daily summaries (EventSummary).
export const RETENTION_DAYS = 90;

// DELETE /v1/me/data?source=&from=&to=. No parameters deletes everything, the account included.
// Any parameter narrows it to the timeline: events (and their summaries) of that source, in that range.
export const DataDeleteQuery = z
  .object({
    source: Source.optional(),
    from: IsoDateTime.optional(),
    to: IsoDateTime.optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), {
    message: "from must be before to",
    path: ["from"],
  });
export type DataDeleteQuery = z.infer<typeof DataDeleteQuery>;

export const DataDeleteResult = z.object({
  // "everything": every row of the account; "timeline": only the events the query matched.
  scope: z.enum(["everything", "timeline"]),
  // Rows really deleted, per table (tables with nothing to delete show 0).
  deleted: z.record(z.string(), z.number().int().nonnegative()),
  total: z.number().int().nonnegative(),
  // Google was told to forget Michael's calendar access.
  google_revoked: z.boolean(),
  // The sign in itself (Supabase Auth user) is gone too. Only for "everything".
  account_deleted: z.boolean(),
});
export type DataDeleteResult = z.infer<typeof DataDeleteResult>;

// What remains of events older than RETENTION_DAYS: one row per UTC day, source, type and category.
// No titles and no data, only counts and time.
export const EventSummary = z.object({
  day: LocalDay, // UTC day of the events' start
  source: Source,
  type: EventType,
  // App or site category when the event had one (AppCategory or the collector's site category), else "".
  category: z.string(),
  events: z.number().int().nonnegative(),
  seconds: z.number().int().nonnegative(),
});
export type EventSummary = z.infer<typeof EventSummary>;

// ---------- demo account ----------

// POST /v1/demo/reseed: what bringing the demo week up to now changed.
export const DemoSeedResult = z.object({
  // Athens local dates covered, oldest first; the last one is today.
  days: z.array(LocalDay),
  events: z.object({
    inserted: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
  }),
  goals_written: z.number().int().nonnegative(),
});
export type DemoSeedResult = z.infer<typeof DemoSeedResult>;

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

// ---------- moments (GET /v1/moments/:kind) ----------
// Morning: what today holds against each goal's weekly budget, the stretch most likely to be
// lost and one or two moves. Evening: what happened against the plan, time won back and lost,
// one lesson and tomorrow's first move. Every number is computed from the timeline; only
// `headline` may be phrased by a model, and it falls back to a template.

export const MomentKind = z.enum(["morning", "evening"]);
export type MomentKind = z.infer<typeof MomentKind>;

export const MomentGoal = z.object({
  goal_id: z.uuid(),
  title: z.string(),
  category: GoalCategory,
  // business | health | personal for any category (goalArea), and how the goal is measured.
  area: GoalArea.optional(),
  kind: GoalKind.optional(),
  // True for the sleep goal (isSleepGoal): screens hide it from time lines.
  sleep: z.boolean().optional(),
  budget_minutes: z.number().int().nonnegative().nullable(),
  // This week (Monday 00:00 local) until now.
  spent_week_minutes: z.number().int().nonnegative(),
  // Today: planned blocks (sleep: a seventh of the weekly budget), time held, time lost in them.
  planned_today_minutes: z.number().int().nonnegative(),
  spent_today_minutes: z.number().int().nonnegative(),
  lost_today_minutes: z.number().int().nonnegative(),
  // Planned from now to the end of the week.
  planned_ahead_minutes: z.number().int().nonnegative(),
  // Budget left after what is spent and what is planned; null without a budget.
  unplanned_minutes: z.number().int().nonnegative().nullable(),
});
export type MomentGoal = z.infer<typeof MomentGoal>;

export const MomentStretch = z.object({
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  title: z.string(),
  goal_id: z.uuid().nullable(),
  block_event_id: z.string().nullable(),
  // Average minutes lost in these hours on the history days, scaled to this stretch.
  expected_lost_minutes: z.number().int().nonnegative(),
  history_days: z.number().int().nonnegative(),
  // What usually takes the time in these hours (an app name or a site label).
  usual_trigger: z.string().nullable(),
});
export type MomentStretch = z.infer<typeof MomentStretch>;

export const MomentMove = z.object({
  title: z.string(),
  // The maths behind it, one or two sentences.
  rationale: z.string(),
  action_kind: ActionKind.nullable(),
  start_at: IsoDateTime.nullable(),
  end_at: IsoDateTime.nullable(),
  goal_id: z.uuid().nullable(),
});
export type MomentMove = z.infer<typeof MomentMove>;

export const Moment = z.object({
  kind: MomentKind,
  day: LocalDay,
  timezone: z.string(),
  generated_at: IsoDateTime,
  headline: z.string(),
  phrased_by: z.enum(["template", "model"]),
  goals: z.array(MomentGoal),
  totals: z.object({
    // Goal blocks today (rest excluded: sleep is not booked).
    planned_minutes: z.number().int().nonnegative(),
    spent_minutes: z.number().int().nonnegative(),
    // Lost today to interruptions in focus time (morning: so far).
    lost_minutes: z.number().int().nonnegative(),
    // Daily average lost on the history days: the line "won back" is measured against.
    baseline_lost_minutes: z.number().int().nonnegative().nullable(),
    won_back_minutes: z.number().int().nonnegative(),
  }),
  // Morning only (null in the evening).
  at_risk: MomentStretch.nullable(),
  // Morning: one or two moves. Evening: empty.
  suggestions: z.array(MomentMove).max(2),
  // Evening only.
  lesson: z.string().nullable(),
  first_move: MomentMove.nullable(),
});
export type Moment = z.infer<typeof Moment>;
