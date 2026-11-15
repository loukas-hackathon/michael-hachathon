import { z } from "zod";
import { goalArea } from "./goal-areas";
import { VOICE_AUDIO_TYPES } from "./voice-limits";

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
  // Where the user was: place visits made by the API from the phone's position (opt in).
  "location",
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

// goalArea (goal-areas.ts, zod free) maps any of the seven values to one of the three.

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
  // Several of the user's own blocks moved together (the whole day planned around traffic): one
  // tap carries out every move, one Undo puts every block back.
  "move_calendar_blocks",
  "create_focus_block",
  "block_mac_app",
  "draft_follow_up",
  "reminder",
  // Proposed in chat (#188), applied only when the user accepts: goal budgets, and a set of moves
  // or new blocks on the user's own calendar. Payloads below.
  "change_goal",
  "plan_change",
  // Done time the user reports (#317): "I took a bath for 40 minutes". Stored as the user's own
  // manual entry; undo removes the entry. `settle_block`: a past goal block marked Did it or Didn't.
  "log_time",
  "settle_block",
  // The user removed one of Michael's blocks on the Timeline (#271). Undo puts it back.
  "remove_calendar_block",
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

// ---------- checklist items (#238) ----------
// The day's one to three outcomes of a goal of kind `checklist`, in the user's own words. Michael
// never ticks an item himself: the user does, or the evening check in (`settled_by: "check_in"`).
// The daily ritual (#318) writes them too: each outcome may name the goal it serves, of any kind
// and area (`linked_goal_id`), with a time estimate and the minutes logged in the evening.

// open -> done | partly | dropped (settled by the user or the check in); open -> moved (carried to
// the next day, where a new item continues it with `carried_from`). `partly` (#318) is the
// evening's "some of it": it counts as set, not done.
export const ChecklistStatus = z.enum(["open", "done", "partly", "dropped", "moved"]);
export type ChecklistStatus = z.infer<typeof ChecklistStatus>;

export const ChecklistSettledBy = z.enum(["user", "check_in"]);
export type ChecklistSettledBy = z.infer<typeof ChecklistSettledBy>;

/** At most this many open items per checklist goal and day. */
export const CHECKLIST_MAX_OPEN = 3;

const checklistText = z
  .string()
  .max(200)
  .refine((t) => t.trim().length > 0, "Text must not be blank");

export const ChecklistItem = z.object({
  id: z.uuid(),
  // A goal of kind `checklist`.
  goal_id: z.uuid(),
  // The local day, Europe/Athens.
  date: LocalDay,
  text: z.string().min(1).max(200),
  // 0..2: the slot among the day's open items of the goal.
  position: z
    .number()
    .int()
    .min(0)
    .max(CHECKLIST_MAX_OPEN - 1),
  status: ChecklistStatus,
  settled_at: IsoDateTime.nullable(),
  settled_by: ChecklistSettledBy.nullable(),
  // The item of the day before that this one continues (POST /v1/checklist/:id/carry).
  carried_from: z.uuid().nullable(),
  // The goal this outcome serves, any kind and area (#318). Null: just for the day.
  linked_goal_id: z.uuid().nullable().default(null),
  // The user's own guess at how long it takes, minutes (#318).
  estimate_minutes: z.number().int().positive().nullable().default(null),
  // Minutes the user logged against the linked goal in the evening (#318).
  logged_minutes: z.number().int().positive().nullable().default(null),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

// GET /v1/checklist?date=YYYY-MM-DD (default today in Europe/Athens)
export const ChecklistQuery = z.object({ date: LocalDay.optional() });
export type ChecklistQuery = z.infer<typeof ChecklistQuery>;

export const ChecklistResponse = z.object({
  date: LocalDay,
  // Every item of the day, any status, by goal and position.
  items: z.array(ChecklistItem),
  // Items still open on the day before: candidates to carry. Nothing else in this version.
  suggestions: z.array(ChecklistItem),
});
export type ChecklistResponse = z.infer<typeof ChecklistResponse>;

/** A time estimate or logged time on an outcome: 5 minutes to 12 hours. */
export const OutcomeMinutes = z.number().int().min(5).max(720);

export const ChecklistItemCreate = z.object({
  goal_id: z.uuid(),
  // Default today in Europe/Athens.
  date: LocalDay.optional(),
  text: checklistText,
  // #318: the goal the outcome serves (any kind) and the user's estimate.
  linked_goal_id: z.uuid().nullish(),
  estimate_minutes: OutcomeMinutes.nullish(),
});
export type ChecklistItemCreate = z.input<typeof ChecklistItemCreate>;

// `moved` is not set by hand: carry the item instead.
export const ChecklistItemUpdate = z
  .object({
    text: checklistText.optional(),
    status: ChecklistStatus.exclude(["moved"]).optional(),
  })
  .refine((u) => u.text !== undefined || u.status !== undefined, { message: "Send `text` or `status`" });
export type ChecklistItemUpdate = z.input<typeof ChecklistItemUpdate>;

// POST /v1/checklist/:id/carry: the old item (now `moved`) and the new one on the next day.
export const ChecklistCarryResponse = z.object({ moved: ChecklistItem, item: ChecklistItem });
export type ChecklistCarryResponse = z.infer<typeof ChecklistCarryResponse>;

// ---------- the daily ritual (#318) ----------
// Morning: "What do you want to get done today?" Up to three outcomes in the user's words, each
// optionally for a goal, with an optional estimate. Evening: "What did you get done?" Each outcome
// done, partly or not, unfinished ones carried to tomorrow in one tap, time logged for the goal,
// then one line with the maths. The outcomes are checklist items of one checklist goal (made
// silently as "Today's outcomes" when the user has none). Skipping is fine: "Not today".

export const RitualKind = z.enum(["morning", "evening"]);
export type RitualKind = z.infer<typeof RitualKind>;

// not_yet: too early (before waking, or before the evening window). due: show it now. done:
// saved. skipped: "Not today". `evening` is also not_yet on a day without outcomes.
export const RitualState = z.enum(["not_yet", "due", "done", "skipped"]);
export type RitualState = z.infer<typeof RitualState>;

export const RitualOutcomeInput = z.object({
  text: checklistText,
  goal_id: z.uuid().nullish(),
  estimate_minutes: OutcomeMinutes.nullish(),
});
export type RitualOutcomeInput = z.input<typeof RitualOutcomeInput>;

// POST /v1/ritual/morning. Outcomes already on today (carried ones) stay; the total stays at three.
export const RitualMorningInput = z.object({
  outcomes: z.array(RitualOutcomeInput).min(1).max(CHECKLIST_MAX_OPEN),
});
export type RitualMorningInput = z.input<typeof RitualMorningInput>;

export const RitualResult = z.enum(["done", "partly", "not"]);
export type RitualResult = z.infer<typeof RitualResult>;

// POST /v1/ritual/evening. `carry`: continue it tomorrow (partly or not). `minutes`: time done
// that counts toward the outcome's goal.
export const RitualEveningInput = z.object({
  results: z
    .array(
      z.object({
        item_id: z.uuid(),
        result: RitualResult,
        carry: z.boolean().optional(),
        minutes: OutcomeMinutes.nullish(),
      }),
    )
    .min(1)
    .max(CHECKLIST_MAX_OPEN * 2),
});
export type RitualEveningInput = z.input<typeof RitualEveningInput>;

// A suggestion for the morning, from the calendar or a goal behind its pace.
export const RitualSuggestion = z.object({
  text: z.string().min(1).max(200),
  goal_id: z.uuid().nullable(),
  estimate_minutes: z.number().int().positive().nullable(),
  // The maths: "University is 4h behind this week." or "On your calendar at 10:00."
  reason: z.string(),
  source: z.enum(["calendar", "behind"]),
});
export type RitualSuggestion = z.infer<typeof RitualSuggestion>;

export const RitualGoalChip = z.object({ id: z.uuid(), title: z.string(), area: GoalArea });
export type RitualGoalChip = z.infer<typeof RitualGoalChip>;

// GET /v1/ritual?phase=morning|evening (phase: show that half now, for a preview or the stage)
export const RitualQuery = z.object({ phase: RitualKind.optional() });
export type RitualQuery = z.infer<typeof RitualQuery>;

export const RitualToday = z.object({
  day: LocalDay,
  // Which half to show now: null before waking.
  phase: RitualKind.nullable(),
  morning: RitualState,
  evening: RitualState,
  // The checklist goal that holds the outcomes; null until the first morning.
  goal_id: z.uuid().nullable(),
  // Today's outcomes (not the ones moved to tomorrow), by position.
  items: z.array(ChecklistItem),
  // Morning only, at most two.
  suggestions: z.array(RitualSuggestion),
  // The user's active goals as quick chips (not the outcomes goal itself).
  goals: z.array(RitualGoalChip),
  // The evening line once saved: "2 of 3 done. 40 min logged for Training. ..."
  summary: z.string().nullable(),
  // "University at 09:00": tomorrow's first block, for the evening.
  tomorrow: z.string().nullable(),
});
export type RitualToday = z.infer<typeof RitualToday>;

export const RitualEveningResponse = z.object({
  summary: z.string(),
  // The new items on tomorrow.
  carried: z.array(ChecklistItem),
  // Minutes logged per goal.
  logged: z.array(z.object({ goal_id: z.uuid(), minutes: z.number().int().positive() })),
  ritual: RitualToday,
});
export type RitualEveningResponse = z.infer<typeof RitualEveningResponse>;

// ---------- standing instructions ----------
// Not goals: the user's ground rules ("keep Sundays clear", "home every day by 21:00"). Given at
// setup, changed any time. Michael never plans into the time they protect.

// clear_day: nothing planned on `days`. home_by: nothing planned after `time` (on `days`, or every
// day), until 05:00 the next morning. quiet_hours: nothing between `time` and `end_time`. custom:
// text for the coach only.
export const InstructionKind = z.enum(["clear_day", "home_by", "quiet_hours", "custom"]);
export type InstructionKind = z.infer<typeof InstructionKind>;

// 0 = Sunday .. 6 = Saturday, as in JavaScript's getDay().
const Weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);

// Calendar titles allowed inside the protected time ("Rhefuel" on a clear Sunday), matched like a
// goal's `calendar_titles`: equal or starting with the entry, ignoring case and accents.
const ExceptionTitles = z.array(z.string().trim().min(1, "An exception must not be blank").max(200)).max(50);

export const Instruction = z.object({
  id: z.uuid(),
  // The user's own words, kept exactly as written.
  text: z.string().min(1),
  kind: InstructionKind,
  days: Weekdays.optional(),
  time: ClockTime.optional(),
  end_time: ClockTime.optional(),
  // Left out when there are none.
  exceptions: ExceptionTitles.optional(),
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
    exceptions: ExceptionTitles.nullish(),
    active: z.boolean().default(true),
  })
  .superRefine((i, ctx) => {
    const message = instructionShapeError(i);
    if (message) ctx.addIssue({ code: "custom", message });
  });
export type InstructionCreate = z.input<typeof InstructionCreate>;

// Every field optional; null clears `days`, `time`, `end_time` or `exceptions`. The API checks the
// shape of the result (the stored instruction with the change applied), not of the change alone.
export const InstructionUpdate = z.object({
  text: instructionText.optional(),
  kind: InstructionKind.optional(),
  days: Weekdays.nullish(),
  time: ClockTime.nullish(),
  end_time: ClockTime.nullish(),
  exceptions: ExceptionTitles.nullish(),
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
    // The goal the block counts for (#271); null clears it.
    goal_id: z.uuid().nullable().optional(),
  })
  .refine((p) => p.start_at || p.end_at || p.new_title || p.goal_id !== undefined, {
    message: "Give start_at, end_at, new_title or goal_id",
  });
export type MoveCalendarBlockPayload = z.infer<typeof MoveCalendarBlockPayload>;

// move_calendar_blocks: every move is a move_calendar_block, carried out all or nothing and undone
// together. Extra fields (the travel maths) ride along for the app.
export const MoveCalendarBlocksPayload = z.object({
  moves: z.array(MoveCalendarBlockPayload).min(1).max(10),
});
export type MoveCalendarBlocksPayload = z.infer<typeof MoveCalendarBlocksPayload>;

// create_focus_block: a new block on the user's calendar, tagged as Michael's.
export const CreateFocusBlockPayload = z
  .object({
    start_at: IsoDateTime,
    end_at: IsoDateTime,
    title: z.string().min(1).max(200).optional(),
    // The goal the block counts for (#271): saved as data.goal_id, so the score counts it.
    goal_id: z.uuid().nullable().optional(),
  })
  .refine((p) => Date.parse(p.end_at) > Date.parse(p.start_at), { message: "end_at must be after start_at" });
export type CreateFocusBlockPayload = z.infer<typeof CreateFocusBlockPayload>;

// change_goal (#188): Michael proposes, the user accepts with one tap (execute). Each change patches
// one goal; undo puts the old values back. `until` marks a temporary change ("8h a week for 3
// weeks"): undo stays open until then, and the API puts the old values back when it passes.
export const GoalChange = z
  .object({
    goal_id: z.uuid(),
    weekly_budget_minutes: z
      .number()
      .int()
      .nonnegative()
      .max(7 * 24 * 60)
      .nullable()
      .optional(),
    target: GoalTarget.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((c) => c.weekly_budget_minutes !== undefined || c.target !== undefined || c.active !== undefined, {
    message: "Change weekly_budget_minutes, target or active",
  });
export type GoalChange = z.infer<typeof GoalChange>;

export const ChangeGoalPayload = z.object({
  changes: z.array(GoalChange).min(1).max(5),
  until: IsoDateTime.nullish(),
  // In the user's words or Michael's: "Exams from 1 December."
  reason: z.string().min(1).max(500),
});
export type ChangeGoalPayload = z.infer<typeof ChangeGoalPayload>;

// plan_change (#188): several moves or new blocks on the user's own calendar, accepted together.
// Every step keeps the guard rails of its own kind; undo reverts them all, until the first starts.
export const PlanStep = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("move_calendar_block"),
    event_id: z.uuid(),
    start_at: IsoDateTime.optional(),
    end_at: IsoDateTime.optional(),
    new_title: z.string().min(1).max(200).optional(),
  }),
  z.object({
    kind: z.literal("create_focus_block"),
    start_at: IsoDateTime,
    end_at: IsoDateTime,
    title: z.string().min(1).max(200).optional(),
  }),
]);
export type PlanStep = z.infer<typeof PlanStep>;

