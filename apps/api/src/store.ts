import {
  type AnalysisRun,
  type ChatMessage,
  type ChatRole,
  type ChatThread,
  type CheckIn,
  type CheckInValue,
  type ChecklistItem,
  type Draft,
  type DraftStatus,
  demoRecommendations,
  type Event,
  type EventInput,
  type EventSummary,
  type EventType,
  type FocusGuard,
  type FocusSessionStatus,
  type Goal,
  type GoalCreate,
  type GoalUpdate,
  type Instruction,
  type InstructionCreate,
  type InstructionUpdate,
  type Integration,
  type IntegrationProvider,
  mockAnalysisRun,
  mockEvents,
  mockGoals,
  mockInstructions,
  mockRecommendations,
  type Nudge,
  type NudgeStatus,
  type PersonalRecord,
  type Place,
  type Profile,
  plainText,
  type Recommendation,
  type RecommendationStatus,
  type RitualKind,
  type Source,
  type SourceSetting,
  type WeeklyTarget,
} from "@michael/shared";
import type { z } from "zod";
import { currentDemoVisitor, currentUserId } from "./context";
import { demoWeekRecommendations } from "./demo/retired";
import { stableUuid } from "./demo/week";
import { env } from "./env";
import { HttpError } from "./http";
import { guardRecommendation, guardRecommendations } from "./instructions/guard";
import type { GeocodeHit } from "./integrations/maps";
import { type PrivacyBackend, type PrivacyRules, screenEvents } from "./privacy";
import type { NewRecord } from "./score/records";
import { SupabaseStore } from "./supabase-store";
import { noteWrite } from "./writes";

export interface TimelineFilter {
  from: string;
  to: string;
  source?: Source[];
  type?: EventType[];
}

export type NewRecommendation = Pick<Recommendation, "goal_id" | "title" | "rationale" | "action"> & {
  analysis_run_id?: string | null;
  source?: Recommendation["source"];
};

export interface SeedResult {
  inserted: number;
  removed: number;
  kept: number;
}

export interface InsertResult {
  inserted: Event[];
  duplicates: number;
  // Dropped by privacy settings (source off / off the record), see privacy.ts.
  ignored: number;
}

// An integration row with its secrets. Tokens never leave apps/api: routes answer with
// `publicIntegration`, which drops them.
export interface IntegrationRecord extends Integration {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
}
export type IntegrationPatch = Partial<Omit<IntegrationRecord, "provider">>;

export const publicIntegration = (r: IntegrationRecord): Integration => ({
  provider: r.provider,
  status: r.status,
  account: r.account,
  connected_at: r.connected_at,
  last_sync_at: r.last_sync_at,
  error: r.error,
});

export interface UpsertResult {
  inserted: Event[];
  updated: Event[];
  unchanged: number;
}

// What executing a recommendation changed, so undo can put it back. Stored as jsonb; parsed by
// apps/api/src/actions/calendar.ts. Never returned by the API.
export interface RecommendationActionUpdate {
  status: RecommendationStatus;
  executed_at?: string | null;
  undone_at?: string | null;
  execution?: unknown;
}

/** What DELETE /v1/me/data removes: the whole account, or the matching timeline events. */
export interface DataDeleteScope {
  everything: boolean;
  source?: Source;
  from?: string;
  to?: string;
}

/** Rows deleted per table. */
export type DeleteCounts = Record<string, number>;

/** What PATCH /v1/chat/threads/:id may change. */
export type ChatThreadChange = Partial<Pick<ChatThread, "title" | "pinned" | "archived">>;

/** The thread title before the first line: the model or the template names it after that. */
export const NEW_THREAD_TITLE = "New chat";
/** Characters of the last line kept as the thread's preview. */
export const PREVIEW_CHARS = 140;
/** Plain words, no Markdown marks: the list shows it as text. */
export const previewOf = (content: string) => plainText(content).slice(0, PREVIEW_CHARS);

/** Pinned first, then the latest line (creation while empty), newest first. */
export const threadOrder = (a: ChatThread, b: ChatThread) =>
  Number(b.pinned) - Number(a.pinned) ||
  Date.parse(b.last_message_at ?? b.created_at) - Date.parse(a.last_message_at ?? a.created_at);

/** UTC days a summary row must fall in to match a [from, to) range. */
export const summaryDayRange = (from?: string, to?: string) => ({
  from: from ? new Date(from).toISOString().slice(0, 10) : undefined,
  to: to ? new Date(Date.parse(to) - 1).toISOString().slice(0, 10) : undefined,
});

export type NewFocusGuard = Omit<FocusGuard, "id" | "created_at">;

/** A Focus now session as stored (#397); focus/session.ts turns it into the contract's FocusSession. */
export interface StoredFocusSession {
  id: string;
  goal_id: string;
  status: FocusSessionStatus;
  start_at: string;
  end_at: string;
  ended_at: string | null;
  counted_minutes: number | null;
  event_id: string | null;
  /** True when the session made its block (so it may resize it); false for the user's own block. */
  owns_block: boolean;
  block_recommendation_id: string | null;
  guard_recommendation_ids: string[];
  apps: string[];
  log_recommendation_id: string | null;
  message: string | null;
  created_at: string;
}
export type NewFocusSession = Pick<
  StoredFocusSession,
  | "goal_id"
  | "start_at"
  | "end_at"
  | "event_id"
  | "owns_block"
  | "block_recommendation_id"
  | "guard_recommendation_ids"
  | "apps"
>;
export type FocusSessionPatch = Partial<
  Pick<
    StoredFocusSession,
    | "status"
    | "start_at"
    | "end_at"
    | "ended_at"
    | "counted_minutes"
    | "guard_recommendation_ids"
    | "log_recommendation_id"
    | "message"
  >
>;
/** A session whose end has passed, for the background finisher (not scoped to a user). */
export interface DueFocusSession {
  id: string;
  user_id: string;
  visitor_id: string | null;
}
export const ONE_ACTIVE_FOCUS = "You are already in a focus session. End it first.";

export type EventPatch = Partial<Pick<Event, "start_at" | "end_at" | "title" | "data">>;

// JSON with sorted keys, so jsonb's own key order never reads as a change.
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/** True when an upsert would change nothing on the stored event. */
export const sameEvent = (e: Event, i: z.output<typeof EventInput>) =>
  e.type === i.type &&
  e.title === i.title &&
  Date.parse(e.start_at) === Date.parse(i.start_at) &&
  (e.end_at ? Date.parse(e.end_at) : null) === (i.end_at ? Date.parse(i.end_at) : null) &&
  canonical(e.data) === canonical(i.data);

export type NudgeCreate = Omit<Nudge, "id" | "created_at" | "sent_at">;

/** A follow up draft to store; it starts as `proposed`. */
export type NewDraft = Omit<Draft, "id" | "status" | "created_at" | "updated_at">;
/** A new checklist item (#238); the rules (kind, three open, position) are checked in checklist/. */
export type NewChecklistItem = Pick<ChecklistItem, "goal_id" | "date" | "text" | "position"> & {
  carried_from?: string | null;
  linked_goal_id?: string | null;
  estimate_minutes?: number | null;
};
/** What may change on a checklist item. `status` with `settled_at` and `settled_by` together. */
export type ChecklistPatch = Partial<
  Pick<ChecklistItem, "text" | "status" | "settled_at" | "settled_by" | "position" | "logged_minutes">
>;