export const PlanChangePayload = z.object({
  steps: z.array(PlanStep).min(1).max(10),
  reason: z.string().min(1).max(500),
});
export type PlanChangePayload = z.infer<typeof PlanChangePayload>;

// block_mac_app: close distracting Mac apps from start_at to end_at (a focus guard). Name the apps
// with `app` (one) or `apps` (several), by name ("WhatsApp") or bundle id; `bundle_ids` adds more
// by id. Only apps on the allowlist (BLOCKABLE_MAC_APPS in mac-apps.ts) can be named. `back_to` is
// what the notification sends the person back to ("Back to Deep work."); it defaults to the goal
// or the block's title.
export const BlockMacAppPayload = z
  .object({
    app: z.string().trim().min(1).max(80).optional(),
    apps: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
    bundle_ids: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
    start_at: IsoDateTime,
    end_at: IsoDateTime,
    goal_id: z.uuid().optional(),
    block_event_id: z.uuid().optional(),
    back_to: z.string().trim().min(1).max(80).optional(),
  })
  .refine((p) => p.app || p.apps?.length || p.bundle_ids?.length, {
    message: "Name at least one app",
  })
  .refine((p) => Date.parse(p.end_at) > Date.parse(p.start_at), { message: "end_at must be after start_at" });
export type BlockMacAppPayload = z.infer<typeof BlockMacAppPayload>;

// ---------- focus guards (GET /v1/focus-guards/active) ----------

// What executing block_mac_app creates: while it runs, the Mac collector closes these apps when
// they come to the front. Undoing the recommendation removes it at once.
export const FocusGuard = z.object({
  id: z.uuid(),
  recommendation_id: z.uuid().nullable(),
  // Allowlisted names ("WhatsApp") and every bundle id they map to.
  apps: z.array(z.string()),
  bundle_ids: z.array(z.string()),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  goal_id: z.uuid().nullable(),
  // "Back to Deep work." in the notification; null when there is nothing to name.
  back_to: z.string().nullable(),
  created_at: IsoDateTime,
});
export type FocusGuard = z.infer<typeof FocusGuard>;

export const FocusGuardsResponse = z.object({
  now: IsoDateTime,
  // While off the record the collector does nothing, and `guards` is empty.
  off_the_record: z.boolean(),
  // Running now, or starting within the next 10 minutes (the collector checks the times itself).
  guards: z.array(FocusGuard),
});
export type FocusGuardsResponse = z.infer<typeof FocusGuardsResponse>;

// ---- Focus now (#397): one tap turns an intention into protected time ----

/** The lengths the app offers. The API takes any whole number of minutes in FOCUS_MINUTES_RANGE. */
export const FOCUS_LENGTHS = [25, 45, 60, 90] as const;
export const FOCUS_MINUTES_RANGE = { min: 5, max: 180 } as const;
/** What +15 adds, and the longest a session may run in all. */
export const FOCUS_EXTEND_MINUTES = 15;
export const FOCUS_MAX_MINUTES = 240;

// active: running now. done: ran to its end (Michael buzzes the watch). ended: ended early.
export const FocusSessionStatus = z.enum(["active", "done", "ended"]);
export type FocusSessionStatus = z.infer<typeof FocusSessionStatus>;

export const FocusSession = z.object({
  id: z.uuid(),
  goal_id: z.uuid(),
  goal_title: z.string(),
  status: FocusSessionStatus,
  start_at: IsoDateTime,
  // The planned end; +15 moves it.
  end_at: IsoDateTime,
  // When it actually stopped (the end on time, or the tap on End early); null while active.
  ended_at: IsoDateTime.nullable(),
  // Planned length now, start to end.
  minutes: z.number().int().nonnegative(),
  // Counted as goal time when it stopped (0 when the user said not to count it); null while active.
  counted_minutes: z.number().int().nonnegative().nullable(),
  // The user's own calendar block that holds the session (created from now, or the goal block
  // already running).
  event_id: z.uuid().nullable(),
  // True when distracting Mac apps are muted for the session (a focus guard on a connected Mac).
  guarded: z.boolean(),
  apps: z.array(z.string()),
  // The log_time recommendation that confirmed the time (undo takes it back for 24 hours).
  log_recommendation_id: z.uuid().nullable(),
  // Michael's line for the result: "Done. 45 min for University."
  message: z.string().nullable(),
  created_at: IsoDateTime,
});
export type FocusSession = z.infer<typeof FocusSession>;

export const FocusStart = z
  .object({
    goal_id: z.uuid().optional(),
    // The goal in the user's words ("University"), matched like POST /v1/log.
    goal: z.string().min(1).max(200).optional(),
    minutes: z.number().int().min(FOCUS_MINUTES_RANGE.min).max(FOCUS_MINUTES_RANGE.max).optional(),
    // A goal block of the user's that is running now: the session uses it instead of a new block.
    event_id: z.uuid().optional(),
  })
  .refine((v) => v.goal_id || v.goal || v.event_id, { message: "Name the goal" });
export type FocusStart = z.input<typeof FocusStart>;

export const FocusExtend = z.object({
  minutes: z.number().int().min(5).max(60).optional(),
});
export type FocusExtend = z.input<typeof FocusExtend>;

export const FocusEnd = z.object({
  // End early: count the time so far (default) or not at all.
  count: z.boolean().optional(),
});
export type FocusEnd = z.input<typeof FocusEnd>;

export const FocusActiveResponse = z.object({
  now: IsoDateTime,
  session: FocusSession.nullable(),
  // The session that stopped in the last 15 minutes, so a screen that comes back shows its result.
  last: FocusSession.nullable(),
});
export type FocusActiveResponse = z.infer<typeof FocusActiveResponse>;

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
// "user": the user changed their own calendar on the Timeline (#271). Kept only so Undo works; never
// listed as advice.
export const RecommendationSource = z.enum(["analysis", "chat", "user"]);
export type RecommendationSource = z.infer<typeof RecommendationSource>;

// The specialist of the analysis (mode `specialists`) whose finding a recommendation came from.
export const AnalysisSpecialist = z.enum(["work", "training", "rest", "food"]);
export type AnalysisSpecialist = z.infer<typeof AnalysisSpecialist>;

// How POST /v1/analysis/run thinks: one pass with the whole brief (the default), or four
// specialists in parallel and a coordinator that merges them.
export const AnalysisMode = z.enum(["single", "specialists"]);
export type AnalysisMode = z.infer<typeof AnalysisMode>;

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
  // Which specialist found it, on runs in mode `specialists`. Null or absent otherwise.
  specialist: AnalysisSpecialist.nullable().optional(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type Recommendation = z.infer<typeof Recommendation>;

// ---------- done time (#317) ----------
// What the user says they did, in their own words: "I took a bath for 40 minutes at 13:00". The
// goal by id or by name (matched on the server), the time by start and end, or by minutes plus a
// start ("at"); minutes alone end just now. Past only: an entry never ends in the future. Stored
// as the user's own manual event (source `manual`): inside a block of its goal it confirms that
// block; outside every block it counts toward the goal's budget, never the score (docs/api.md,
// "Score", #372). Undoable through the recommendation that holds it.
export const LogTimeInput = z
  .object({
    goal_id: z.uuid().optional(),
    // The goal's name as the user said it ("bath"), when there is no id.
    goal: z.string().trim().min(1).max(200).optional(),
    minutes: z
      .number()
      .int()
      .positive()
      .max(16 * 60)
      .optional(),
    start_at: IsoDateTime.optional(),
    end_at: IsoDateTime.optional(),
    note: z.string().trim().min(1).max(280).optional(),
  })
  .refine((i) => i.goal_id || i.goal, { message: "Name the goal: goal_id or goal" })
  .refine((i) => i.minutes || (i.start_at && i.end_at), { message: "Give minutes, or start_at and end_at" });
export type LogTimeInput = z.input<typeof LogTimeInput>;

// A past goal block settled by the user: Did it (all of it, or `minutes` of it from its start) or
// Didn't (lost, with an optional reason in their words).
export const SettleBlockInput = z.object({
  event_id: z.uuid(),
  did: z.boolean(),
  minutes: z
    .number()
    .int()
    .positive()
    .max(16 * 60)
    .optional(),
  reason: z.string().trim().min(1).max(280).optional(),
});
export type SettleBlockInput = z.input<typeof SettleBlockInput>;

// The payloads kept on the recommendation that holds the entry, so undo knows what to remove.
export const LogTimePayload = z.object({
  goal_id: z.uuid(),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  note: z.string().max(280).nullish(),
});
export type LogTimePayload = z.infer<typeof LogTimePayload>;

export const SettleBlockPayload = z.object({
  event_id: z.uuid(),
  goal_id: z.uuid(),
  did: z.boolean(),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  reason: z.string().max(280).nullish(),
});
export type SettleBlockPayload = z.infer<typeof SettleBlockPayload>;

// What POST /v1/log and POST /v1/log/block answer: the entry, the recommendation that holds it
// (undo it with POST /v1/recommendations/:id/undo or DELETE /v1/log/:entry_id), the goal's week
// after it, and one line in Michael's voice with the maths.
export const LogTimeResponse = z.object({
  entry: Event,
  recommendation: Recommendation,
  goal: z.object({
    goal_id: z.uuid(),
    title: z.string(),
    spent_minutes: z.number().int().nonnegative(),
    budget_minutes: z.number().int().nonnegative(),
  }),
  // "Logged. Everything bath 40 of 60 min this week."
  message: z.string(),
});
export type LogTimeResponse = z.infer<typeof LogTimeResponse>;

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

// Where the web app lands after the callback: a path on the web app itself, never another site.
// "/onboarding?step=done" is fine; "//evil.example", "/\\evil", "https://..." are not.
export const ReturnPath = z
  .string()
  .max(200)
  .regex(/^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/, "Expected a path on this site");
export type ReturnPath = z.infer<typeof ReturnPath>;

// Optional body of POST /v1/integrations/:provider/connect. Default return: /you.
export const OAuthConnectRequest = z.object({ return_to: ReturnPath.optional() });
export type OAuthConnectRequest = z.infer<typeof OAuthConnectRequest>;

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

// ---------- calendar blocks edited on the Timeline (#271) ----------

export const RemoveCalendarBlockPayload = z.object({ event_id: z.uuid() });
export type RemoveCalendarBlockPayload = z.infer<typeof RemoveCalendarBlockPayload>;

// POST /v1/blocks: a new block on the user's own time.
export const BlockCreate = z
  .object({
    start_at: IsoDateTime,
    end_at: IsoDateTime,
    title: z.string().trim().min(1).max(200).optional(),
    goal_id: z.uuid().nullable().optional(),
  })
  .refine((p) => Date.parse(p.end_at) > Date.parse(p.start_at), { message: "end_at must be after start_at" });
export type BlockCreate = z.infer<typeof BlockCreate>;

// PATCH /v1/blocks/:id: move, resize, rename or change the goal of one of the user's solo blocks.
export const BlockUpdate = z
  .object({
    start_at: IsoDateTime.optional(),
    end_at: IsoDateTime.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    goal_id: z.uuid().nullable().optional(),
  })
  .refine((p) => p.start_at || p.end_at || p.title || p.goal_id !== undefined, {
    message: "Give start_at, end_at, title or goal_id",
  });
export type BlockUpdate = z.infer<typeof BlockUpdate>;

// What every /v1/blocks write answers: the block as it is now (null once removed) and the
// recommendation that holds the change, for POST /v1/recommendations/:id/undo until `undo_until`.
export const BlockChange = z.object({
  event: Event.nullable(),
  recommendation_id: z.uuid(),
  undo_until: IsoDateTime,
});
export type BlockChange = z.infer<typeof BlockChange>;

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

// GET /v1/sources/status: per source, is it switched on and when did its last event arrive.
// Powers the Connections rows on You ("Last data 12 min ago").
export const SourceStatus = z.object({
  source: Source,
  // The privacy switch as GET /v1/privacy shows it (off until opted in).
  enabled: z.boolean(),
  // Would an event from this source be stored right now: false while off the record or once the
  // user switched it off. A source never decided on still collects (its first event opts it in).
  collecting: z.boolean(),
  // When Michael last received an event from this source (created_at), or null if never.
  last_event_at: IsoDateTime.nullable(),
});
export type SourceStatus = z.infer<typeof SourceStatus>;

export const SourcesStatusResponse = z.object({
  off_the_record: z.boolean(),
  sources: z.array(SourceStatus),
});
export type SourcesStatusResponse = z.infer<typeof SourcesStatusResponse>;

// ---------- what Michael knows about you (GET /v1/me/knowledge, MCP what_you_know) ----------

// Everything Michael uses about the user, in plain words, built from the stores that already hold
// it (no table of its own). `told` is what the user said; `reads` is what each connection sends.
export const KnowledgeKind = z.enum(["memory", "check_in", "instruction", "profile"]);
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;

// Where it came from: said in chat, kept by an agent the user approved, answered in a check in,
// set by the user (instructions), or given at setup (the profile).
export const KnowledgeOrigin = z.enum(["chat", "agent", "check_in", "you", "setup"]);
export type KnowledgeOrigin = z.infer<typeof KnowledgeOrigin>;

export const KnowledgeItem = z.object({
  // memory: the event id; check_in: the check in id; instruction: its id; profile: the field
  // ("quiet_hours", "usual_week") or "<field>:<value>" for one entry of a list
  // ("weak_spots:late_nights", "fixed_titles:PT session").
  id: z.string().min(1),
  kind: KnowledgeKind,
  // Plain words. A memory, an instruction or a check in question as written; a profile line in Michael's words.
  text: z.string(),
  // A check in's answer in the user's own words; null otherwise.
  answer: z.string().nullable(),
  // When it was told, or null when not known.
  at: IsoDateTime.nullable(),
  origin: KnowledgeOrigin,
  // False for a paused instruction.
  active: z.boolean(),
  // Whether one tap really deletes it: memories (DELETE /v1/events/:id), check ins
  // (DELETE /v1/check-in/:id), instructions (DELETE /v1/instructions/:id) and one entry of a profile
  // list (PUT /v1/profile without it). Quiet hours and the usual week can be changed, not forgotten.
  forgettable: z.boolean(),
});
export type KnowledgeItem = z.infer<typeof KnowledgeItem>;

export const KnowledgeSource = z.object({
  source: Source,
  // What the user calls it, and one line of what it sends.
  name: z.string(),
  sends: z.string(),
  enabled: z.boolean(),
  collecting: z.boolean(),
  last_event_at: IsoDateTime.nullable(),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;

export const Knowledge = z.object({
  // Newest first within each kind; kinds in the order memory, check_in, instruction, profile.
  told: z.array(KnowledgeItem),
  // Connections that are switched on or have ever sent something (never manual or agent).
  reads: z.array(KnowledgeSource),
  // Three short lines, true to the code: what Michael never keeps.
  never_kept: z.array(z.string()),
  off_the_record: z.boolean(),
  // Agent calls logged today (Europe/Athens), and how many agents are approved now.
  asked_today: z.number().int().nonnegative(),
  agents_connected: z.number().int().nonnegative(),
});
export type Knowledge = z.infer<typeof Knowledge>;

// ---------- profile: the onboarding answers (GET/PUT /v1/profile) ----------

// `ClockTime` ("HH:MM", 24 hour, Europe/Athens wall clock) is defined with the goals above.

export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof Weekday>;

// ---------- goal suggestions (#134): goals Michael reads off the user's own calendar ----------

// One goal the user already lives by: recurring own calendar blocks (nobody else in them) grouped
// into a goal, with the weekly hours they add up to and the calendar titles that would count.
// The shape is a GoalCreate plus why: POST it to /v1/goals as it is, or accept it by id.
export const GoalSuggestion = z.object({
  // Stable for the same calendar ("training", "study", "title:guitar"), so accept can name it.
  id: z.string().min(1).max(120),
  title: z.string().min(1),
  // Always one of the three areas for a new goal (#131); `area` repeats it for clarity.
  category: GoalCategory,
  area: GoalArea,
  weekly_budget_minutes: z.number().int().positive(),
  target: z.object({
    kind: z.literal("time"),
    calendar_titles: z.array(z.string().min(1)).min(1),
  }),
  // In Michael's voice: "Gym, Swimming and Yoga, Mon to Thu, 6h 30 a week."
  evidence: z.string().min(1),
  // Blocks a week on average and the weekdays they fall on.
  sessions_per_week: z.number().nonnegative(),
  days: z.array(Weekday),
});
export type GoalSuggestion = z.infer<typeof GoalSuggestion>;

export const GoalSuggestionsResponse = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
  suggestions: z.array(GoalSuggestion),
});
export type GoalSuggestionsResponse = z.infer<typeof GoalSuggestionsResponse>;

// Optional edits when accepting by id; anything left out keeps the suggestion's value.
export const GoalSuggestionAccept = z.object({
  title: z.string().min(1).max(120).optional(),
  weekly_budget_minutes: z.number().int().min(0).max(10080).optional(),
  calendar_titles: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
});
export type GoalSuggestionAccept = z.input<typeof GoalSuggestionAccept>;

// Book time for a goal from the Goals tab (#309): the first free slot of this length from now
// until the end of the week, booked at once and undoable until it starts.
export const GoalBook = z.object({
  minutes: z.number().int().min(15).max(360).default(60),
});
export type GoalBook = z.input<typeof GoalBook>;

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
  // Calendar titles Michael never moves, even though they are the user's own blocks ("PT session",
  // booked outside the calendar). Matched like goal calendar titles: equal, or the title starts with it.
  fixed_titles: z.array(z.string().min(1).max(200)).max(50),
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
  fixed_titles: [],
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

// ---------- location (POST /v1/location/signals, GET /v1/location) ----------

// One sign of where the user is. The API turns signals into place visits (events of type
// `location`, source `location`) and keeps no raw trail: a point near no saved place is rounded.
//   point: a phone position, sent when the user opens Michael (throttled) or taps on the Location page.
// A union on `kind` so other signals can join later without breaking clients.
export const LocationSignal = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("point"),
    at: IsoDateTime,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().nonnegative().max(100_000).nullish(),
  }),
]);
export type LocationSignal = z.infer<typeof LocationSignal>;