/** One half of the daily ritual (#318) saved or skipped on a local day. */
export type DayRitual = {
  day: string;
  kind: RitualKind;
  state: "done" | "skipped";
  summary: string | null;
  updated_at: string;
};

/** Items by date, then goal (oldest first), then position. */
export const checklistOrder = (a: ChecklistItem, b: ChecklistItem) =>
  a.date.localeCompare(b.date) ||
  a.goal_id.localeCompare(b.goal_id) ||
  a.position - b.position ||
  a.created_at.localeCompare(b.created_at);

/** A device that turned nudges on (Web Push). Server side only, never sent to the browser. */
export interface PushDevice {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The Telegram chat a user connected for nudges. Server side only. */
export interface TelegramChat {
  chat_id: string;
  username: string | null;
  connected_at: string;
}

// Storage boundary. Routes and MCP tools depend only on this interface.
// MemoryStore is used when Supabase env vars are missing; SupabaseStore (supabase-store.ts) otherwise.
export interface Store extends PrivacyBackend {
  readonly kind: "memory" | "supabase";
  listEvents(filter: TimelineFilter): Promise<Event[]>;
  insertEvents(events: z.output<typeof EventInput>[]): Promise<InsertResult>;
  /** When the newest event of each source arrived (created_at); sources never seen are left out. */
  lastEventAtBySource(): Promise<Partial<Record<Source, string>>>;
  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<Goal | null>;
  createGoal(input: z.output<typeof GoalCreate>): Promise<Goal>;
  updateGoal(id: string, patch: z.output<typeof GoalUpdate>): Promise<Goal | null>;
  deleteGoal(id: string): Promise<boolean>;
  // The onboarding answers (routes/profile.ts fills in defaults); null until first saved.
  getProfile(): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<Profile>;
  // ---- standing instructions (the user's ground rules), oldest first ----
  listInstructions(): Promise<Instruction[]>;
  createInstruction(input: z.output<typeof InstructionCreate>): Promise<Instruction>;
  /** A null in the patch clears `days`, `time` or `end_time`; a missing key leaves it alone. */
  updateInstruction(id: string, patch: z.output<typeof InstructionUpdate>): Promise<Instruction | null>;
  deleteInstruction(id: string): Promise<boolean>;
  listRecommendations(filter?: { status?: RecommendationStatus }): Promise<Recommendation[]>;
  updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Recommendation | null>;
  getRecommendation(id: string): Promise<Recommendation | null>;
  /** The execution record saved by `recordRecommendationAction`, or null. */
  getRecommendationExecution(id: string): Promise<unknown>;
  recordRecommendationAction(id: string, update: RecommendationActionUpdate): Promise<Recommendation | null>;
  latestAnalysisRun(): Promise<AnalysisRun | null>;
  /** The questions Michael asked in earlier analysis runs, newest first. */
  listAnalysisQuestions(limit: number): Promise<AskedQuestion[]>;
  /** Stores one finished analysis run and the recommendations it produced (all `proposed`). */
  saveAnalysis(input: NewAnalysis): Promise<{ run: AnalysisRun; recommendations: Recommendation[] }>;
  // Proposed by Michael's own rules (e.g. travel) or asked for in chat; status starts at proposed.
  createRecommendation(input: NewRecommendation): Promise<Recommendation>;
  /**
   * Takes sample analysis out of the caller's account: every run whose model contains
   * `modelMarker` and the recommendations with these ids. A recommendation of a removed run that
   * is not listed stays, without its run. Only the demo seed calls it (demo/sync.ts).
   */
  removeSampleAnalysis(
    modelMarker: string,
    recommendationIds: string[],
  ): Promise<{ runs: number; recommendations: number }>;
  // Focus guards (block_mac_app): created by executing, deleted by undo (actions/mac-apps.ts).
  createFocusGuard(input: NewFocusGuard): Promise<FocusGuard>;
  deleteFocusGuard(id: string): Promise<boolean>;
  /** Guards that end after `endsAfter` and start before `startsBefore`, soonest first. */
  listFocusGuards(filter: { endsAfter: string; startsBefore: string }): Promise<FocusGuard[]>;
  // ---- Focus now sessions (#397), per demo visitor on the demo account like chat ----
  getActiveFocusSession(): Promise<StoredFocusSession | null>;
  getFocusSession(id: string): Promise<StoredFocusSession | null>;
  /** The newest session, whatever its status. */
  latestFocusSession(): Promise<StoredFocusSession | null>;
  /** 409 (ONE_ACTIVE_FOCUS) when one is already active. */
  createFocusSession(input: NewFocusSession): Promise<StoredFocusSession>;
  /** `onlyActive`: change it only while it is still active (so two enders never both win). */
  updateFocusSession(
    id: string,
    patch: FocusSessionPatch,
    opts?: { onlyActive?: boolean },
  ): Promise<StoredFocusSession | null>;
  /** NOT scoped: active sessions of any user that end at or before `before`. Only the finisher. */
  dueFocusSessions(before: string): Promise<DueFocusSession[]>;
  /**
   * Deletes every session of the current user (all visitors). Only the demo reseed uses it. The ids
   * of the blocks those sessions made, so the reseed can take them off the demo day too.
   */
  clearFocusSessions(): Promise<string[]>;
  // Saved places (home, work, gym). replacePlaces swaps the whole list.
  listPlaces(): Promise<Place[]>;
  replacePlaces(places: Omit<Place, "updated_at">[]): Promise<Place[]>;
  // Geocoding cache, per user, keyed by the normalised query (integrations/maps.ts).
  cachedGeocode(query: string): Promise<GeocodeHit | null>;
  saveGeocode(query: string, hit: GeocodeHit): Promise<void>;
  // Privacy (privacy.ts holds the rules; insertEvents applies them).
  setOffTheRecord(on: boolean): Promise<PrivacyRules>;
  /**
   * Chat threads, pinned first then latest activity first. Chat is per demo visitor on the demo
   * account (`currentDemoVisitor()`): a visitor sees only their own threads and lines, everyone
   * else only the account's own (visitor null). `q` matches titles and line text.
   */
  listChatThreads(opts?: { archived?: boolean; q?: string; limit?: number }): Promise<ChatThread[]>;
  getChatThread(id: string): Promise<ChatThread | null>;
  createChatThread(title?: string): Promise<ChatThread>;
  updateChatThread(id: string, patch: ChatThreadChange): Promise<ChatThread | null>;
  /** Deletes the thread and every line in it. The number of lines, or null when not found. */
  deleteChatThread(id: string): Promise<number | null>;
  /** The most recent lines of one thread, oldest first. Empty for someone else's thread. */
  listChatMessages(threadId: string, limit: number): Promise<ChatMessage[]>;
  /**
   * Adds a line to one of the caller's threads and moves the thread's preview and time.
   * `actionIds`: recommendations done or undone while writing an answer (ChatMessage.action_ids).
   */
  addChatMessage(
    threadId: string,
    role: ChatRole,
    content: string,
    actionIds?: string[],
  ): Promise<ChatMessage>;
  /** Deletes the current user's demo visitor threads (and lines) last active at or before `before`. */
  clearVisitorChat(before: string): Promise<number>;
  // Follow up drafts (actions/drafts.ts), newest first. Never sent anywhere.
  listDrafts(filter?: { status?: DraftStatus }): Promise<Draft[]>;
  /** Null when that event already has a draft (one per event). */
  createDraft(input: NewDraft): Promise<Draft | null>;
  updateDraftStatus(id: string, status: DraftStatus): Promise<Draft | null>;
  /** Deletes the caller's drafts with these ids. Only the demo seed calls it (actions/drafts.ts). */
  deleteDrafts(ids: string[]): Promise<number>;