export const LocationSignalsInput = z.object({ signals: z.array(LocationSignal).min(1).max(500) });
export type LocationSignalsInput = z.input<typeof LocationSignalsInput>;

export const LocationSignalsResponse = z.object({
  // Signals turned into visits (new or extended); the rest were dropped by privacy.
  recorded: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
  // Where the last signal put the user: a place label, a calendar location, or "Out".
  at: z.string().nullable(),
});
export type LocationSignalsResponse = z.infer<typeof LocationSignalsResponse>;

// What a visit event (type `location`, source `location`) carries in `data`.
export const VisitData = z.object({
  // The saved place, or null when the user was somewhere else ("Out").
  place_key: PlaceKey.nullable(),
  // How we know: a phone position. Planned visits from the calendar are not stored as events.
  evidence: z.array(z.enum(["phone"])),
  // Only for visits away from saved places: rounded to about a kilometre, never a trail.
  lat: z.number().nullish(),
  lng: z.number().nullish(),
});
export type VisitData = z.infer<typeof VisitData>;

export const LocationStatus = z.object({
  // The newest location signal, from any source; null when none has arrived yet.
  last_signal_at: IsoDateTime.nullable(),
  // The visit going on now (a signal in the last 30 minutes), else null.
  now: z.object({ label: z.string(), since: IsoDateTime }).nullable(),
  collecting: z.boolean(),
});
export type LocationStatus = z.infer<typeof LocationStatus>;

// GET /v1/places/search?q=: address matches for the Places screen, geocoded on the server.
export const AddressMatch = z.object({
  formatted_address: z.string(),
  place_id: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
});
export type AddressMatch = z.infer<typeof AddressMatch>;
export const AddressSearchResponse = z.object({
  results: z.array(AddressMatch),
  maps_available: z.boolean(),
});
export type AddressSearchResponse = z.infer<typeof AddressSearchResponse>;

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

// ---------- Google Maps searches (data.maps of a chrome search event) ----------

// One end of a Maps search: a name the user typed or clicked, and coordinates when the address
// carried them. Coordinates are kept only while source maps is switched on; otherwise the API
// stores them as null.
export const MapsStop = z.object({
  name: z.string().max(200).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});
export type MapsStop = z.infer<typeof MapsStop>;

// What a Google Maps address said: a search ("gyms near me"), a place that was opened, or
// directions between two stops. `place` is set for search and place, `from`/`to` for directions.
export const MapsQuery = z.object({
  kind: z.enum(["search", "place", "directions"]),
  place: MapsStop.nullable(),
  from: MapsStop.nullable(),
  to: MapsStop.nullable(),
});
export type MapsQuery = z.infer<typeof MapsQuery>;

// GET /v1/places/suggestions: places the user often looks up in Maps, offered as saved places.
// Never saved on their own; the user picks one and saves it with PUT /v1/places.
export const PlaceSuggestion = z.object({
  // A key to save it under when the name says what it is ("gym", "work"), else null.
  key: PlaceKey.nullable(),
  label: z.string().min(1).max(80),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  // How many Maps searches, places or directions mentioned it in the window.
  count: z.number().int().positive(),
  last_seen_at: IsoDateTime,
});
export type PlaceSuggestion = z.infer<typeof PlaceSuggestion>;

export const PlaceSuggestionsResponse = z.object({
  // False while source maps is switched off: then there are no suggestions.
  enabled: z.boolean(),
  suggestions: z.array(PlaceSuggestion),
});
export type PlaceSuggestionsResponse = z.infer<typeof PlaceSuggestionsResponse>;

export const TravelPlanInput = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  // Plan the whole day together: move the user's own blocks out of the rush, meetings stay fixed.
  // Plans the day `from` falls on (default today); per block suggestions are then left out.
  whole_day: z.boolean().optional(),
});
export type TravelPlanInput = z.infer<typeof TravelPlanInput>;

export const TravelPlanStatus = z.enum(["ok", "maps_unavailable", "travel_off"]);
export type TravelPlanStatus = z.infer<typeof TravelPlanStatus>;

// One drive of the day, as planned now and as Michael would plan it. `to_event_id` null is home.
export const TravelLeg = z.object({ depart_at: IsoDateTime, minutes: z.number().int().nonnegative() });
export type TravelLeg = z.infer<typeof TravelLeg>;
export const TravelDayDrive = z.object({
  from: z.string(),
  to: z.string(),
  to_event_id: z.string().nullable(),
  before: TravelLeg.nullable(),
  after: TravelLeg.nullable(),
});
export type TravelDayDrive = z.infer<typeof TravelDayDrive>;

export const TravelDayMove = z.object({
  event_id: z.string(),
  title: z.string(),
  from_start_at: IsoDateTime,
  start_at: IsoDateTime,
  end_at: IsoDateTime,
});
export type TravelDayMove = z.infer<typeof TravelDayMove>;

// The whole day plan (whole_day: true). `won_minutes` is before minus after; Michael proposes it
// only at 10 minutes or more. `note` says why there is nothing to propose.
export const TravelDayPlan = z.object({
  day: LocalDay,
  before_minutes: z.number().int().nonnegative(),
  after_minutes: z.number().int().nonnegative(),
  won_minutes: z.number().int().nonnegative(),
  moves: z.array(TravelDayMove),
  drives: z.array(TravelDayDrive),
  recommendation_id: z.uuid().nullable(),
  note: z.string().nullable(),
});
export type TravelDayPlan = z.infer<typeof TravelDayPlan>;