  // ---- events mirrored from a provider (Google Calendar) ----
  getEvent(id: string): Promise<Event | null>;
  /** Insert or update by (source, external_id); every input must carry an external_id. */
  upsertEvents(events: z.output<typeof EventInput>[]): Promise<UpsertResult>;
  updateEvent(id: string, patch: EventPatch): Promise<Event | null>;
  /** Only for provider mirrors and blocks Michael created; never for the user's own records. */
  deleteEvents(ids: string[]): Promise<number>;

  // ---- integrations (OAuth tokens) ----
  listIntegrations(): Promise<IntegrationRecord[]>;
  getIntegration(provider: IntegrationProvider): Promise<IntegrationRecord | null>;
  saveIntegration(provider: IntegrationProvider, patch: IntegrationPatch): Promise<IntegrationRecord>;
  /** Not scoped to the current user: only the background sync uses it, then acts as each user. */
  listConnectedUserIds(provider: IntegrationProvider): Promise<string[]>;
  /** Nudges created in [from, to), oldest first. */
  listNudges(filter: { from: string; to: string }): Promise<Nudge[]>;
  /** Null when this key was already used on that day (the dedupe guard). */
  createNudge(input: NudgeCreate): Promise<Nudge | null>;
  updateNudgeStatus(id: string, status: NudgeStatus): Promise<Nudge | null>;
  // Web Push devices of the current user.
  listPushDevices(): Promise<PushDevice[]>;
  /** Saves the device for the current user (a device belongs to whoever subscribed it last). */
  savePushDevice(device: PushDevice, userAgent: string | null): Promise<void>;
  removePushDevice(endpoint: string): Promise<void>;
  // The Telegram chat of the current user (nudges/telegram.ts), null when none is bound.
  getTelegramChat(): Promise<TelegramChat | null>;
  /**
   * Binds the chat to the current user (a chat belongs to whoever bound it last). `link` is the
   * start token: "used" when that same token already bound a chat once, so each link works once.
   */
  bindTelegramChat(
    chat: { chat_id: string; username: string | null },
    link: string,
  ): Promise<"bound" | "used">;
  /** False when nothing was bound. */
  unbindTelegramChat(): Promise<boolean>;
  /** NOT scoped: the webhook only knows the chat. Whose chat this is, or null. */
  telegramChatOwner(chatId: string): Promise<string | null>;

  // ---- checklist items (#238), the day's outcomes of a checklist goal ----
  /** Items with `date` in [from, to] (local days, inclusive), by date, goal and position. */
  listChecklist(filter: { from: string; to: string }): Promise<ChecklistItem[]>;
  getChecklistItem(id: string): Promise<ChecklistItem | null>;
  /** 409 when the goal already has an open item at that position on that day. */
  createChecklistItem(input: NewChecklistItem): Promise<ChecklistItem>;
  /**
   * The one write for an item's text and status, used by the routes, the MCP tools and the
   * evening check in (#187, `settled_by: "check_in"`). Null when there is no such item.
   */
  updateChecklistItem(id: string, patch: ChecklistPatch): Promise<ChecklistItem | null>;
  deleteChecklistItem(id: string): Promise<boolean>;

  // ---- the daily ritual (#318): which halves were saved or skipped ----
  /** Rows with `day` in [from, to] (local days, inclusive). */
  listRituals(filter: { from: string; to: string }): Promise<DayRitual[]>;
  /** Insert or replace the row for that day and half. */
  saveRitual(row: Omit<DayRitual, "updated_at">): Promise<DayRitual>;
  /** Deletes the rows with `day` in [from, to]. Only the demo reseed uses it (back to the plan). */
  clearRituals(filter: { from: string; to: string }): Promise<number>;

  // ---- weekly targets (#165), one per Monday ----
  /** Stored targets with `week_start` in [from, to] (local days), oldest first. */
  listTargets(from: string, to: string): Promise<WeeklyTarget[]>;
  /** Insert or replace the week's target; `created_at` stays from the first save. */
  saveTarget(target: TargetInput): Promise<WeeklyTarget>;

  // ---- personal records (#166) ----
  /** Every record of the current user, oldest first. */
  listRecords(): Promise<PersonalRecord[]>;
  /** Stores new records; a `key` already stored is skipped, so a period sets a record once. */
  insertRecords(records: NewRecord[]): Promise<PersonalRecord[]>;
  /** Sets `announced_at` the first time; null when there is no such record. */
  markRecordAnnounced(id: string): Promise<PersonalRecord | null>;
  /**
   * The one read that is NOT scoped to the current user: ids of users with events received since
   * `since`. Only the scheduler calls it, outside any request, and then runs each check as that user.
   */
  activeUserIds(since: string): Promise<string[]>;

  // Seeding (the demo week, src/demo). Makes the current user's events whose external_id starts
  // with `prefix` and whose source is in `sources` exactly `events`: missing ones are inserted,
  // ones no longer listed are removed. Events without the prefix or of other sources are never
  // touched. No privacy screening here: the caller decides which sources to pass.
  syncSeededEvents(
    prefix: string,
    sources: Source[],
    events: z.output<typeof EventInput>[],
  ): Promise<SeedResult>;
  // Writes goals with their fixed ids. `overwrite: false` only adds the missing ones.
  seedGoals(goals: Goal[], opts: { overwrite: boolean }): Promise<number>;

  // ---- your data: deletion and retention (#47, retention.ts) ----
  /**
   * Really deletes the current user's rows. `everything`: every table that holds the user's data
   * (device keys are deleted by tokens.ts, the auth user by auth.ts). Otherwise only the events and
   * summaries matching source and [from, to).
   */
  deleteMyData(scope: DataDeleteScope): Promise<DeleteCounts>;
  /** The current user's events that started before `before`, oldest first, at most `limit`. */
  listEventsBefore(before: string, limit: number): Promise<Event[]>;
  /** Adds these totals onto the current user's summaries (same day, source, type, category). */
  addEventSummaries(rows: EventSummary[]): Promise<void>;
  listEventSummaries(): Promise<EventSummary[]>;
  /** NOT scoped: users with events that started before `before`. Only the retention job calls it. */
  usersWithEventsBefore(before: string): Promise<string[]>;