export const TravelPlanResult = z.object({
  status: TravelPlanStatus,
  from: IsoDateTime,
  to: IsoDateTime,
  travel: z.array(Event),
  recommendations: z.array(Recommendation),
  // Calendar events with a location that got no trip, and why.
  skipped: z.array(z.object({ calendar_event_id: z.string(), reason: z.string() })),
  // Only with whole_day: true.
  day: TravelDayPlan.nullable().optional(),
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
  // A change the agent made (booked a block, muted an app): the recommendation that carries it,
  // and until when Undo still works (null once it started, was undone, or is not undoable).
  recommendation_id: z.uuid().nullable().optional(),
  undo_until: IsoDateTime.nullable().optional(),
  // What the call did. true: it changed something. false: a change was tried and nothing changed
  // (not shared, refused by one of Michael's rules, or nothing to do); `summary` then says what
  // was tried and why. null or absent: a read, or a line from before this field. Count a change
  // only when it is true.
  changed: z.boolean().nullable().optional(),
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

/**
 * Whether a nudge counts towards the 5 a day (and the 20 minute gap). The end of a Focus now
 * session (`focus_done`, #397) is the user's own timer going off, so it never counts either.
 */
export const countsTowardsCap = (status: NudgeStatus, kind?: NudgeKind) =>
  status !== "suppressed" && status !== "test" && kind !== "focus_done";

// What a nudge is about. Each kind is one rule of the engine (apps/api/src/nudges).
// morning and evening carry the Morning and Evening moments (GET /v1/moments/:kind), once each a day.
// recovery_block carries a recovery offer (#167): a goal block slipped, 25 minutes later today.
export const NudgeKind = z.enum([
  "focus_drift",
  "block_soon",
  "wind_down",
  "goal_behind",
  "morning",
  "evening",
  "recovery_block",
  "focus_done",
]);
export type NudgeKind = z.infer<typeof NudgeKind>;

// What a nudge lets the user do without opening the app (#399): buttons on the notification
// (Chrome, Android, desktop) and on the Telegram message. `open` only opens the card (no request);
// the others go to POST /v1/nudges/:id/act. Each nudge can be acted on once (per API process).
//   snooze    the same nudge again in 10 minutes (block_soon)
//   mute_app  close `app` on the user's Mac for 30 minutes (focus_drift, Mac reporting, allowlisted app)
//   do_it     carry out the nudge's recommendation (recovery_block), undoable in the app
//   focus     start a Focus now session on the block's goal, from now to the block's end (block_soon, #397)
export const NudgeActionId = z.enum(["open", "snooze", "mute_app", "do_it", "focus"]);
export type NudgeActionId = z.infer<typeof NudgeActionId>;

export const NudgeAction = z.object({
  id: NudgeActionId,
  // The button, short: "Snooze 10 min", "Mute Instagram 30 min", "Do it".
  label: z.string().min(1).max(40),
  // mute_app only: the allowlisted Mac app (packages/shared/src/mac-apps.ts).
  app: z.string().max(40).optional(),
});
export type NudgeAction = z.infer<typeof NudgeAction>;

/** Minutes a snooze waits, and a mute lasts. */
export const NUDGE_SNOOZE_MINUTES = 10;
export const NUDGE_MUTE_MINUTES = 30;

/**
 * Where tapping a nudge goes: the exact card. A block nudge opens that block on the Timeline, a
 * recovery offer its card on Today, anything else Today.
 */
export function nudgeUrl(n: Pick<Nudge, "kind" | "key" | "day" | "recommendation_id">): string {
  // block_soon:<event id> and focus_drift:<event id>; a test nudge carries the real key after
  // `test:<press>:` (routes/nudges.ts).
  const key = n.key.replace(/^test:[^:]*:/, "");
  const eventId = key.startsWith(`${n.kind}:`) ? key.slice(n.kind.length + 1) : "";
  if ((n.kind === "block_soon" || n.kind === "focus_drift") && eventId) {
    return `/timeline?day=${n.day}&block=${encodeURIComponent(eventId)}`;
  }
  if (n.recommendation_id) return `/?card=${n.recommendation_id}`;
  return "/";
}

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
  // The maths behind it, one line, e.g. "University: 1h 11 of 6h done; the pace by now is 5h 13."
  reason: z.string(),
  status: NudgeStatus,
  created_at: IsoDateTime,
  sent_at: IsoDateTime.nullable(),
});
export type Nudge = z.infer<typeof Nudge>;

// A nudge on its way out with its buttons (#399). The buttons are worked out again from the stored
// nudge when one is tapped (no database change before the pitch), so they are not stored.
export type OutgoingNudge = Nudge & { actions?: NudgeAction[] };

// POST /v1/nudges/:id/act. No session: `token` is the signed, single use token the push carried.
export const NudgeActInput = z.object({
  action: NudgeActionId.exclude(["open"]),
  token: z.string().min(1).max(512),
});
export type NudgeActInput = z.infer<typeof NudgeActInput>;

export const NudgeActResult = z.object({
  action: NudgeActionId,
  // The follow up line, under 15 words: "Done. Undo in the app until 15:00."
  text: z.string().min(1),
  // Until when it can be undone in the app (do_it, mute_app); null for a snooze.
  undo_until: IsoDateTime.nullable(),
  // Where tapping the follow up goes.
  url: z.string(),
  nudge_id: z.uuid(),
});
export type NudgeActResult = z.infer<typeof NudgeActResult>;

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
    // ActivityWatch and Shortcuts intervals left out because Apple's own log covered the same hour.
    app_usage_superseded: z.number().int().nonnegative(),
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

// GET /v1/patterns/phone-cadence (#298): the one detector Today reads, from only the iPhone's app
// usage and the nights, over the 7 days ending now. `phone_cadence` equals the full report's.
export const PhoneCadenceReport = PatternReport.pick({
  from: true,
  to: true,
  timezone: true,
  generated_at: true,
  phone_cadence: true,
});
export type PhoneCadenceReport = z.infer<typeof PhoneCadenceReport>;

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

// What took the lost time over a stretch of days: one entry per app, site or site category.
export const ScoreLostBy = z.object({
  what: z.string(),
  kind: z.enum(["app", "site"]),
  category: AppCategory,
  // Whole minutes, at least 1.
  minutes: z.number().int().positive(),
});
export type ScoreLostBy = z.infer<typeof ScoreLostBy>;