  // ---- check in (#187) ----
  /** The current user's check in questions for days in [fromDay, toDay], oldest first. */
  listCheckIns(filter: { fromDay: string; toDay: string }): Promise<StoredCheckIn[]>;
  /** Stores new questions; a key the user already has is skipped. Returns the ones stored. */
  createCheckIns(rows: NewCheckIn[]): Promise<StoredCheckIn[]>;
  getCheckIn(id: string): Promise<StoredCheckIn | null>;
  answerCheckIn(
    id: string,
    answer: { answer: CheckInValue; label: string | null },
  ): Promise<StoredCheckIn | null>;
  /** Really deletes one question and its answer (and its follow ups). */
  deleteCheckIn(id: string): Promise<boolean>;
}

export type TargetInput = Omit<WeeklyTarget, "created_at" | "updated_at">;

/** A check in question as stored: the public shape plus its per day key. */
export type StoredCheckIn = CheckIn & { key: string };
export type NewCheckIn = Omit<StoredCheckIn, "id" | "asked_at" | "answered_at" | "answer" | "label">;

export const newCheckIn = (row: NewCheckIn): StoredCheckIn => ({
  ...row,
  id: crypto.randomUUID(),
  answer: null,
  label: null,
  asked_at: new Date().toISOString(),
  answered_at: null,
});

export interface AskedQuestion {
  question: string;
  asked_at: string;
}

export interface NewAnalysis {
  run: Omit<AnalysisRun, "id">;
  recommendations: Pick<
    Recommendation,
    "goal_id" | "title" | "rationale" | "action" | "evidence" | "specialist"
  >[];
}

export const emptyIntegration = (provider: IntegrationProvider): IntegrationRecord => ({
  provider,
  status: "disconnected",
  account: null,
  connected_at: null,
  last_sync_at: null,
  error: null,
  access_token: null,
  refresh_token: null,
  expires_at: null,
  scope: null,
});

/** An instruction as the contract has it: `days`, `time` and `end_time` are left out when not set. */
export const toInstruction = (r: {
  id: string;
  text: string;
  kind: Instruction["kind"];
  days?: number[] | null;
  time?: string | null;
  end_time?: string | null;
  exceptions?: string[] | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}): Instruction => ({
  id: r.id,
  text: r.text,
  kind: r.kind,
  ...(r.days?.length ? { days: [...r.days].sort((a, b) => a - b) } : {}),
  ...(r.time ? { time: r.time } : {}),
  ...(r.end_time ? { end_time: r.end_time } : {}),
  ...(r.exceptions?.length ? { exceptions: [...r.exceptions] } : {}),
  active: r.active,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const now = () => new Date().toISOString();
const overlaps = (e: Event, from: number, to: number) => {
  const start = Date.parse(e.start_at);
  const end = e.end_at ? Date.parse(e.end_at) : start;
  return start <= to && end >= from;
};

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  // One copy of the mock day per user, created on first access, so users never see each other's data.
  // The demo account starts empty instead: the demo week (src/demo) fills it on its first request.
  private data = new Map<
    string,
    {
      events: Event[];
      goals: Goal[];
      instructions: Instruction[];
      recommendations: Recommendation[];
      runs: AnalysisRun[];
      privacy: PrivacyRules;
      chat: (ChatMessage & { visitor: string | null; thread: string })[];
      threads: (ChatThread & { visitor: string | null })[];
      drafts: Draft[];
      integrations: IntegrationRecord[];
      nudges: Nudge[];
      push: PushDevice[];
      telegram: (Partial<TelegramChat> & { last_link?: string }) | null;
      executions: Map<string, unknown>;
      places: Place[];
      geocodes: Map<string, GeocodeHit>;
      summaries: EventSummary[];
      guards: FocusGuard[];
      focus: (StoredFocusSession & { visitor: string | null })[];
      targets: WeeklyTarget[];
      records: (PersonalRecord & { key: string })[];
      checkIns: StoredCheckIn[];
      checklist: ChecklistItem[];
      rituals: DayRitual[];
    }
  >();
  private fresh(sample: boolean) {
    return {
      events: sample ? structuredClone(mockEvents) : [],
      goals: sample ? structuredClone(mockGoals) : [],
      instructions: sample ? structuredClone(mockInstructions) : [],
      recommendations: sample ? [...structuredClone(mockRecommendations), ...demoRecommendations()] : [],
      runs: sample ? [structuredClone(mockAnalysisRun)] : [],
      privacy: { offTheRecord: false, since: null, sources: {} } as PrivacyRules,
      chat: [] as (ChatMessage & { visitor: string | null; thread: string })[],
      threads: [] as (ChatThread & { visitor: string | null })[],
      drafts: [] as Draft[],
      integrations: [] as IntegrationRecord[],
      nudges: [] as Nudge[],
      push: [] as PushDevice[],
      telegram: null as (Partial<TelegramChat> & { last_link?: string }) | null,
      executions: new Map<string, unknown>(),
      places: [] as Place[],
      geocodes: new Map<string, GeocodeHit>(),
      summaries: [] as EventSummary[],
      guards: [] as FocusGuard[],
      focus: [] as (StoredFocusSession & { visitor: string | null })[],
      targets: [] as WeeklyTarget[],
      records: [] as (PersonalRecord & { key: string })[],
      checkIns: [] as StoredCheckIn[],
      checklist: [] as ChecklistItem[],
      rituals: [] as DayRitual[],
    };
  }
  private get d() {
    const userId = currentUserId();
    let x = this.data.get(userId);
    if (!x) {
      const demo = userId === env.DEMO_USER_ID && env.DEMO_WEEK === "on";
      // The demo week brings its own events and goals, and never the sample brief ("gemini (mock)")
      // or the sample day's suggestions: only the suggestions that hold on the demo week.
      x = {
        ...this.fresh(true),
        ...(demo ? { events: [], goals: [], runs: [], recommendations: demoWeekRecommendations() } : {}),
      };
      this.data.set(userId, x);
    }
    return x;
  }
  private get events() {
    return this.d.events;
  }
  private get goals() {
    return this.d.goals;
  }
  private set goals(v: Goal[]) {
    this.d.goals = v;
  }
  private get recommendations() {
    return this.d.recommendations;
  }
  private get runs() {
    return this.d.runs;
  }

  async listEvents(f: TimelineFilter) {
    const from = Date.parse(f.from);
    const to = Date.parse(f.to);
    return this.events
      .filter((e) => overlaps(e, from, to))
      .filter((e) => !f.source || f.source.includes(e.source))
      .filter((e) => !f.type || f.type.includes(e.type))
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  }

  async lastEventAtBySource() {
    const out: Partial<Record<Source, string>> = {};
    for (const e of this.events) {
      const was = out[e.source];
      if (!was || Date.parse(e.created_at) > Date.parse(was)) out[e.source] = e.created_at;
    }
    return out;
  }

  async privacyRules() {
    return structuredClone(this.d.privacy);
  }

  async setOffTheRecord(on: boolean) {
    const p = this.d.privacy;
    if (on !== p.offTheRecord) {
      p.offTheRecord = on;
      p.since = on ? now() : null;
    }
    return structuredClone(p);
  }

  async setSourceEnabled(source: Source, enabled: boolean): Promise<SourceSetting> {
    const setting = { enabled, updated_at: now() };
    this.d.privacy.sources[source] = setting;
    return { source, ...setting };
  }

  async insertEvents(all: z.output<typeof EventInput>[]) {
    const { allowed: inputs, ignored } = await screenEvents(this, all);
    const inserted: Event[] = [];
    let duplicates = 0;
    for (const i of inputs) {
      const ext = i.external_id ?? null;
      if (ext && this.events.some((e) => e.source === i.source && e.external_id === ext)) {
        duplicates++;
        continue;
      }
      const event: Event = {
        id: crypto.randomUUID(),
        source: i.source,
        type: i.type,
        start_at: i.start_at,
        end_at: i.end_at ?? null,
        title: i.title,
        data: i.data,
        external_id: ext,
        created_at: now(),
      };
      this.events.push(event);
      inserted.push(event);
    }
    return { inserted, duplicates, ignored };
  }

  async listGoals() {
    return this.goals;
  }

  async getGoal(id: string) {
    return this.goals.find((g) => g.id === id) ?? null;
  }

  async createGoal(i: z.output<typeof GoalCreate>) {
    const goal: Goal = {
      id: crypto.randomUUID(),
      category: i.category,
      title: i.title,
      description: i.description ?? null,
      target: i.target ?? null,
      weekly_budget_minutes: i.weekly_budget_minutes ?? null,
      active: i.active,
      created_at: now(),
      updated_at: now(),
    };
    this.goals.push(goal);
    return goal;
  }

  async updateGoal(id: string, patch: z.output<typeof GoalUpdate>) {
    const goal = this.goals.find((g) => g.id === id);
    if (!goal) return null;
    Object.assign(goal, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    goal.updated_at = now();
    return goal;
  }

  async deleteGoal(id: string) {
    const before = this.goals.length;
    this.goals = this.goals.filter((g) => g.id !== id);
    // As the foreign key's cascade does in Postgres.
    this.d.checklist = this.d.checklist.filter((i) => i.goal_id !== id);
    // ON DELETE SET NULL on linked_goal_id (#318).
    for (const i of this.d.checklist) if (i.linked_goal_id === id) i.linked_goal_id = null;
    return this.goals.length < before;
  }

  private profiles = new Map<string, Profile>();

  async getProfile() {
    return structuredClone(this.profiles.get(currentUserId()) ?? null);
  }

  async saveProfile(profile: Profile) {
    this.profiles.set(currentUserId(), structuredClone(profile));
    return structuredClone(profile);
  }

  async listInstructions() {
    return this.d.instructions;
  }

  async createInstruction(i: z.output<typeof InstructionCreate>) {
    const instruction = toInstruction({
      id: crypto.randomUUID(),
      ...i,
      created_at: now(),
      updated_at: now(),
    });
    this.d.instructions.push(instruction);
    return instruction;
  }

  async updateInstruction(id: string, patch: z.output<typeof InstructionUpdate>) {
    const list = this.d.instructions;
    const at = list.findIndex((i) => i.id === id);
    const found = list[at];
    if (!found) return null;
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const updated = toInstruction({ ...found, ...changes, updated_at: now() });
    list[at] = updated;
    return updated;
  }

  async deleteInstruction(id: string) {
    const d = this.d;
    const before = d.instructions.length;
    d.instructions = d.instructions.filter((i) => i.id !== id);
    return d.instructions.length < before;
  }

  async listRecommendations(filter?: { status?: RecommendationStatus }) {
    return this.recommendations.filter((r) => !filter?.status || r.status === filter.status);
  }

  async getRecommendation(id: string) {
    return this.recommendations.find((r) => r.id === id) ?? null;
  }

  async createRecommendation(input: NewRecommendation) {
    // The choke point: nothing is proposed inside time a standing instruction protects.
    const i = await guardRecommendation(input, this.guardDeps());
    const rec: Recommendation = {
      id: crypto.randomUUID(),
      analysis_run_id: i.analysis_run_id ?? null,
      goal_id: i.goal_id,
      title: i.title,
      rationale: i.rationale,
      action: i.action,
      status: "proposed",
      executed_at: null,
      undone_at: null,
      source: i.source ?? "analysis",
      created_at: now(),
      updated_at: now(),
    };
    this.recommendations.push(rec);
    return rec;
  }

  async getRecommendationExecution(id: string) {
    return this.d.executions.get(id) ?? null;
  }

  async recordRecommendationAction(id: string, u: RecommendationActionUpdate) {
    const rec = this.recommendations.find((r) => r.id === id);
    if (!rec) return null;
    rec.status = u.status;
    if (u.executed_at !== undefined) rec.executed_at = u.executed_at;
    if (u.undone_at !== undefined) rec.undone_at = u.undone_at;
    if (u.execution !== undefined) this.d.executions.set(id, u.execution);
    rec.updated_at = now();
    return rec;
  }

  async updateRecommendationStatus(id: string, status: RecommendationStatus) {
    const rec = this.recommendations.find((r) => r.id === id);
    if (!rec) return null;
    rec.status = status;
    rec.updated_at = now();
    return rec;
  }

  async removeSampleAnalysis(modelMarker: string, recommendationIds: string[]) {
    const d = this.d;
    const runs = new Set(d.runs.filter((r) => r.model.includes(modelMarker)).map((r) => r.id));
    const ids = new Set(recommendationIds);
    const before = d.recommendations.length;
    d.recommendations = d.recommendations.filter((r) => !ids.has(r.id));
    // As in Postgres (on delete set null): a recommendation outlives its run.
    for (const r of d.recommendations) {
      if (r.analysis_run_id && runs.has(r.analysis_run_id)) r.analysis_run_id = null;
    }
    d.runs = d.runs.filter((r) => !runs.has(r.id));
    return { runs: runs.size, recommendations: before - d.recommendations.length };
  }

  async latestAnalysisRun() {
    return this.runs.at(-1) ?? null;
  }

  async listAnalysisQuestions(limit: number) {
    return this.runs
      .flatMap((r) => (r.question ? [{ question: r.question, asked_at: r.started_at }] : []))
      .reverse()
      .slice(0, limit);
  }

  /** What instructions/guard.ts needs to check a new recommendation: the rules and the blocks. */
  private guardDeps() {
    return { instructions: this.d.instructions, getEvent: (id: string) => this.getEvent(id) };
  }

  async saveAnalysis(input: NewAnalysis) {
    const run: AnalysisRun = { id: crypto.randomUUID(), ...input.run };
    const guarded = await guardRecommendations(input.recommendations, this.guardDeps());
    this.runs.push(run);
    const at = run.finished_at ?? now();
    const recommendations = guarded.map(
      (r): Recommendation => ({
        id: crypto.randomUUID(),
        analysis_run_id: run.id,
        goal_id: r.goal_id,
        title: r.title,
        rationale: r.rationale,
        action: r.action,
        evidence: r.evidence ?? [],
        ...(r.specialist ? { specialist: r.specialist } : {}),
        status: "proposed",
        executed_at: null,
        undone_at: null,
        created_at: at,
        updated_at: at,
      }),
    );
    this.recommendations.push(...recommendations);
    return { run, recommendations };
  }

  /** The caller's own threads: the account's, or this demo visitor's. */
  private ownThreads() {
    const visitor = currentDemoVisitor();
    return this.d.threads.filter((t) => t.visitor === visitor);
  }

  private ownThread(id: string) {
    return this.ownThreads().find((t) => t.id === id) ?? null;
  }

  async listChatThreads(opts: { archived?: boolean; q?: string; limit?: number } = {}) {
    const q = opts.q?.trim().toLowerCase();
    const hits = q
      ? new Set(this.d.chat.filter((m) => m.content.toLowerCase().includes(q)).map((m) => m.thread))
      : null;
    return this.ownThreads()
      .filter((t) => t.archived === (opts.archived ?? false))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || hits?.has(t.id))
      .map(({ visitor: _v, ...t }): ChatThread => ({ ...t }))
      .sort(threadOrder)
      .slice(0, opts.limit ?? 100);
  }

  async getChatThread(id: string) {
    const t = this.ownThread(id);
    if (!t) return null;
    const { visitor: _v, ...thread } = t;
    return { ...thread };
  }

  async createChatThread(title?: string) {
    const at = now();
    const thread: ChatThread = {
      id: crypto.randomUUID(),
      title: title ?? NEW_THREAD_TITLE,
      pinned: false,
      archived: false,
      preview: null,
      last_message_at: null,
      created_at: at,
      updated_at: at,
    };
    this.d.threads.push({ ...thread, visitor: currentDemoVisitor() });
    return { ...thread };
  }

  async updateChatThread(id: string, patch: ChatThreadChange) {
    const t = this.ownThread(id);
    if (!t) return null;
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    Object.assign(t, changes, { updated_at: now() });
    return this.getChatThread(id);
  }

  async deleteChatThread(id: string) {
    const d = this.d;
    if (!this.ownThread(id)) return null;
    const before = d.chat.length;
    d.chat = d.chat.filter((m) => m.thread !== id);
    d.threads = d.threads.filter((t) => t.id !== id);
    return before - d.chat.length;
  }

  async listChatMessages(threadId: string, limit: number) {
    if (!this.ownThread(threadId)) return [];
    return this.d.chat
      .filter((m) => m.thread === threadId)
      .slice(-limit)
      .map(({ visitor: _v, thread: _t, ...m }): ChatMessage => m);
  }

  async addChatMessage(threadId: string, role: ChatRole, content: string, actionIds: string[] = []) {
    const thread = this.ownThread(threadId);
    if (!thread) throw new HttpError("not_found", "Chat thread not found");
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      created_at: now(),
      action_ids: [...actionIds],
    };
    this.d.chat.push({ ...message, visitor: currentDemoVisitor(), thread: threadId });
    Object.assign(thread, {
      preview: previewOf(content),
      last_message_at: message.created_at,
      updated_at: message.created_at,
    });
    return message;
  }

  async clearVisitorChat(before: string) {
    const d = this.d;
    const cut = Date.parse(before);
    const gone = new Set(
      d.threads
        .filter((t) => t.visitor !== null && Date.parse(t.last_message_at ?? t.created_at) <= cut)
        .map((t) => t.id),
    );
    d.threads = d.threads.filter((t) => !gone.has(t.id));
    const kept = d.chat.filter((m) => !gone.has(m.thread));
    const removed = d.chat.length - kept.length;
    d.chat = kept;
    return removed;
  }

  async listDrafts(filter?: { status?: DraftStatus }) {
    return this.d.drafts
      .filter((x) => !filter?.status || x.status === filter.status)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  async createDraft(input: NewDraft) {
    if (input.event_id && this.d.drafts.some((x) => x.event_id === input.event_id)) return null;
    const at = now();
    const draft: Draft = {
      ...input,
      id: crypto.randomUUID(),
      status: "proposed",
      created_at: at,
      updated_at: at,
    };
    this.d.drafts.push(draft);
    return draft;
  }

  async updateDraftStatus(id: string, status: DraftStatus) {
    const draft = this.d.drafts.find((x) => x.id === id);
    if (!draft) return null;
    draft.status = status;
    draft.updated_at = now();
    return draft;
  }

  async deleteDrafts(ids: string[]) {
    const d = this.d;
    const gone = new Set(ids);
    const before = d.drafts.length;
    d.drafts = d.drafts.filter((x) => !gone.has(x.id));
    return before - d.drafts.length;
  }

  async getEvent(id: string) {
    return this.events.find((e) => e.id === id) ?? null;
  }

  async upsertEvents(inputs: z.output<typeof EventInput>[]) {
    const result: UpsertResult = { inserted: [], updated: [], unchanged: 0 };
    for (const i of inputs) {
      const found = this.events.find((e) => e.source === i.source && e.external_id === i.external_id);
      if (!found) {
        result.inserted.push(...(await this.insertEvents([i])).inserted);
      } else if (sameEvent(found, i)) {
        result.unchanged++;
      } else {
        Object.assign(found, {
          type: i.type,
          title: i.title,
          start_at: i.start_at,
          end_at: i.end_at ?? null,
        });
        found.data = i.data;
        result.updated.push(found);
      }
    }
    return result;
  }

  async updateEvent(id: string, patch: EventPatch) {
    const e = this.events.find((x) => x.id === id);
    if (!e) return null;
    Object.assign(e, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return e;
  }

  async deleteEvents(ids: string[]) {
    const d = this.d;
    const before = d.events.length;
    d.events = d.events.filter((e) => !ids.includes(e.id));
    return before - d.events.length;
  }

  async listIntegrations() {
    return this.d.integrations;
  }

  async getIntegration(provider: IntegrationProvider) {
    return this.d.integrations.find((i) => i.provider === provider) ?? null;
  }

  async saveIntegration(provider: IntegrationProvider, patch: IntegrationPatch) {
    let rec = this.d.integrations.find((i) => i.provider === provider);
    if (!rec) {
      rec = emptyIntegration(provider);
      this.d.integrations.push(rec);
    }
    Object.assign(rec, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return rec;
  }

  async listConnectedUserIds(provider: IntegrationProvider) {
    return [...this.data.entries()]
      .filter(([, x]) => x.integrations.some((i) => i.provider === provider && i.status === "connected"))
      .map(([userId]) => userId);
  }

  async listNudges(f: { from: string; to: string }) {
    const from = Date.parse(f.from);
    const to = Date.parse(f.to);
    return this.d.nudges.filter((n) => {
      const t = Date.parse(n.created_at);
      return t >= from && t < to;
    });
  }

  async createNudge(i: NudgeCreate) {
    if (this.d.nudges.some((n) => n.day === i.day && n.key === i.key)) return null;
    const nudge: Nudge = { ...i, id: crypto.randomUUID(), created_at: now(), sent_at: null };
    this.d.nudges.push(nudge);
    return nudge;
  }

  async updateNudgeStatus(id: string, status: NudgeStatus) {
    const nudge = this.d.nudges.find((n) => n.id === id);
    if (!nudge) return null;
    nudge.status = status;
    if (status === "sent") nudge.sent_at = now();
    return nudge;
  }

  async listPushDevices() {
    return structuredClone(this.d.push);
  }

  async savePushDevice(device: PushDevice) {
    // The endpoint moves to the current user, as in the database's unique index.
    for (const x of this.data.values()) x.push = x.push.filter((p) => p.endpoint !== device.endpoint);
    this.d.push.push(structuredClone(device));
  }

  async removePushDevice(endpoint: string) {
    this.d.push = this.d.push.filter((p) => p.endpoint !== endpoint);
  }

  async getTelegramChat() {
    const t = this.d.telegram;
    if (!t?.chat_id) return null;
    return { chat_id: t.chat_id, username: t.username ?? null, connected_at: t.connected_at ?? now() };
  }

  async bindTelegramChat(chat: { chat_id: string; username: string | null }, link: string) {
    const d = this.d;
    if (d.telegram?.last_link === link) return "used" as const;
    // The chat moves to the current user, as in the database's unique index.
    for (const x of this.data.values()) {
      if (x !== d && x.telegram?.chat_id === chat.chat_id) x.telegram = { last_link: x.telegram.last_link };
    }
    d.telegram = { ...chat, connected_at: now(), last_link: link };
    return "bound" as const;
  }

  async unbindTelegramChat() {
    const d = this.d;
    if (!d.telegram?.chat_id) return false;
    d.telegram = { last_link: d.telegram.last_link };
    return true;
  }

  async telegramChatOwner(chatId: string) {
    for (const [userId, x] of this.data) if (x.telegram?.chat_id === chatId) return userId;
    return null;
  }

  async activeUserIds(since: string) {
    const from = Date.parse(since);
    return [...this.data.entries()]
      .filter(([, x]) => x.events.some((e) => Date.parse(e.created_at) >= from))
      .map(([userId]) => userId);
  }

  async createFocusGuard(input: NewFocusGuard) {
    const guard: FocusGuard = { ...structuredClone(input), id: crypto.randomUUID(), created_at: now() };
    this.d.guards.push(guard);
    return structuredClone(guard);
  }

  async deleteFocusGuard(id: string) {
    const before = this.d.guards.length;
    this.d.guards = this.d.guards.filter((g) => g.id !== id);
    return this.d.guards.length < before;
  }

  async listFocusGuards(f: { endsAfter: string; startsBefore: string }) {
    const after = Date.parse(f.endsAfter);
    const before = Date.parse(f.startsBefore);
    return structuredClone(
      this.d.guards
        .filter((g) => Date.parse(g.end_at) > after && Date.parse(g.start_at) < before)
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)),
    );
  }

  private ownFocus() {
    const visitor = currentDemoVisitor();
    return this.d.focus.filter((f) => f.visitor === visitor);
  }

  private publicFocus(f: (StoredFocusSession & { visitor: string | null }) | undefined) {
    if (!f) return null;
    const { visitor: _visitor, ...rest } = f;
    return structuredClone(rest);
  }

  async getActiveFocusSession() {
    return this.publicFocus(this.ownFocus().find((f) => f.status === "active"));
  }

  async getFocusSession(id: string) {
    return this.publicFocus(this.ownFocus().find((f) => f.id === id));
  }

  async latestFocusSession() {
    const all = [...this.ownFocus()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return this.publicFocus(all[0]);
  }

  async createFocusSession(input: NewFocusSession) {
    if (this.ownFocus().some((f) => f.status === "active")) throw new HttpError("conflict", ONE_ACTIVE_FOCUS);
    const row = {
      ...structuredClone(input),
      id: crypto.randomUUID(),
      status: "active" as const,
      ended_at: null,
      counted_minutes: null,
      log_recommendation_id: null,
      message: null,
      created_at: now(),
      visitor: currentDemoVisitor(),
    };
    this.d.focus.push(row);
    return this.publicFocus(row) as StoredFocusSession;
  }

  async updateFocusSession(id: string, patch: FocusSessionPatch, opts: { onlyActive?: boolean } = {}) {
    const row = this.ownFocus().find((f) => f.id === id);
    if (!row || (opts.onlyActive && row.status !== "active")) return null;
    Object.assign(row, structuredClone(patch));
    return this.publicFocus(row);
  }

  async dueFocusSessions(before: string) {
    const t = Date.parse(before);
    const out: DueFocusSession[] = [];
    for (const [userId, x] of this.data)
      for (const f of x.focus)
        if (f.status === "active" && Date.parse(f.end_at) <= t)
          out.push({ id: f.id, user_id: userId, visitor_id: f.visitor });
    return out;
  }

  async clearFocusSessions() {
    const blocks = this.d.focus.flatMap((f) => (f.owns_block && f.event_id ? [f.event_id] : []));
    this.d.focus = [];
    return blocks;
  }

  async listChecklist(f: { from: string; to: string }) {
    return this.d.checklist
      .filter((i) => i.date >= f.from && i.date <= f.to)
      .sort(checklistOrder)
      .map((i) => structuredClone(i));
  }

  async getChecklistItem(id: string) {
    const item = this.d.checklist.find((i) => i.id === id);
    return item ? structuredClone(item) : null;
  }

  async createChecklistItem(input: NewChecklistItem) {
    // The unique index on open items in the migration, kept here too.
    const taken = this.d.checklist.some(
      (i) =>
        i.goal_id === input.goal_id &&
        i.date === input.date &&
        i.status === "open" &&
        i.position === input.position,
    );
    if (taken) throw new HttpError("conflict", "That slot of the day is taken");
    const item: ChecklistItem = {
      id: crypto.randomUUID(),
      goal_id: input.goal_id,
      date: input.date,
      text: input.text,
      position: input.position,
      status: "open",
      settled_at: null,
      settled_by: null,
      carried_from: input.carried_from ?? null,
      linked_goal_id: input.linked_goal_id ?? null,
      estimate_minutes: input.estimate_minutes ?? null,
      logged_minutes: null,
      created_at: now(),
      updated_at: now(),
    };
    this.d.checklist.push(item);
    return structuredClone(item);
  }

  async updateChecklistItem(id: string, patch: ChecklistPatch) {
    const item = this.d.checklist.find((i) => i.id === id);
    if (!item) return null;
    Object.assign(item, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    item.updated_at = now();
    return structuredClone(item);
  }

  async deleteChecklistItem(id: string) {
    const d = this.d;
    const before = d.checklist.length;
    d.checklist = d.checklist.filter((i) => i.id !== id);
    // ON DELETE SET NULL on carried_from.
    for (const i of d.checklist) if (i.carried_from === id) i.carried_from = null;
    return d.checklist.length < before;
  }

  async listRituals(f: { from: string; to: string }) {
    return structuredClone(this.d.rituals.filter((r) => r.day >= f.from && r.day <= f.to));
  }

  async saveRitual(row: Omit<DayRitual, "updated_at">) {
    const d = this.d;
    const saved: DayRitual = { ...row, updated_at: now() };
    d.rituals = [...d.rituals.filter((r) => !(r.day === row.day && r.kind === row.kind)), saved];
    return structuredClone(saved);
  }

  async clearRituals(f: { from: string; to: string }) {
    const d = this.d;
    const before = d.rituals.length;
    d.rituals = d.rituals.filter((r) => r.day < f.from || r.day > f.to);
    return before - d.rituals.length;
  }

  async listTargets(from: string, to: string) {
    return structuredClone(
      this.d.targets
        .filter((t) => t.week_start >= from && t.week_start <= to)
        .sort((a, b) => (a.week_start < b.week_start ? -1 : 1)),
    );
  }

  async saveTarget(input: TargetInput) {
    const d = this.d;
    const found = d.targets.find((t) => t.week_start === input.week_start);
    const target: WeeklyTarget = {
      ...structuredClone(input),
      created_at: found?.created_at ?? now(),
      updated_at: now(),
    };
    d.targets = [...d.targets.filter((t) => t.week_start !== input.week_start), target];
    return structuredClone(target);
  }

  async listRecords() {
    return this.d.records.map(({ key: _key, ...r }) => structuredClone(r));
  }

  async insertRecords(records: NewRecord[]) {
    const d = this.d;
    const out: PersonalRecord[] = [];
    for (const r of records) {
      if (d.records.some((x) => x.key === r.key)) continue;
      const row = { ...structuredClone(r), id: crypto.randomUUID(), announced_at: null, created_at: now() };
      d.records.push(row);
      const { key: _key, ...record } = row;
      out.push(record);
    }
    return out;
  }

  async markRecordAnnounced(id: string) {
    const row = this.d.records.find((r) => r.id === id);
    if (!row) return null;
    row.announced_at ??= now();
    const { key: _key, ...record } = row;
    return structuredClone(record);
  }

  async listPlaces() {
    return structuredClone(this.d.places);
  }

  async replacePlaces(places: Omit<Place, "updated_at">[]) {
    this.d.places = places
      .map((p) => ({ ...p, updated_at: now() }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return structuredClone(this.d.places);
  }

  async cachedGeocode(query: string) {
    return this.d.geocodes.get(query) ?? null;
  }

  async saveGeocode(query: string, hit: GeocodeHit) {
    this.d.geocodes.set(query, hit);
  }

  async syncSeededEvents(
    prefix: string,
    sources: Source[],
    inputs: z.output<typeof EventInput>[],
  ): Promise<SeedResult> {
    const key = (e: { source: string; external_id?: string | null }) => `${e.source}|${e.external_id}`;
    const scope = new Set(sources);
    const wanted = new Map(inputs.filter((i) => scope.has(i.source)).map((i) => [key(i), i]));
    const d = this.d;
    let removed = 0;
    const existing = new Set<string>();
    d.events = d.events.filter((e) => {
      if (!e.external_id?.startsWith(prefix) || !scope.has(e.source)) return true;
      if (wanted.has(key(e))) {
        existing.add(key(e));
        return true;
      }
      removed++;
      return false;
    });
    let inserted = 0;
    for (const [k, i] of wanted) {
      if (existing.has(k)) continue;
      d.events.push({
        // Stable ids, so a recommendation pointing at a seeded event survives a reseed.
        id: stableUuid(k),
        source: i.source,
        type: i.type,
        start_at: i.start_at,
        end_at: i.end_at ?? null,
        title: i.title,
        data: i.data,
        external_id: i.external_id ?? null,
        created_at: now(),
      });
      inserted++;
    }
    return { inserted, removed, kept: existing.size };
  }

  async deleteMyData(scope: DataDeleteScope): Promise<DeleteCounts> {
    const d = this.d;
    if (scope.everything) {
      const userId = currentUserId();
      const counts: DeleteCounts = {
        events: d.events.length,
        event_summaries: d.summaries.length,
        goals: d.goals.length,
        focus_guards: d.guards.length,
        focus_sessions: d.focus.length,
        recommendations: d.recommendations.length,
        chat_messages: d.chat.length,
        chat_threads: d.threads.length,
        check_ins: d.checkIns.length,
        drafts: d.drafts.length,
        instructions: d.instructions.length,
        telegram_chats: d.telegram?.chat_id ? 1 : 0,
        nudges: d.nudges.length,
        integrations: d.integrations.length,
        push_subscriptions: d.push.length,
        places: d.places.length,
        geocode_cache: d.geocodes.size,
        source_settings: Object.keys(d.privacy.sources).length,
        privacy_state: d.privacy.offTheRecord || d.privacy.since ? 1 : 0,
        user_profiles: this.profiles.has(userId) ? 1 : 0,
        weekly_targets: d.targets.length,
        records: d.records.length,
        checklist_items: d.checklist.length,
        day_rituals: d.rituals.length,
      };
      // An empty account, not the sample day a first visit gets.
      this.data.set(userId, this.fresh(false));
      this.profiles.delete(userId);
      return counts;
    }
    const from = scope.from ? Date.parse(scope.from) : -Infinity;
    const to = scope.to ? Date.parse(scope.to) : Infinity;
    const days = summaryDayRange(scope.from, scope.to);
    const eventHit = (e: Event) => {
      const t = Date.parse(e.start_at);
      return (!scope.source || e.source === scope.source) && t >= from && t < to;
    };
    const summaryHit = (s: EventSummary) =>
      (!scope.source || s.source === scope.source) &&
      (!days.from || s.day >= days.from) &&
      (!days.to || s.day <= days.to);
    const before = { events: d.events.length, event_summaries: d.summaries.length };
    d.events = d.events.filter((e) => !eventHit(e));
    d.summaries = d.summaries.filter((s) => !summaryHit(s));
    return {
      events: before.events - d.events.length,
      event_summaries: before.event_summaries - d.summaries.length,
    };
  }

  async listEventsBefore(before: string, limit: number) {
    const t = Date.parse(before);
    return this.events
      .filter((e) => Date.parse(e.start_at) < t)
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
      .slice(0, limit);
  }

  async addEventSummaries(rows: EventSummary[]) {
    const d = this.d;
    for (const r of rows) {
      const hit = d.summaries.find(
        (s) => s.day === r.day && s.source === r.source && s.type === r.type && s.category === r.category,
      );
      if (hit) {
        hit.events += r.events;
        hit.seconds += r.seconds;
      } else d.summaries.push({ ...r });
    }
  }

  async listEventSummaries() {
    return structuredClone(this.d.summaries).sort((a, b) => a.day.localeCompare(b.day));
  }

  async usersWithEventsBefore(before: string) {
    const t = Date.parse(before);
    return [...this.data.entries()]
      .filter(([, x]) => x.events.some((e) => Date.parse(e.start_at) < t))
      .map(([userId]) => userId);
  }

  async listCheckIns(f: { fromDay: string; toDay: string }) {
    return structuredClone(
      this.d.checkIns
        .filter((c) => c.day >= f.fromDay && c.day <= f.toDay)
        .sort((a, b) => a.asked_at.localeCompare(b.asked_at)),
    );
  }

  async createCheckIns(rows: NewCheckIn[]) {
    const out: StoredCheckIn[] = [];
    for (const row of rows) {
      if (this.d.checkIns.some((c) => c.key === row.key)) continue;
      const stored = newCheckIn(row);
      this.d.checkIns.push(stored);
      out.push(structuredClone(stored));
    }
    return out;
  }

  async getCheckIn(id: string) {
    return structuredClone(this.d.checkIns.find((c) => c.id === id) ?? null);
  }

  async answerCheckIn(id: string, a: { answer: CheckInValue; label: string | null }) {
    const c = this.d.checkIns.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, { answer: a.answer, label: a.label, answered_at: now() });
    return structuredClone(c);
  }

  async deleteCheckIn(id: string) {
    const before = this.d.checkIns.length;
    this.d.checkIns = this.d.checkIns.filter((c) => c.id !== id && c.follow_up_of !== id);
    return this.d.checkIns.length < before;
  }

  async seedGoals(goals: Goal[], opts: { overwrite: boolean }) {
    let written = 0;
    for (const g of goals) {
      const i = this.goals.findIndex((x) => x.id === g.id);
      if (i === -1) this.goals.push(structuredClone(g));
      else if (opts.overwrite) this.goals[i] = structuredClone(g);
      else continue;
      written++;
    }
    return written;
  }
}

// Store methods that write, by their verb (every write in the Store interface starts with one).
// Chat lines and thread names are left out: the chat context does not depend on them (only on other
// threads' titles, which may lag by the context cache's two minutes), nor on our geocoding cache.
const WRITES =
  /^(add|answer|bind|clear|create|delete|insert|mark|record|remove|replace|save|seed|set|sync|unbind|update|upsert)[A-Z]/;
const QUIET_WRITES = new Set(["addChatMessage", "createChatThread", "updateChatThread", "saveGeocode"]);

/** The store, noting each write before and after it, so caches of a user's data know to read again. */
function noticingWrites(inner: Store): Store {
  return new Proxy(inner, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (typeof prop !== "string" || !WRITES.test(prop) || QUIET_WRITES.has(prop)) return fn.bind(target);
      return (...args: unknown[]) => {
        noteWrite();
        // After it lands too: a context read that started during the write must not count as fresh.
        return Promise.resolve(fn.apply(target, args)).finally(noteWrite);
      };
    },
  });
}

// Supabase when configured (production, or local with keys), otherwise the in-memory mock day.
export const store: Store = noticingWrites(
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : new MemoryStore(),
);