export const ScoreBlock = z.object({
  // The calendar event. A block that crosses local midnight appears once on each day.
  event_id: z.string(),
  goal_id: z.uuid(),
  goal_title: z.string(),
  // The calendar event's own title ("Cold Outreach / Sales").
  title: z.string(),
  // Which rule tied the event to the goal.
  // `logged`: no longer sent (#372). Logged time outside a block is not planned time: it is
  // `logged_minutes` on the goal, the day and the week, never a block.
  matched_by: z.enum([
    "goal_id",
    "calendar_titles",
    "goal_category",
    "goal_title",
    "category_word",
    "logged",
  ]),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  // The personal record set in this block (`longest_block`, not a baseline), so the tape can draw
  // the mark at its `tick_index`. Null when the block set none.
  record_id: z.uuid().nullable(),
  ...scoreTotals,
  // One per 5 minutes from start_at; the last one is shorter when the block is not a multiple of 5.
  ticks: z.array(ScoreTick),
  lost: z.array(ScoreLostStretch),
  // Ids of the active standing instructions this block's time falls under (a work block planned
  // on a clear Sunday). Empty when it breaks none. It never changes the block's minutes.
  instructions_broken: z.array(z.uuid()),
  // The user's word on a past block (#317): "did" (all or part of it, the rest lost) or "didnt"
  // (all of it lost). Null or absent while unsettled.
  settled: z.enum(["did", "didnt"]).nullish(),
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

// The week's entry per category also carries the target and the floor (#165): the balanced week.
export const ScoreWeekArea = ScoreArea.extend({
  // This week's target for the category; null without a target or when it has no time goals.
  target_pct: z.number().int().min(0).max(100).nullable(),
  // The least the category must score for the week to count (default 50, editable per week).
  floor_pct: z.number().int().min(0).max(100),
  // Null when the category has no time goals or nothing has elapsed this week. A category with
  // time goals and nothing elapsed in it does not meet its floor.
  meets_floor: z.boolean().nullable(),
});
export type ScoreWeekArea = z.infer<typeof ScoreWeekArea>;

// Done time the user logged outside every block of its goal (#372): it counts toward the goal's
// weekly budget, never toward the score (not planned, not spent). GET /v1/score always sends it
// (0 when there is none); optional only so older fixtures still parse.
const LoggedMinutes = Minutes.optional();

export const ScoreDay = z.object({
  date: LocalDay,
  ...scoreTotals,
  time_won_back_minutes: Minutes,
  // Logged outside the day's blocks; outside every total above.
  logged_minutes: LoggedMinutes,
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

// A checklist goal on GET /v1/score (#238): items set and done on the day and in its week. An item
// carried to the next day counts there, not twice; a dropped one counts as set, not done.
const SetDone = z.object({ set: z.number().int().nonnegative(), done: z.number().int().nonnegative() });
export const ScoreChecklist = z.object({ today: SetDone, week: SetDone });
export type ScoreChecklist = z.infer<typeof ScoreChecklist>;

// A count goal on GET /v1/score (#238): "1 of 2, 3 days left". Occurrences so far this week (own
// blocks at least half spent, workouts, check ins answered yes, deduplicated per day), the weekly
// target, what is left, and the days of the week that have not ended yet (today included).
export const ScoreCount = z.object({
  done: z.number().int().nonnegative(),
  target: z.number().int().nonnegative(),
  left: z.number().int().nonnegative(),
  days_left: z.number().int().min(0).max(7),
});
export type ScoreCount = z.infer<typeof ScoreCount>;

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
  // Logged this week outside the goal's blocks (#372): budget progress, outside the score. The
  // goal's week against its budget is spent_minutes + logged_minutes (`budgetMinutesDone`).
  logged_minutes: LoggedMinutes,
  // Monday to Sunday.
  daily: z.array(
    z.object({
      date: LocalDay,
      planned_minutes: Minutes,
      spent_minutes: Minutes,
      logged_minutes: LoggedMinutes,
    }),
  ),
  // Budget minus spent minus logged, never below 0 ("4h 10 left of 6h"). 0 for a goal outside
  // the score.
  minutes_left: Minutes,
  // The goal's calendar blocks this week that have not ended yet ("two blocks still open").
  open_blocks: z.number().int().nonnegative(),
  // Only on goals of kind `checklist` and `count` (#238). Both stay outside the time score.
  checklist: ScoreChecklist.optional(),
  count: ScoreCount.optional(),
});
export type ScoreGoal = z.infer<typeof ScoreGoal>;

/**
 * A goal's minutes this week against its budget (#372): spent in its blocks plus logged outside
 * them. The score itself reads spent of planned only.
 */
export const budgetMinutesDone = (g: { spent_minutes: number; logged_minutes?: number | null }): number =>
  g.spent_minutes + (g.logged_minutes ?? 0);

// ---------- weekly target and the balanced week (#165) ----------

export const AreaNumbers = z.object({
  business: z.number().int().min(0).max(100),
  health: z.number().int().min(0).max(100),
  personal: z.number().int().min(0).max(100),
});
export type AreaNumbers = z.infer<typeof AreaNumbers>;

// A target per category; null when the category has no time goals.
export const AreaTargets = z.object({
  business: z.number().int().min(0).max(100).nullable(),
  health: z.number().int().min(0).max(100).nullable(),
  personal: z.number().int().min(0).max(100).nullable(),
});
export type AreaTargets = z.infer<typeof AreaTargets>;

export const DEFAULT_FLOOR_PCT = 50;

export const WeeklyTarget = z.object({
  // Monday, Europe/Athens.
  week_start: LocalDay,
  overall_pct: z.number().int().min(0).max(100),
  areas: AreaTargets,
  floors: AreaNumbers,
  // proposed: Michael's proposal, not stored until accepted. accepted: in force.
  status: z.enum(["proposed", "accepted"]),
  // Only accepting the proposal keeps "michael"; any number the user sends makes it "user".
  set_by: z.enum(["michael", "user"]),
  // One line in Michael's voice, with the maths.
  reason: z.string(),
  basis: z.object({
    // Full weeks of history used, at most 4.
    weeks_used: z.number().int().min(0).max(4),
    median_pct: z.number().int().min(0).max(100).nullable(),
    step: z.enum(["up", "hold", "down"]).nullable(),
    // Of the last 4 full weeks, how many were on target.
    on_target_weeks: z.number().int().min(0).max(4),
    // The calendar already shows a heavy week.
    heavy_week: z.boolean(),
  }),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type WeeklyTarget = z.infer<typeof WeeklyTarget>;

export const TARGET_BASELINE_WEEKS = 2;

export const TargetBaseline = z.object({
  // True once two full weeks of scores exist before the week.
  ready: z.boolean(),
  full_weeks: z.number().int().nonnegative(),
  needed: z.literal(TARGET_BASELINE_WEEKS),
  // Why there is no proposal yet, one line; null when ready.
  reason: z.string().nullable(),
});
export type TargetBaseline = z.infer<typeof TargetBaseline>;

// GET /v1/targets/current?week=YYYY-MM-DD
export const TargetQuery = z.object({ week: LocalDay.optional(), now: IsoDateTime.optional() });
export type TargetQuery = z.infer<typeof TargetQuery>;

export const TargetResponse = z.object({
  // The stored target for the week, or a fresh proposal (status "proposed") once the baseline is ready.
  target: WeeklyTarget.nullable(),
  baseline: TargetBaseline,
});
export type TargetResponse = z.infer<typeof TargetResponse>;

// PUT /v1/targets/:week_start. `accept` alone takes Michael's proposal; any number is the user's.
export const TargetUpdate = z
  .object({
    accept: z.literal(true).optional(),
    overall_pct: z.number().int().min(0).max(100).optional(),
    areas: AreaTargets.partial().optional(),
    floors: AreaNumbers.partial().optional(),
  })
  .strict()
  .refine((u) => Object.values(u).some((v) => v !== undefined), {
    message: "Send `accept: true` or at least one number",
  });
export type TargetUpdate = z.input<typeof TargetUpdate>;

// The week's target as the score carries it.
export const ScoreTarget = WeeklyTarget.pick({
  overall_pct: true,
  areas: true,
  floors: true,
  status: true,
  set_by: true,
});
export type ScoreTarget = z.infer<typeof ScoreTarget>;

// ---------- personal records (#166) ----------

export const PersonalRecordType = z.enum(["best_week", "best_week_area", "longest_block"]);
export type PersonalRecordType = z.infer<typeof PersonalRecordType>;

export const PersonalRecord = z.object({
  id: z.uuid(),
  type: PersonalRecordType,
  // Set for best_week_area, and for longest_block (the block's goal area).
  area: GoalArea.nullable(),
  // longest_block only.
  goal_id: z.uuid().nullable(),
  value: z.number().int().nonnegative(),
  unit: z.enum(["pct", "minutes"]),
  // Null for the first one, which is a baseline and is never announced.
  previous_value: z.number().int().nonnegative().nullable(),
  // week_start for the week records, the local day for a block.
  achieved_on: LocalDay,
  // longest_block: the calendar block it happened in.
  event_id: z.string().nullable(),
  // longest_block: the 5 minute tick in that block where the old best was passed.
  tick_index: z.number().int().nonnegative().nullable(),
  // Michael's one line, under 15 words; null for a baseline.
  line: z.string().nullable(),
  // Set once it has gone out as a nudge.
  announced_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
});
export type PersonalRecord = z.infer<typeof PersonalRecord>;

export const RecordsResponse = z.object({ records: z.array(PersonalRecord) });
export type RecordsResponse = z.infer<typeof RecordsResponse>;

// Sleep this week, outside the score (#117).
export const ScoreSleep = z.object({
  // The nightly goal in minutes (sleep_hours x 60).
  goal_minutes: Minutes,
  // Seven entries, Monday first: minutes slept in the night that ended that day, naps left out
  // (isNap, ./sleep.ts). Null for a night with no sleep data and for nights to come.
  nightly: z.array(Minutes.nullable()),
});
export type ScoreSleep = z.infer<typeof ScoreSleep>;

// GET /v1/score. The week has the WeeklyScore fields (score_pct may be null here), then the day.
export const Score = WeeklyScore.extend({
  score_pct: ScorePct,
  goals: z.array(ScoreGoal),
  timezone: z.string(),
  generated_at: IsoDateTime,
  // The local day asked for.
  date: LocalDay,
  // Logged this week outside every block (#372): budget time, in no total of the score.
  logged_minutes: LoggedMinutes,
  elapsed_minutes: Minutes,
  lost_minutes: Minutes,
  ahead_minutes: Minutes,
  unverified_minutes: Minutes,
  // The week per category, with its target and floor. The three add up to the week.
  areas: z.array(ScoreWeekArea),
  // Monday to Sunday of the week that holds `date`.
  days: z.array(ScoreDay),
  day: ScoreDayDetail,
  // The last instant each device reported anything, up to the end of the week (null: nothing).
  // Lost time after that instant is not known yet: phone data can arrive hours late.
  data_until: z.object({ mac: IsoDateTime.nullable(), iphone: IsoDateTime.nullable() }),
  // The week's target (#165): stored, or Michael's proposal; null until the baseline is ready.
  target: ScoreTarget.nullable(),
  // True only when the overall score meets the target AND every category with time goals meets
  // its floor. Null without a target or before anything has elapsed.
  on_target: z.boolean().nullable(),
  // Personal records set in this week (#166), baselines included (their `line` is null).
  records: z.array(PersonalRecord),
  // Waking time left this week outside fixed calendar commitments and sleep (#117). Goal blocks
  // count as free: they are where goal time goes.
  free_minutes_left: Minutes,
  // What took the week's lost time, most first: every lost stretch of the week's blocks summed
  // by app or site. GET /v1/score always sends it. The entries are rounded one by one, so they
  // can add up to a few minutes off `lost_minutes`.
  lost_by: z.array(ScoreLostBy).optional(),
  // Null until there is a sleep goal and sleep data this week.
  sleep: ScoreSleep.nullable(),
});
export type Score = z.infer<typeof Score>;

// ---------- chat (POST /v1/chat, GET /v1/chat) ----------
// Typed chat with Michael. The API keeps the history per user and thread; the client sends only the
// new line.

export const ChatRole = z.enum(["user", "assistant"]);
export type ChatRole = z.infer<typeof ChatRole>;

export const ChatMessage = z.object({
  id: z.uuid(),
  role: ChatRole,
  content: z.string().min(1),
  created_at: IsoDateTime,
  // On Michael's answers: the recommendations he did or undid while writing it (source "chat"), so
  // the Undo chips come back under the same answer after a reload. Empty on the user's lines.
  action_ids: z.array(z.uuid()).default([]),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

// ---------- chat threads (GET/POST /v1/chat/threads, PATCH/DELETE /v1/chat/threads/:id) ----------
// Separate conversations with Michael, as in Messages: each has its own lines. Michael remembers
// across them only through memories, check ins and the titles of recent threads, never their lines.

export const ChatThread = z.object({
  id: z.uuid(),
  // Short, from the first line (a model writes it, a template when it cannot); the user can rename.
  title: z.string().min(1).max(80),
  pinned: z.boolean(),
  archived: z.boolean(),
  // The last line, cut to 140 characters, for the list; null while the thread has no lines.
  preview: z.string().nullable(),
  last_message_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type ChatThread = z.infer<typeof ChatThread>;

export const ChatThreadList = z.object({
  // Pinned first, then by latest line (or creation while empty), newest first.
  threads: z.array(ChatThread),
});
export type ChatThreadList = z.infer<typeof ChatThreadList>;

export const NewChatThread = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});
export type NewChatThread = z.input<typeof NewChatThread>;

export const ChatThreadPatch = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((p) => p.title !== undefined || p.pinned !== undefined || p.archived !== undefined, {
    message: "Nothing to change",
  });
export type ChatThreadPatch = z.input<typeof ChatThreadPatch>;

export const ChatThreadDeleted = z.object({
  id: z.uuid(),
  // Lines deleted with it (really deleted, not hidden).
  messages: z.number().int().nonnegative(),
});
export type ChatThreadDeleted = z.infer<typeof ChatThreadDeleted>;

export const ChatRequest = z.object({
  message: z.string().trim().min(1).max(2000),
  // The answer will be read aloud (conversation mode): one or two short sentences, no lists.
  spoken: z.boolean().optional(),
  // The thread to write in. "new" starts one; omitted, the latest thread (a new one when none).
  thread_id: z.union([z.uuid(), z.literal("new")]).optional(),
});
export type ChatRequest = z.input<typeof ChatRequest>;

// POST /v1/chat/warm (#364): the chat screen is open on this thread (or a new one).
export const ChatWarmRequest = ChatRequest.pick({ thread_id: true });
export type ChatWarmRequest = z.input<typeof ChatWarmRequest>;

export const ChatResponse = z.object({
  // The user's line as stored, then Michael's answer.
  message: ChatMessage,
  reply: ChatMessage,
  // What Michael did on the user's own calendar while answering (source "chat"): status "done"
  // with `action.undo_until` as the undo deadline, or "undone" when the user asked to take one back.
  // Status "proposed" (kinds change_goal and plan_change, #188): a proposal waiting for the user's
  // tap (POST /v1/recommendations/:id/execute accepts, PATCH status "dismissed" declines).
  actions: z.array(Recommendation).default([]),
  // The thread the pair went into, as it stands after it (title, preview, time).
  thread: ChatThread,
});
export type ChatResponse = z.infer<typeof ChatResponse>;

// `event: step` on /v1/chat/stream: how Michael is working it out. One "running" then one "done"
// per tool call (same id), plus the opening "Reading your day". The label is plain, in Michael's
// voice, and never holds other people's titles or raw ids. Clients that do not know it ignore it.
export const ChatStep = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["running", "done"]),
});
export type ChatStep = z.infer<typeof ChatStep>;

export const ChatHistory = z.object({
  // Oldest first.
  messages: z.array(ChatMessage),
  // The recommendations named in the messages' action_ids, as they stand now (done or undone).
  actions: z.array(Recommendation).default([]),
  // The thread these lines belong to; null while the user has no thread yet.
  thread: ChatThread.nullable().default(null),
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

// ---------- one tap setup (setup tokens, #120) ----------
// A setup token ("ms_...") is short lived (30 minutes), single use and can do one thing: be
// exchanged for a device key for one connection. It is what goes into a QR code, an install
// command or a downloaded file, so the long lived device key never sits in a URL or a shell history.

export const SetupConnection = z.enum(["mac", "apple-watch", "iphone"]);
export type SetupConnection = z.infer<typeof SetupConnection>;

/** The device key name each connection gets, as listed on the Connections pages. */
export const SETUP_KEY_NAMES: Record<SetupConnection, string> = {
  mac: "Mac collector",
  "apple-watch": "Health Auto Export",
  iphone: "iPhone Shortcuts",
};

export const SetupTokenCreate = z.object({ connection: SetupConnection });
export type SetupTokenCreate = z.infer<typeof SetupTokenCreate>;

export const SetupTokenCreated = z.object({
  token: z.string(), // "ms_..."; shown once
  connection: SetupConnection,
  expires_at: IsoDateTime,
  // The web page that finishes setup on another device (the QR code opens it on the iPhone).
  setup_url: z.string(),
  // Mac only: the one line for Terminal. Fetches the public installer and passes the token to it.
  install_command: z.string().nullable(),
});
export type SetupTokenCreated = z.infer<typeof SetupTokenCreated>;

export const SetupTokenExchange = z.object({ token: z.string().min(10).max(200) });
export type SetupTokenExchange = z.infer<typeof SetupTokenExchange>;

export const SetupTokenExchanged = z.object({
  connection: SetupConnection,
  secret: z.string(), // the new device key ("mk_..."), ingest only
  api_url: z.string(), // where the device sends data
});
export type SetupTokenExchanged = z.infer<typeof SetupTokenExchanged>;
// ---------- voice (POST /v1/voice/speak) ----------
// Michael's reply read aloud by ElevenLabs. Text in, audio/mpeg out; nothing is stored.

export const VoiceSpeakRequest = z.object({
  text: z.string().trim().min(1).max(1000),
});
export type VoiceSpeakRequest = z.input<typeof VoiceSpeakRequest>;

// GET /v1/voice: which voice Michael speaks with and why. "chosen": ELEVENLABS_VOICE_ID.
// "fallback": the built-in ElevenLabs voice, because the chosen one was refused (a library voice
// on the free plan answers 402). "device": no ElevenLabs at all, the browser speaks.
export const VoiceInUse = z.enum(["chosen", "fallback", "device"]);
export type VoiceInUse = z.infer<typeof VoiceInUse>;

export const VoiceStatus = z.object({
  elevenlabs: z.boolean(),
  voice: VoiceInUse,
  reason: z.string().nullable(), // why, when it is not the chosen voice
  // Whether POST /v1/voice/transcribe can turn speech into text (ElevenLabs Speech to Text).
  transcribe: z.boolean(),
});
export type VoiceStatus = z.infer<typeof VoiceStatus>;

// ---------- voice in (POST /v1/voice/transcribe) ----------
// The raw recording is the request body (Content-Type one of these); text comes back. The audio
// is held in memory only for the one call to the provider, never stored and never logged.
// The types and size limits live in voice-limits.ts (zod free).
export const VoiceAudioType = z.enum(VOICE_AUDIO_TYPES);
export type VoiceAudioType = z.infer<typeof VoiceAudioType>;

export const VoiceTranscript = z.object({
  text: z.string(), // empty when nothing was said
  language: z.string().nullable(), // ISO 639 code the provider detected, e.g. "en", "el"
});
export type VoiceTranscript = z.infer<typeof VoiceTranscript>;

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
  // Too many requests in a short time (voice transcription): wait and try again.
  "rate_limited",
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
  // The numbers of the score (GET /v1/score, `goals`), so Today and Goals agree.
  // This week (Monday 00:00 local) until now.
  spent_week_minutes: z.number().int().nonnegative(),
  // Today: planned blocks (sleep: the nightly goal), time held, time lost in them.
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
  // Average minutes lost inside goal blocks in these hours, over the history days that had one
  // (`history_days` of the last 7). A day with no block in these hours is not in the average.
  expected_lost_minutes: z.number().int().nonnegative(),
  history_days: z.number().int().nonnegative(),
  // What usually takes the time in these hours: an app, a site by its product name ("Gmail") or a
  // site label.
  usual_trigger: z.string().nullable(),
  // The last time this same block ran in the history days (same title, or same goal at the same
  // hour), when it lost 10 minutes or more: Michael quotes it in place of the average.
  last_time: z
    .object({
      day: LocalDay,
      lost_minutes: z.number().int().nonnegative(),
      trigger: z.string().nullable(),
    })
    .nullable()
    .optional(),
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
  // Only with ?phrase=cached: the model is writing a line for these numbers; ask again without it.
  phrase_pending: z.literal(true).optional(),
  goals: z.array(MomentGoal),
  totals: z.object({
    // The score's day (GET /v1/score, `day`): goal blocks today, the time held in them so far and
    // the time lost inside them so far. Held plus lost is what has elapsed, never more than planned.
    planned_minutes: z.number().int().nonnegative(),
    spent_minutes: z.number().int().nonnegative(),
    lost_minutes: z.number().int().nonnegative(),
    // What today's blocks lose at the usual rate (the score's `time_won_back.usual_loss_rate`):
    // in the morning over all that is planned, in the evening over what has elapsed, which is the
    // line "won back" is measured against. Null until the score has enough history.
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

// ---------- your week (GET /v1/week/review, #376) ----------
// The Sunday evening review, on demand any time: the week's score with the maths, time won back,
// each goal kept or behind, records set, the biggest thief of time, what was logged, one lesson,
// next week's target and the first move. Every number comes from the score (GET /v1/score), the
// target rule (#165), the records (#166), the done time log (#317) and the ritual (#318); only
// `lesson` may be phrased by a model, under the moments' number guard.

export const WeekReviewQuery = z.object({
  // Any day of the week; default this week, Europe/Athens.
  week: LocalDay.optional(),
  // Replay the review as it stood at this instant.
  now: IsoDateTime.optional(),
});
export type WeekReviewQuery = z.infer<typeof WeekReviewQuery>;

export const WeekReviewGoal = z.object({
  goal_id: z.uuid(),
  title: z.string(),
  area: GoalArea,
  kind: z.enum(["time", "count"]),
  // time: minutes held in blocks plus minutes logged outside them; count: sessions done.
  done: z.number().int().nonnegative(),
  // time: the weekly budget in minutes; count: sessions a week.
  budget: z.number().int().positive(),
  // time: still booked ahead this week (zero once it has ended).
  planned_ahead: z.number().int().nonnegative(),
  kept: z.boolean(),
  // budget - done, never below 0.
  short: z.number().int().nonnegative(),
});
export type WeekReviewGoal = z.infer<typeof WeekReviewGoal>;

export const WeekReviewMove = z.object({
  title: z.string(), // "Book 1h for University, Monday 08:00"
  rationale: z.string(), // the maths
  // "booked": the block is already on the calendar; "book": Plan next week books it.
  status: z.enum(["booked", "book"]),
  goal_id: z.uuid(),
  minutes: z.number().int().positive(),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
});
export type WeekReviewMove = z.infer<typeof WeekReviewMove>;

export const WeekReview = z.object({
  week_start: LocalDay, // Monday
  week_end: LocalDay, // Sunday
  timezone: z.string(),
  generated_at: IsoDateTime,
  // True once the week has ended.
  complete: z.boolean(),
  // The score's week: spent / elapsed.
  score: z.object({
    pct: z.number().int().min(0).max(100).nullable(),
    planned_minutes: z.number().int().nonnegative(),
    elapsed_minutes: z.number().int().nonnegative(),
    spent_minutes: z.number().int().nonnegative(),
    lost_minutes: z.number().int().nonnegative(),
    ahead_minutes: z.number().int().nonnegative(),
    unverified_minutes: z.number().int().nonnegative(),
    // Median score of the full weeks before (at most 4); null with fewer than 2.
    usual_pct: z.number().int().min(0).max(100).nullable(),
    usual_weeks: z.number().int().nonnegative(),
    // The week's target when there was one, and whether it was met (overall and every floor).
    target_pct: z.number().int().min(0).max(100).nullable(),
    on_target: z.boolean().nullable(),
  }),
  // The score's time won back: the sum of the days against the usual loss rate.
  won_back_minutes: z.number().int().nonnegative(),
  // Logged outside every block (#372): toward budgets, in no total.
  logged_outside_minutes: z.number().int().nonnegative(),
  goals: z.array(WeekReviewGoal),
  // New bests set this week (baselines left out).
  records: z.array(PersonalRecord),
  // The longest unbroken verified run inside one goal block this week, record or not.
  best_block: z
    .object({
      goal_id: z.uuid(),
      goal_title: z.string(),
      day: LocalDay,
      minutes: z.number().int().positive(),
    })
    .nullable(),
  // What took the most of the lost time.
  thief: z
    .object({
      what: z.string(),
      kind: z.enum(["app", "site"]),
      minutes: z.number().int().positive(),
      // Its share of the week's lost minutes.
      share_pct: z.number().int().min(0).max(100),
    })
    .nullable(),
  // Done time the user logged (#317): entries and minutes.
  logged: z.object({ entries: z.number().int().nonnegative(), minutes: z.number().int().nonnegative() }),
  // The daily ritual's outcomes (#318): set (moved ones left out) and done.
  outcomes: z.object({ set: z.number().int().nonnegative(), done: z.number().int().nonnegative() }),
  lesson: z.string(),
  phrased_by: z.enum(["template", "model"]),
  // Next week's target (#165): stored, else Michael's proposal; reason says why or what is missing.
  next_week: z.object({
    week_start: LocalDay,
    target_pct: z.number().int().min(0).max(100).nullable(),
    status: z.enum(["proposed", "accepted"]).nullable(),
    reason: z.string().nullable(),
  }),
  next_move: WeekReviewMove.nullable(),
});
export type WeekReview = z.infer<typeof WeekReview>;

// POST /v1/week/plan: book next week's first goal block.
export const WeekPlanInput = z.object({
  goal_id: z.uuid(),
  minutes: z.number().int().min(15).max(360),
});
export type WeekPlanInput = z.infer<typeof WeekPlanInput>;

// ---------- check in (#187) ----------
// Michael asks a few questions about the day, drawn from the timeline, and keeps the answers as
// structured notes that feed the chat, the analysis and later questions. At most two rounds a day:
// one after a missed goal block, one at the Evening moment.

export const CheckInKind = z.enum([
  // A goal block that should have had a workout, and none was recorded.
  "missed_block",
  // A stretch of the working day with nothing on the timeline and no Mac activity.
  "unaccounted",
  // A training block that ended.
  "training",
  // A meeting with other people that ended.
  "meeting",
  // Last night was short.
  "short_night",
  // Asked only because of an earlier answer.
  "follow_up",
]);
export type CheckInKind = z.infer<typeof CheckInKind>;

export const CheckInAnswerType = z.enum(["yes_no", "scale", "text"]);
export type CheckInAnswerType = z.infer<typeof CheckInAnswerType>;

export const CheckInMoment = z.enum(["missed_block", "evening"]);
export type CheckInMoment = z.infer<typeof CheckInMoment>;

// "yes" or "no" for yes_no, 1 to 5 for scale, the user's own words for text (any type takes words).
export const CheckInValue = z.union([
  z.literal("yes"),
  z.literal("no"),
  z.number().int().min(1).max(5),
  z.string().trim().min(1).max(500),
]);
export type CheckInValue = z.infer<typeof CheckInValue>;

export const CheckIn = z.object({
  id: z.uuid(),
  // Local day (YYYY-MM-DD) the question is about.
  day: z.string(),
  kind: CheckInKind,
  question: z.string().min(1),
  answer_type: CheckInAnswerType,
  moment: CheckInMoment,
  // The timeline event, goal and time span the question is about, when there is one.
  event_id: z.uuid().nullable(),
  goal_id: z.uuid().nullable(),
  start_at: IsoDateTime.nullable(),
  end_at: IsoDateTime.nullable(),
  // The question this one follows up, when kind is follow_up.
  follow_up_of: z.uuid().nullable(),
  answer: CheckInValue.nullable(),
  // What the answer settles, in a word, for later use: an unaccounted stretch that was a
  // "meeting", a block that was "skipped", a short night that "played_a_part". Null otherwise.
  label: z.string().nullable(),
  asked_at: IsoDateTime,
  answered_at: IsoDateTime.nullable(),
});
export type CheckIn = z.infer<typeof CheckIn>;

// GET /v1/check-in: today's questions, answered and open, in the order to ask them.
export const CheckInToday = z.object({
  day: z.string(),
  // True while a question is still open.
  open: z.boolean(),
  // The round the open questions belong to, null when none is open.
  moment: CheckInMoment.nullable(),
  questions: z.array(CheckIn),
});
export type CheckInToday = z.infer<typeof CheckInToday>;

export const CheckInAnswer = z.object({ value: CheckInValue });
export type CheckInAnswer = z.infer<typeof CheckInAnswer>;

// POST /v1/check-in/:id/answer
export const CheckInAnswerResponse = z.object({
  check_in: CheckIn,
  // Asked only when the answer calls for one ("You slept 5h 10. Did that play a part?").
  follow_up: CheckIn.nullable(),
});
export type CheckInAnswerResponse = z.infer<typeof CheckInAnswerResponse>;

// ---------- follow up drafts ----------

// Short follow ups Michael drafts after a conversation or a meeting with other people, for the user
// to copy and send themselves. Stored, never sent anywhere. Written from summaries only: no raw
// transcript is ever stored or sent to a model.
// proposed -> done (the user sent it themselves) | dismissed
export const DraftStatus = z.enum(["proposed", "done", "dismissed"]);
export type DraftStatus = z.infer<typeof DraftStatus>;

export const DraftChannel = z.enum(["email", "chat"]);
export type DraftChannel = z.infer<typeof DraftChannel>;

// Who wrote the words: Claude, the template (no model key, or the demo week), or the analysis run
// (a draft_follow_up recommendation the user carried out).
export const DraftAuthor = z.enum(["model", "template", "analysis"]);
export type DraftAuthor = z.infer<typeof DraftAuthor>;

export const Draft = z.object({
  id: z.uuid(),
  // The conversation or meeting it follows up (a timeline event id); null when it came from a recommendation.
  event_id: z.uuid().nullable(),
  recommendation_id: z.uuid().nullable(),
  // "Customer call: onboarding feedback", the event's title as the timeline has it.
  title: z.string().min(1),
  // When the conversation or meeting happened (its start); null when unknown.
  event_at: IsoDateTime.nullable(),
  channel: DraftChannel,
  // Email subject; null for a chat message.
  subject: z.string().nullable(),
  body: z.string().min(1),
  written_by: DraftAuthor,
  status: DraftStatus,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type Draft = z.infer<typeof Draft>;

export const DraftList = z.object({ drafts: z.array(Draft) });
export type DraftList = z.infer<typeof DraftList>;

export const DraftStatusUpdate = z.object({ status: DraftStatus });
export type DraftStatusUpdate = z.infer<typeof DraftStatusUpdate>;

export const DraftGenerateInput = z.object({
  // Draft for this conversation or meeting only. Default: every one that ended in the last 24 hours
  // and has no draft yet (at most 3).
  event_id: z.uuid().optional(),
});
export type DraftGenerateInput = z.infer<typeof DraftGenerateInput>;

export const DraftGenerateResult = z.object({
  // Drafts written by this call (an event that already has a draft is not drafted again).
  drafts: z.array(Draft),
  // Events looked at that already had a draft.
  skipped: z.number().int().nonnegative(),
});
export type DraftGenerateResult = z.infer<typeof DraftGenerateResult>;
