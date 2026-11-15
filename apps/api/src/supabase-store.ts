import type {
  AnalysisRun,
  ChatMessage,
  ChatRole,
  ChatThread,
  CheckInValue,
  ChecklistItem,
  Draft,
  DraftStatus,
  Event,
  EventInput,
  EventSummary,
  FocusGuard,
  Goal,
  GoalCreate,
  GoalUpdate,
  Instruction,
  InstructionCreate,
  InstructionUpdate,
  IntegrationProvider,
  Nudge,
  NudgeStatus,
  PersonalRecord,
  Place,
  Profile,
  Recommendation,
  RecommendationStatus,
  Source,
  SourceSetting,
  WeeklyTarget,
} from "@michael/shared";
import { Source as SourceEnum } from "@michael/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { currentDemoVisitor, currentUserId } from "./context";
import { HttpError } from "./http";
import { type GuardDeps, guardRecommendation, guardRecommendations } from "./instructions/guard";
import type { GeocodeHit } from "./integrations/maps";
import { type PrivacyRules, screenEvents } from "./privacy";
import type { NewRecord } from "./score/records";
import {
  type AskedQuestion,
  type ChatThreadChange,
  type ChecklistPatch,
  checklistOrder,
  type DataDeleteScope,
  type DeleteCounts,
  type EventPatch,
  type InsertResult,
  type IntegrationPatch,
  type IntegrationRecord,
  NEW_THREAD_TITLE,
  type NewAnalysis,
  type NewCheckIn,
  type NewChecklistItem,
  type NewDraft,
  type NewFocusGuard,
  type NewRecommendation,
  type NudgeCreate,
  type PushDevice,
  previewOf,
  type RecommendationActionUpdate,
  type SeedResult,
  type Store,
  type StoredCheckIn,
  sameEvent,
  summaryDayRange,
  type TargetInput,
  type TelegramChat,
  type TimelineFilter,
  threadOrder,
  toInstruction,
  type UpsertResult,
} from "./store";
import { mergeSummaries } from "./summaries";
import { dbClient } from "./timing";

type EventRow = z.output<typeof EventInput>;

// PostgREST's max rows per response (Supabase default). A page shorter than this is the last one.
const EVENT_PAGE = 1000;
// Every column `toEvent` reads, and nothing else (no user_id): less to send for 10,000 rows.
const EVENT_COLUMNS = "id, source, type, start_at, end_at, title, data, external_id, created_at";

// A value inside a PostgREST or(...)/and(...) filter, quoted so `+`, `:` and `.` stay literal.
const q = (v: string) => `"${v.replace(/["\\]/g, "")}"`;

/**
 * Every row of a query, page by page past PostgREST's row cap. `page(from, to)` must order by a
 * unique key so pages never skip or repeat. For small tables that may outgrow one page over time.
 */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += EVENT_PAGE) {
    const batch = check(await page(offset, offset + EVENT_PAGE - 1)) ?? [];
    rows.push(...batch);
    if (batch.length < EVENT_PAGE) return rows;
  }
}

// Postgres returns "2026-11-14 07:40:00+00" style values via PostgREST as ISO strings with offset,
// which already satisfy the shared IsoDateTime schema; normalise to a canonical ISO string anyway.
const iso = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());

const toEvent = (r: Record<string, unknown>): Event => ({
  id: r.id as string,
  source: r.source as Event["source"],
  type: r.type as Event["type"],
  start_at: iso(r.start_at as string) as string,
  end_at: iso(r.end_at as string | null),
  title: r.title as string,
  data: (r.data as Record<string, unknown>) ?? {},
  external_id: (r.external_id as string | null) ?? null,
  created_at: iso(r.created_at as string) as string,
});

const toFocusGuard = (r: Record<string, unknown>): FocusGuard => ({
  id: r.id as string,
  recommendation_id: (r.recommendation_id as string | null) ?? null,
  apps: (r.apps as string[]) ?? [],
  bundle_ids: (r.bundle_ids as string[]) ?? [],
  start_at: iso(r.start_at as string) as string,
  end_at: iso(r.end_at as string) as string,
  goal_id: (r.goal_id as string | null) ?? null,
  back_to: (r.back_to as string | null) ?? null,
  created_at: iso(r.created_at as string) as string,
});

const toCheckIn = (r: Record<string, unknown>): StoredCheckIn => ({
  id: r.id as string,
  key: r.key as string,
  day: r.day as string,
  kind: r.kind as StoredCheckIn["kind"],
  question: r.question as string,
  answer_type: r.answer_type as StoredCheckIn["answer_type"],
  moment: r.moment as StoredCheckIn["moment"],
  event_id: (r.event_id as string | null) ?? null,
  goal_id: (r.goal_id as string | null) ?? null,
  start_at: iso((r.start_at as string | null) ?? null),
  end_at: iso((r.end_at as string | null) ?? null),
  follow_up_of: (r.follow_up_of as string | null) ?? null,
  answer: (r.answer as CheckInValue | null) ?? null,
  label: (r.label as string | null) ?? null,
  asked_at: iso(r.asked_at as string) as string,
  answered_at: iso((r.answered_at as string | null) ?? null),
});

const toGoal = (r: Record<string, unknown>): Goal => ({
  id: r.id as string,
  category: r.category as Goal["category"],
  title: r.title as string,
  description: (r.description as string | null) ?? null,
  target: (r.target as Record<string, unknown> | null) ?? null,
  weekly_budget_minutes: (r.weekly_budget_minutes as number | null) ?? null,
  active: r.active as boolean,
  created_at: iso(r.created_at as string) as string,
  updated_at: iso(r.updated_at as string) as string,
});

const instructionFromRow = (r: Record<string, unknown>): Instruction =>
  toInstruction({
    id: r.id as string,
    text: r.text as string,
    kind: r.kind as Instruction["kind"],
    days: (r.days as number[] | null) ?? null,
    time: (r.time as string | null) ?? null,
    end_time: (r.end_time as string | null) ?? null,
    exceptions: (r.exceptions as string[] | null | undefined) ?? null,
    active: r.active as boolean,
    created_at: iso(r.created_at as string) as string,
    updated_at: iso(r.updated_at as string) as string,
  });

const toRecommendation = (r: Record<string, unknown>): Recommendation => ({
  id: r.id as string,
  analysis_run_id: (r.analysis_run_id as string | null) ?? null,
  goal_id: (r.goal_id as string | null) ?? null,
  title: r.title as string,
  rationale: (r.rationale as string) ?? "",
  action: (r.action as Recommendation["action"]) ?? null,
  evidence: (r.evidence as string[] | null) ?? [],
  status: r.status as RecommendationStatus,
  executed_at: iso(r.executed_at as string | null),
  undone_at: iso(r.undone_at as string | null),
  source: (r.source as Recommendation["source"]) ?? "analysis",
  specialist: (r.specialist as Recommendation["specialist"]) ?? null,
  created_at: iso(r.created_at as string) as string,
  updated_at: iso(r.updated_at as string) as string,
});

const toPlace = (r: Record<string, unknown>): Place => ({
  key: r.key as string,
  label: r.label as string,
  address: (r.address as string | null) ?? null,
  lat: (r.lat as number | null) ?? null,
  lng: (r.lng as number | null) ?? null,
  updated_at: iso(r.updated_at as string) as string,
});

const toRun = (r: Record<string, unknown>): AnalysisRun => ({
  id: r.id as string,
  status: r.status as AnalysisRun["status"],
  trigger: r.trigger as AnalysisRun["trigger"],
  range_start: iso(r.range_start as string) as string,
  range_end: iso(r.range_end as string) as string,
  model: r.model as string,
  summary: (r.summary as string | null) ?? null,
  question: (r.question as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  started_at: iso(r.started_at as string) as string,
  finished_at: iso(r.finished_at as string | null),
});

const toChatMessage = (r: Record<string, unknown>): ChatMessage => ({
  id: r.id as string,
  role: r.role as ChatRole,
  content: r.content as string,
  created_at: iso(r.created_at as string) as string,
  action_ids: (r.action_ids as string[] | null | undefined) ?? [],
});

const toChatThread = (r: Record<string, unknown>): ChatThread => ({
  id: r.id as string,
  title: r.title as string,
  pinned: Boolean(r.pinned),
  archived: Boolean(r.archived),
  preview: (r.preview as string | null) ?? null,
  last_message_at: iso(r.last_message_at as string | null),
  created_at: iso(r.created_at as string) as string,
  updated_at: iso(r.updated_at as string) as string,
});

const toIntegration = (r: Record<string, unknown>): IntegrationRecord => ({
  provider: r.provider as IntegrationRecord["provider"],
  status: r.status as IntegrationRecord["status"],
  account: (r.account as string | null) ?? null,
  connected_at: iso(r.connected_at as string | null),
  last_sync_at: iso(r.last_sync_at as string | null),
  error: (r.error as string | null) ?? null,
  access_token: (r.access_token as string | null) ?? null,
  refresh_token: (r.refresh_token as string | null) ?? null,
  expires_at: iso(r.expires_at as string | null),
  scope: (r.scope as string | null) ?? null,
});

const toNudge = (r: Record<string, unknown>): Nudge => ({
  id: r.id as string,
  recommendation_id: (r.recommendation_id as string | null) ?? null,
  goal_id: (r.goal_id as string | null) ?? null,
  kind: r.kind as Nudge["kind"],
  key: (r.key as string | null) ?? "",
  day: r.day as string,
  channel: r.channel as Nudge["channel"],
  text: r.text as string,
  reason: (r.reason as string | null) ?? "",
  status: r.status as NudgeStatus,
  created_at: iso(r.created_at as string) as string,
  sent_at: iso(r.sent_at as string | null),
});

const toTarget = (r: Record<string, unknown>): WeeklyTarget => ({
  week_start: String(r.week_start).slice(0, 10),
  overall_pct: Number(r.overall_pct),
  areas: r.areas as WeeklyTarget["areas"],
  floors: r.floors as WeeklyTarget["floors"],
  status: r.status as WeeklyTarget["status"],
  set_by: r.set_by as WeeklyTarget["set_by"],
  reason: (r.reason as string | null) ?? "",
  basis: r.basis as WeeklyTarget["basis"],
  created_at: iso(r.created_at as string) as string,
  updated_at: iso(r.updated_at as string) as string,
});

const toChecklistItem = (r: Record<string, unknown>): ChecklistItem => ({
  id: r.id as string,
  goal_id: r.goal_id as string,
  date: String(r.date).slice(0, 10),
  text: r.text as string,
  position: Number(r.position),
  status: r.status as ChecklistItem["status"],
  settled_at: iso((r.settled_at as string | null) ?? null),
  settled_by: (r.settled_by as ChecklistItem["settled_by"]) ?? null,
  carried_from: (r.carried_from as string | null) ?? null,
  created_at: iso(r.created_at as string) as string,
  updated_at: iso(r.updated_at as string) as string,
});

const toRecord = (r: Record<string, unknown>): PersonalRecord => ({
  id: r.id as string,
  type: r.type as PersonalRecord["type"],
  area: (r.area as PersonalRecord["area"]) ?? null,
  goal_id: (r.goal_id as string | null) ?? null,
  value: Number(r.value),
  unit: r.unit as PersonalRecord["unit"],
  previous_value: r.previous_value == null ? null : Number(r.previous_value),
  achieved_on: String(r.achieved_on).slice(0, 10),
  event_id: (r.event_id as string | null) ?? null,
  tick_index: r.tick_index == null ? null : Number(r.tick_index),
  line: (r.line as string | null) ?? null,
  announced_at: iso((r.announced_at as string | null) ?? null),
  created_at: iso(r.created_at as string) as string,
});

const toDraft = (r: Record<string, unknown>): Draft => ({
  id: r.id as string,
  event_id: (r.event_id as string | null) ?? null,
  recommendation_id: (r.recommendation_id as string | null) ?? null,
  title: r.title as string,
  event_at: iso((r.event_at as string | null) ?? null),
  channel: r.channel as Draft["channel"],
  subject: (r.subject as string | null) ?? null,
  body: r.body as string,
  written_by: r.written_by as Draft["written_by"],
  status: r.status as DraftStatus,
  created_at: iso(r.created_at as string) as string,
  updated_at: iso(r.updated_at as string) as string,
});

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new HttpError("upstream_error", `Database error: ${res.error.message}`);
  return res.data;
}

// Every table holding a user's rows (enumerated from supabase/migrations), children before parents
// so cascades never hide a count. personal_tokens is deleted by tokens.ts (it also drops its cache);
// oauth_clients are shared by every user of a client, so they stay. Keep this list in sync with new
// migrations: a test in retention.test.ts checks it against the migration files.
export const USER_TABLES = [
  "agent_queries",
  "oauth_tokens",
  "oauth_grants",
  "agent_clients",
  "focus_guards",
  "nudges",
  "drafts",
  "recommendations",
  "analysis_runs",
  "checklist_items",
  "goals",
  "events",
  "event_summaries",
  "chat_messages",
  "chat_threads",
  "check_ins",
  "instructions",
  "telegram_chats",
  "integrations",
  "push_subscriptions",
  "places",
  "geocode_cache",
  "source_settings",
  "privacy_state",
  "user_profiles",
  "weekly_targets",
  "records",
] as const;

const SUMMARY_KEYS = "user_id,day,source,type,category";

const withoutUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  // `fetch` is for tests: a fake PostgREST behind the real client.
  constructor(url: string, serviceRoleKey: string, opts: { fetch?: typeof fetch } = {}) {
    this.db = dbClient(url, serviceRoleKey, opts);
  }

  async lastEventAtBySource() {
    // One tiny query per source (index on user_id, source, created_at): PostgREST has no group by.
    const userId = currentUserId();
    const rows = await Promise.all(
      SourceEnum.options.map(async (source) => {
        const r = check(
          await this.db
            .from("events")
            .select("created_at")
            .eq("user_id", userId)
            .eq("source", source)
            .order("created_at", { ascending: false })
            .limit(1),
        );
        const at = (r?.[0] as { created_at?: string } | undefined)?.created_at;
        return [source, at ? iso(at) : null] as const;
      }),
    );
    const out: Partial<Record<Source, string>> = {};
    for (const [source, at] of rows) if (at) out[source] = at;
    return out;
  }

  async listEvents(f: TimelineFilter) {
    // PostgREST caps every response (1000 rows by default) and a busy week holds 7,000+ events, so
    // read the whole window page by page with no ceiling. Keyset paging on (start_at, id): each page
    // starts strictly after the last row of the one before, so pages never skip or repeat, the
    // newest hours are never the ones cut off, and page 10 costs the same as page 1 (no OFFSET).
    const userId = currentUserId();
    const events: Event[] = [];
    // Overlap with [from, to]: starts before `to` and ends (or, if instant, starts) after `from`.
    const overlap = `or(end_at.gte.${q(f.from)},and(end_at.is.null,start_at.gte.${q(f.from)}))`;
    let after: { start_at: string; id: string } | null = null;
    for (;;) {
      const cursor: string = after
        ? `,or(start_at.gt.${q(after.start_at)},and(start_at.eq.${q(after.start_at)},id.gt.${after.id}))`
        : "";
      let query = this.db
        .from("events")
        .select(EVENT_COLUMNS)
        .eq("user_id", userId)
        .lte("start_at", f.to)
        .or(`and(${overlap}${cursor})`)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(EVENT_PAGE);
      if (f.source?.length) query = query.in("source", f.source);
      if (f.type?.length) query = query.in("type", f.type);
      const page = (check(await query) ?? []) as unknown as Record<string, unknown>[];
      for (const row of page) events.push(toEvent(row));
      if (page.length < EVENT_PAGE) break;
      const last = page[page.length - 1] as { start_at: string; id: string };
      // The raw value keeps Postgres' microseconds; a round trip through Date would drop them.
      after = { start_at: last.start_at, id: last.id };
    }
    return events;
  }

  async syncSeededEvents(prefix: string, sources: Source[], inputs: EventRow[]): Promise<SeedResult> {
    const userId = currentUserId();
    if (!sources.length) return { inserted: 0, removed: 0, kept: 0 };
    const scope = new Set<string>(sources);
    // What is already there under the prefix, page by page.
    const existing = new Set<string>();
    for (let offset = 0; ; offset += EVENT_PAGE) {
      const page =
        check(
          await this.db
            .from("events")
            .select("source, external_id")
            .eq("user_id", userId)
            .in("source", sources)
            .like("external_id", `${prefix}%`)
            .order("id", { ascending: true })
            .range(offset, offset + EVENT_PAGE - 1),
        ) ?? [];
      for (const r of page) existing.add(`${r.source}|${r.external_id}`);
      if (page.length < EVENT_PAGE) break;
    }

    const wanted = new Map<string, EventRow>();
    for (const i of inputs) {
      if (!i.external_id?.startsWith(prefix)) throw new Error(`Seeded event without the ${prefix} prefix`);
      if (scope.has(i.source)) wanted.set(`${i.source}|${i.external_id}`, i);
    }

    // Remove seeded rows that are no longer wanted (days that left the window).
    const stale = [...existing].filter((k) => !wanted.has(k)).map((k) => k.slice(k.indexOf("|") + 1));
    for (let i = 0; i < stale.length; i += 200) {
      check(
        await this.db
          .from("events")
          .delete()
          .eq("user_id", userId)
          .in("source", sources)
          .like("external_id", `${prefix}%`)
          .in("external_id", stale.slice(i, i + 200)),
      );
    }

    const fresh = [...wanted.entries()]
      .filter(([k]) => !existing.has(k))
      .map(([, i]) => ({
        user_id: userId,
        source: i.source,
        type: i.type,
        start_at: i.start_at,
        end_at: i.end_at ?? null,
        title: i.title,
        data: i.data,
        external_id: i.external_id,
      }));
    for (let i = 0; i < fresh.length; i += 500) {
      const res = await this.db.from("events").insert(fresh.slice(i, i + 500));
      // A concurrent sync inserted some of these already: harmless, the next sync settles it.
      if (res.error && res.error.code !== "23505") check(res);
    }
    return { inserted: fresh.length, removed: stale.length, kept: existing.size - stale.length };
  }

  async listCheckIns(f: { fromDay: string; toDay: string }) {
    const rows = check(
      await this.db
        .from("check_ins")
        .select("*")
        .eq("user_id", currentUserId())
        .gte("day", f.fromDay)
        .lte("day", f.toDay)
        .order("asked_at")
        .limit(200),
    );
    return (rows ?? []).map(toCheckIn);
  }

  async createCheckIns(rows: NewCheckIn[]) {
    if (rows.length === 0) return [];
    const userId = currentUserId();
    const inserted = check(
      await this.db
        .from("check_ins")
        .upsert(
          rows.map((r) => ({ ...r, user_id: userId })),
          { onConflict: "user_id,key", ignoreDuplicates: true },
        )
        .select("*"),
    );
    return (inserted ?? []).map(toCheckIn);
  }

  async getCheckIn(id: string) {
    const row = check(
      await this.db.from("check_ins").select("*").eq("user_id", currentUserId()).eq("id", id).maybeSingle(),
    );
    return row ? toCheckIn(row) : null;
  }

  async answerCheckIn(id: string, a: { answer: CheckInValue; label: string | null }) {
    const row = check(
      await this.db
        .from("check_ins")
        .update({ answer: a.answer, label: a.label, answered_at: new Date().toISOString() })
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toCheckIn(row) : null;
  }

  async deleteCheckIn(id: string) {
    // Follow ups go with their question (on delete cascade).
    const rows = check(
      await this.db.from("check_ins").delete().eq("user_id", currentUserId()).eq("id", id).select("id"),
    );
    return (rows ?? []).length > 0;
  }

  async seedGoals(goals: Goal[], opts: { overwrite: boolean }): Promise<number> {
    const userId = currentUserId();
    const rows = goals.map((g) => ({
      id: g.id,
      user_id: userId,
      category: g.category,
      title: g.title,
      description: g.description,
      target: g.target,
      weekly_budget_minutes: g.weekly_budget_minutes,
      active: g.active,
    }));
    const data = check(
      await this.db
        .from("goals")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: !opts.overwrite })
        .select("id"),
    );
    return (data ?? []).length;
  }

  async privacyRules(): Promise<PrivacyRules> {
    const userId = currentUserId();
    const [state, settings] = await Promise.all([
      this.db.from("privacy_state").select("off_the_record, since").eq("user_id", userId).maybeSingle(),
      this.db.from("source_settings").select("source, enabled, updated_at").eq("user_id", userId),
    ]);
    const s = check(state);
    const rules: PrivacyRules = {
      offTheRecord: s?.off_the_record ?? false,
      since: iso(s?.since ?? null),
      sources: {},
    };
    for (const r of check(settings) ?? []) {
      rules.sources[r.source as Source] = {
        enabled: r.enabled as boolean,
        updated_at: iso(r.updated_at as string) as string,
      };
    }
    return rules;
  }

  async setOffTheRecord(on: boolean) {
    const current = await this.privacyRules();
    // Keep `since` when the switch is pressed twice, so it still says when collection stopped.
    if (current.offTheRecord !== on) {
      const since = on ? new Date().toISOString() : null;
      check(
        await this.db
          .from("privacy_state")
          .upsert({ user_id: currentUserId(), off_the_record: on, since }, { onConflict: "user_id" }),
      );
      current.offTheRecord = on;
      current.since = since;
    }
    return current;
  }

  async setSourceEnabled(source: Source, enabled: boolean): Promise<SourceSetting> {
    const row = check(
      await this.db
        .from("source_settings")
        .upsert(
          { user_id: currentUserId(), source, enabled, updated_at: new Date().toISOString() },
          { onConflict: "user_id,source" },
        )
        .select("source, enabled, updated_at")
        .single(),
    ) as { source: Source; enabled: boolean; updated_at: string };
    return { source: row.source, enabled: row.enabled, updated_at: iso(row.updated_at) as string };
  }

  async insertEvents(all: EventRow[]): Promise<InsertResult> {
    const { allowed: inputs, ignored } = await screenEvents(this, all);
    if (!inputs.length) return { inserted: [], duplicates: 0, ignored };
    const userId = currentUserId();
    const rows = inputs.map((i) => ({
      user_id: userId,
      source: i.source,
      type: i.type,
      start_at: i.start_at,
      end_at: i.end_at ?? null,
      title: i.title,
      data: i.data,
      external_id: i.external_id ?? null,
    }));

    // Idempotency: (source, external_id) is unique where external_id is set. The index is partial,
    // so PostgREST upsert can't target it; filter known ids first, then insert the rest.
    const withExt = rows.filter((r) => r.external_id);
    const known = new Set<string>();
    if (withExt.length) {
      const existing = check(
        await this.db
          .from("events")
          .select("source, external_id")
          .eq("user_id", userId)
          .in(
            "external_id",
            withExt.map((r) => r.external_id as string),
          ),
      );
      for (const e of existing ?? []) known.add(`${e.source}|${e.external_id}`);
    }
    const seen = new Set<string>();
    const fresh = rows.filter((r) => {
      if (!r.external_id) return true;
      const k = `${r.source}|${r.external_id}`;
      if (known.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    let duplicates = rows.length - fresh.length;
    if (!fresh.length) return { inserted: [], duplicates, ignored };

    const res = await this.db.from("events").insert(fresh).select("*");
    if (!res.error) return { inserted: (res.data ?? []).map(toEvent), duplicates, ignored };
    if (res.error.code !== "23505") check(res);

    // A concurrent insert won a race on some external_id: fall back to row by row.
    const inserted: Event[] = [];
    for (const row of fresh) {
      const one = await this.db.from("events").insert(row).select("*").single();
      if (one.error?.code === "23505") duplicates++;
      else inserted.push(toEvent(check(one)));
    }
    return { inserted, duplicates, ignored };
  }

  async listGoals() {
    return (
      check(await this.db.from("goals").select("*").eq("user_id", currentUserId()).order("created_at")) ?? []
    ).map(toGoal);
  }

  async getGoal(id: string) {
    const row = check(
      await this.db.from("goals").select("*").eq("user_id", currentUserId()).eq("id", id).maybeSingle(),
    );
    return row ? toGoal(row) : null;
  }

  async createGoal(i: z.output<typeof GoalCreate>) {
    const row = check(
      await this.db
        .from("goals")
        .insert({
          user_id: currentUserId(),
          category: i.category,
          title: i.title,
          description: i.description ?? null,
          target: i.target ?? null,
          weekly_budget_minutes: i.weekly_budget_minutes ?? null,
          active: i.active,
        })
        .select("*")
        .single(),
    );
    return toGoal(row);
  }

  async updateGoal(id: string, patch: z.output<typeof GoalUpdate>) {
    const row = check(
      await this.db
        .from("goals")
        .update(withoutUndefined(patch as Record<string, unknown>))
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toGoal(row) : null;
  }

  async deleteGoal(id: string) {
    const rows = check(
      await this.db.from("goals").delete().eq("user_id", currentUserId()).eq("id", id).select("id"),
    );
    return (rows ?? []).length > 0;
  }

  // Stored as one jsonb document per user; routes/profile.ts validates it and fills in defaults.
  async getProfile() {
    const row = check(
      await this.db.from("user_profiles").select("data").eq("user_id", currentUserId()).maybeSingle(),
    );
    return row ? (row.data as Profile) : null;
  }

  async saveProfile(profile: Profile) {
    check(
      await this.db.from("user_profiles").upsert(
        {
          user_id: currentUserId(),
          data: profile,
          updated_at: profile.updated_at ?? new Date().toISOString(),
        },
        { onConflict: "user_id" },
      ),
    );
    return profile;
  }

  async listInstructions() {
    return (
      check(
        await this.db.from("instructions").select("*").eq("user_id", currentUserId()).order("created_at"),
      ) ?? []
    ).map(instructionFromRow);
  }

  async createInstruction(i: z.output<typeof InstructionCreate>) {
    const row = check(
      await this.db
        .from("instructions")
        .insert({
          user_id: currentUserId(),
          text: i.text,
          kind: i.kind,
          days: i.days ?? null,
          time: i.time ?? null,
          end_time: i.end_time ?? null,
          // A newer column: only named when it holds something, so an instruction can still be
          // stored while its migration is on its way.
          ...(i.exceptions?.length ? { exceptions: i.exceptions } : {}),
          active: i.active,
        })
        .select("*")
        .single(),
    );
    return instructionFromRow(row);
  }

  async updateInstruction(id: string, patch: z.output<typeof InstructionUpdate>) {
    const changes = withoutUndefined(patch as Record<string, unknown>);
    // An empty update is not a write: answer with the row as it is.
    const q = this.db.from("instructions");
    const row = check(
      Object.keys(changes).length === 0
        ? await q.select("*").eq("user_id", currentUserId()).eq("id", id).maybeSingle()
        : await q.update(changes).eq("user_id", currentUserId()).eq("id", id).select("*").maybeSingle(),
    );
    return row ? instructionFromRow(row) : null;
  }

  async deleteInstruction(id: string) {
    const rows = check(
      await this.db.from("instructions").delete().eq("user_id", currentUserId()).eq("id", id).select("id"),
    );
    return (rows ?? []).length > 0;
  }

  async listRecommendations(filter?: { status?: RecommendationStatus }) {
    // Every analysis run adds a few, so a long lived account passes one PostgREST page.
    const userId = currentUserId();
    const rows = await readAll<Record<string, unknown>>((from, to) => {
      let query = this.db
        .from("recommendations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (filter?.status) query = query.eq("status", filter.status);
      return query.range(from, to);
    });
    return rows.map(toRecommendation);
  }

  async getRecommendation(id: string) {
    const row = check(
      await this.db
        .from("recommendations")
        .select("*")
        .eq("user_id", currentUserId())
        .eq("id", id)
        .maybeSingle(),
    );
    return row ? toRecommendation(row) : null;
  }

  /** What instructions/guard.ts needs to check a new recommendation: the rules and the blocks. */
  private async guardDeps(): Promise<GuardDeps> {
    return { instructions: await this.listInstructions(), getEvent: (id) => this.getEvent(id) };
  }

  async createRecommendation(input: NewRecommendation) {
    // The choke point: nothing is proposed inside time a standing instruction protects.
    const i = await guardRecommendation(input, await this.guardDeps());
    const row = check(
      await this.db
        .from("recommendations")
        .insert({
          user_id: currentUserId(),
          analysis_run_id: i.analysis_run_id ?? null,
          goal_id: i.goal_id,
          title: i.title,
          rationale: i.rationale,
          action: i.action,
          source: i.source ?? "analysis",
        })
        .select("*")
        .single(),
    );
    return toRecommendation(row);
  }

  async getRecommendationExecution(id: string) {
    const row = check(
      await this.db
        .from("recommendations")
        .select("execution")
        .eq("user_id", currentUserId())
        .eq("id", id)
        .maybeSingle(),
    );
    return (row?.execution as unknown) ?? null;
  }

  async recordRecommendationAction(id: string, u: RecommendationActionUpdate) {
    const row = check(
      await this.db
        .from("recommendations")
        .update(withoutUndefined({ ...u }))
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toRecommendation(row) : null;
  }

  async updateRecommendationStatus(id: string, status: RecommendationStatus) {
    const row = check(
      await this.db
        .from("recommendations")
        .update({ status })
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toRecommendation(row) : null;
  }

  async createFocusGuard(input: NewFocusGuard) {
    const row = check(
      await this.db
        .from("focus_guards")
        .insert({ ...input, user_id: currentUserId() })
        .select("*")
        .single(),
    );
    return toFocusGuard(row);
  }

  async deleteFocusGuard(id: string) {
    const rows = check(
      await this.db.from("focus_guards").delete().eq("user_id", currentUserId()).eq("id", id).select("id"),
    );
    return (rows ?? []).length > 0;
  }

  async listFocusGuards(f: { endsAfter: string; startsBefore: string }) {
    const rows = check(
      await this.db
        .from("focus_guards")
        .select("*")
        .eq("user_id", currentUserId())
        .gt("end_at", f.endsAfter)
        .lt("start_at", f.startsBefore)
        .order("start_at")
        .limit(50),
    );
    return (rows ?? []).map(toFocusGuard);
  }

  async listPlaces() {
    const rows = check(await this.db.from("places").select("*").eq("user_id", currentUserId()).order("key"));
    return (rows ?? []).map(toPlace);
  }

  async replacePlaces(places: Omit<Place, "updated_at">[]) {
    const userId = currentUserId();
    const keys = places.map((p) => p.key);
    // Remove places no longer in the list, then upsert the rest.
    let del = this.db.from("places").delete().eq("user_id", userId);
    if (keys.length) del = del.not("key", "in", `(${keys.map((k) => `"${k}"`).join(",")})`);
    check(await del);
    if (!places.length) return [];
    const updated_at = new Date().toISOString();
    const rows = check(
      await this.db
        .from("places")
        .upsert(
          places.map((p) => ({ ...p, user_id: userId, updated_at })),
          { onConflict: "user_id,key" },
        )
        .select("*")
        .order("key"),
    );
    return (rows ?? []).map(toPlace);
  }

  async cachedGeocode(query: string) {
    const r = check(
      await this.db
        .from("geocode_cache")
        .select("*")
        .eq("user_id", currentUserId())
        .eq("query", query)
        .maybeSingle(),
    );
    if (!r) return null;
    return {
      lat: r.lat as number,
      lng: r.lng as number,
      formatted_address: r.formatted_address as string,
      place_id: (r.place_id as string | null) ?? null,
      fetched_at: iso(r.fetched_at as string) as string,
    };
  }

  async saveGeocode(query: string, hit: GeocodeHit) {
    check(
      await this.db
        .from("geocode_cache")
        .upsert({ user_id: currentUserId(), query, ...hit }, { onConflict: "user_id,query" }),
    );
  }

  async latestAnalysisRun() {
    const row = check(
      await this.db
        .from("analysis_runs")
        .select("*")
        .eq("user_id", currentUserId())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    return row ? toRun(row) : null;
  }

  async listAnalysisQuestions(limit: number): Promise<AskedQuestion[]> {
    const res = await this.db
      .from("analysis_runs")
      .select("question, started_at")
      .eq("user_id", currentUserId())
      .not("question", "is", null)
      .order("started_at", { ascending: false })
      .limit(limit);
    // `question` is a newer column. Until its migration has run there is nothing to list, and a
    // missing column must not stop an analysis.
    if (res.error) return [];
    return (res.data ?? []).flatMap((r) =>
      typeof r.question === "string" && r.question
        ? [{ question: r.question, asked_at: iso(r.started_at as string) as string }]
        : [],
    );
  }

  async saveAnalysis(input: NewAnalysis) {
    const userId = currentUserId();
    const { question, ...run } = input.run;
    const runRow = check(
      await this.db
        .from("analysis_runs")
        // `question` and `evidence` are newer columns: they are only named when they hold
        // something, so a run can still be stored while their migration is on its way.
        .insert({ user_id: userId, ...run, ...(question ? { question } : {}) })
        .select("*")
        .single(),
    );
    const saved = toRun(runRow);
    if (input.recommendations.length === 0) return { run: saved, recommendations: [] };
    // The choke point: nothing is proposed inside time a standing instruction protects.
    const recommendations = await guardRecommendations(input.recommendations, await this.guardDeps());
    // Every row of one insert must name the same columns.
    const withEvidence = recommendations.some((r) => r.evidence?.length);
    // `specialist` is newer still: named only on runs in mode `specialists`.
    const withSpecialist = recommendations.some((r) => r.specialist);
    const rows = check(
      await this.db
        .from("recommendations")
        .insert(
          recommendations.map((r) => ({
            user_id: userId,
            analysis_run_id: saved.id,
            goal_id: r.goal_id,
            title: r.title,
            rationale: r.rationale,
            action: r.action,
            ...(withEvidence ? { evidence: r.evidence ?? [] } : {}),
            ...(withSpecialist ? { specialist: r.specialist ?? null } : {}),
            status: "proposed",
          })),
        )
        .select("*"),
    );
    return { run: saved, recommendations: (rows ?? []).map(toRecommendation) };
  }

  /** A query on a chat table, scoped to the user and to the account's own rows or this visitor's. */
  private chatScope(table: "chat_threads" | "chat_messages", columns = "*") {
    const visitor = currentDemoVisitor();
    const q = this.db.from(table).select(columns).eq("user_id", currentUserId());
    return visitor ? q.eq("visitor_id", visitor) : q.is("visitor_id", null);
  }

  async listChatThreads(opts: { archived?: boolean; q?: string; limit?: number } = {}) {
    const limit = opts.limit ?? 100;
    const q = opts.q?.trim();
    let threadQuery = this.chatScope("chat_threads").eq("archived", opts.archived ?? false);
    if (q) {
      // Titles and line text, matched literally (no wildcards from the user).
      const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const lines = check(
        await this.chatScope("chat_messages", "thread_id")
          .ilike("content", pattern)
          .not("thread_id", "is", null)
          .limit(500),
      ) as unknown as { thread_id: string }[] | null;
      const ids = [...new Set((lines ?? []).map((r) => r.thread_id))].slice(0, limit);
      const byTitle = check(await threadQuery.ilike("title", pattern).limit(limit));
      const byLine = ids.length
        ? check(
            await this.chatScope("chat_threads")
              .eq("archived", opts.archived ?? false)
              .in("id", ids),
          )
        : [];
      const seen = new Map<string, ChatThread>();
      for (const r of [...(byTitle ?? []), ...(byLine ?? [])]) {
        const t = toChatThread(r as unknown as Record<string, unknown>);
        seen.set(t.id, t);
      }
      return [...seen.values()].sort(threadOrder).slice(0, limit);
    }
    threadQuery = threadQuery.order("last_message_at", { ascending: false, nullsFirst: true }).limit(limit);
    const rows = check(await threadQuery);
    return (rows ?? []).map((r) => toChatThread(r as unknown as Record<string, unknown>)).sort(threadOrder);
  }

  async getChatThread(id: string) {
    const row = check(await this.chatScope("chat_threads").eq("id", id).maybeSingle());
    return row ? toChatThread(row as unknown as Record<string, unknown>) : null;
  }

  async createChatThread(title?: string) {
    const row = check(
      await this.db
        .from("chat_threads")
        .insert({
          user_id: currentUserId(),
          visitor_id: currentDemoVisitor(),
          title: title ?? NEW_THREAD_TITLE,
        })
        .select("*")
        .single(),
    );
    return toChatThread(row);
  }

  async updateChatThread(id: string, patch: ChatThreadChange) {
    const visitor = currentDemoVisitor();
    const q = this.db
      .from("chat_threads")
      .update({ ...withoutUndefined(patch), updated_at: new Date().toISOString() })
      .eq("user_id", currentUserId())
      .eq("id", id);
    const rows = check(await (visitor ? q.eq("visitor_id", visitor) : q.is("visitor_id", null)).select("*"));
    const row = rows?.[0];
    return row ? toChatThread(row) : null;
  }

  async deleteChatThread(id: string) {
    if (!(await this.getChatThread(id))) return null;
    // Lines first, so the count is real (the foreign key would also cascade them).
    const lines = await this.db
      .from("chat_messages")
      .delete({ count: "exact" })
      .eq("user_id", currentUserId())
      .eq("thread_id", id);
    check(lines);
    check(await this.db.from("chat_threads").delete().eq("user_id", currentUserId()).eq("id", id));
    return lines.count ?? 0;
  }

  async listChatMessages(threadId: string, limit: number) {
    const rows = check(
      await this.chatScope("chat_messages")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return (rows ?? []).map((r) => toChatMessage(r as unknown as Record<string, unknown>)).reverse();
  }

  async addChatMessage(threadId: string, role: ChatRole, content: string, actionIds: string[] = []) {
    if (!(await this.getChatThread(threadId))) throw new HttpError("not_found", "Chat thread not found");
    // action_ids only when there are some, so plain lines still save if the column is not there yet.
    const extra = actionIds.length ? { action_ids: actionIds } : {};
    const row = check(
      await this.db
        .from("chat_messages")
        .insert({
          user_id: currentUserId(),
          visitor_id: currentDemoVisitor(),
          thread_id: threadId,
          role,
          content,
          ...extra,
        })
        .select("*")
        .single(),
    );
    const message = toChatMessage(row);
    check(
      await this.db
        .from("chat_threads")
        .update({
          preview: previewOf(content),
          last_message_at: message.created_at,
          updated_at: message.created_at,
        })
        .eq("user_id", currentUserId())
        .eq("id", threadId),
    );
    return message;
  }

  async clearVisitorChat(before: string) {
    const userId = currentUserId();
    const visitorThreads = () =>
      this.db.from("chat_threads").select("id").eq("user_id", userId).not("visitor_id", "is", null);
    const [active, empty] = await Promise.all([
      visitorThreads().lte("last_message_at", before),
      visitorThreads().is("last_message_at", null).lte("created_at", before),
    ]);
    const ids = [...(check(active) ?? []), ...(check(empty) ?? [])].map((r) => r.id as string);
    let removed = 0;
    // Chunks keep the id list inside a URL.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const lines = await this.db
        .from("chat_messages")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .in("thread_id", chunk);
      check(lines);
      removed += lines.count ?? 0;
      check(await this.db.from("chat_threads").delete().eq("user_id", userId).in("id", chunk));
    }
    // Lines from before threads, if any were left without one.
    const legacy = await this.db
      .from("chat_messages")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .not("visitor_id", "is", null)
      .is("thread_id", null)
      .lte("created_at", before);
    check(legacy);
    return removed + (legacy.count ?? 0);
  }

  async listDrafts(filter?: { status?: DraftStatus }) {
    let q = this.db
      .from("drafts")
      .select("*")
      .eq("user_id", currentUserId())
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter?.status) q = q.eq("status", filter.status);
    return (check(await q) ?? []).map(toDraft);
  }

  async createDraft(input: NewDraft) {
    const res = await this.db
      .from("drafts")
      .insert({ ...input, user_id: currentUserId() })
      .select("*")
      .single();
    // 23505: that event already has a draft (drafts_user_event_idx).
    if (res.error?.code === "23505") return null;
    return toDraft(check(res));
  }

  async updateDraftStatus(id: string, status: DraftStatus) {
    const row = check(
      await this.db
        .from("drafts")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toDraft(row) : null;
  }

  async getEvent(id: string) {
    const row = check(
      await this.db.from("events").select("*").eq("user_id", currentUserId()).eq("id", id).maybeSingle(),
    );
    return row ? toEvent(row) : null;
  }

  async upsertEvents(inputs: EventRow[]): Promise<UpsertResult> {
    const result: UpsertResult = { inserted: [], updated: [], unchanged: 0 };
    if (!inputs.length) return result;
    const userId = currentUserId();
    const existing = new Map<string, Event>();
    // Chunked so the `in` list stays well inside URL limits.
    for (let i = 0; i < inputs.length; i += 200) {
      const chunk = inputs.slice(i, i + 200);
      const rows = check(
        await this.db
          .from("events")
          .select("*")
          .eq("user_id", userId)
          .in("source", [...new Set(chunk.map((x) => x.source))])
          .in(
            "external_id",
            chunk.map((x) => x.external_id as string),
          ),
      );
      for (const r of rows ?? []) {
        const e = toEvent(r);
        existing.set(`${e.source}|${e.external_id}`, e);
      }
    }
    const fresh: EventRow[] = [];
    for (const i of inputs) {
      const found = existing.get(`${i.source}|${i.external_id}`);
      if (!found) fresh.push(i);
      else if (sameEvent(found, i)) result.unchanged++;
      else {
        const row = check(
          await this.db
            .from("events")
            .update({
              type: i.type,
              title: i.title,
              start_at: i.start_at,
              end_at: i.end_at ?? null,
              data: i.data,
            })
            .eq("user_id", userId)
            .eq("id", found.id)
            .select("*")
            .single(),
        );
        result.updated.push(toEvent(row));
      }
    }
    result.inserted = (await this.insertEvents(fresh)).inserted;
    return result;
  }

  async updateEvent(id: string, patch: EventPatch) {
    const row = check(
      await this.db
        .from("events")
        .update(withoutUndefined(patch as Record<string, unknown>))
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toEvent(row) : null;
  }

  async deleteEvents(ids: string[]) {
    // Chunks keep the id list inside PostgREST's URL limit (the retention job deletes hundreds).
    const userId = currentUserId();
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 150) {
      const res = await this.db
        .from("events")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .in("id", ids.slice(i, i + 150));
      check(res);
      deleted += res.count ?? 0;
    }
    return deleted;
  }

  async listIntegrations() {
    return (check(await this.db.from("integrations").select("*").eq("user_id", currentUserId())) ?? []).map(
      toIntegration,
    );
  }

  async getIntegration(provider: IntegrationProvider) {
    const row = check(
      await this.db
        .from("integrations")
        .select("*")
        .eq("user_id", currentUserId())
        .eq("provider", provider)
        .maybeSingle(),
    );
    return row ? toIntegration(row) : null;
  }

  async saveIntegration(provider: IntegrationProvider, patch: IntegrationPatch) {
    const row = check(
      await this.db
        .from("integrations")
        .upsert(
          { user_id: currentUserId(), provider, ...withoutUndefined(patch as Record<string, unknown>) },
          { onConflict: "user_id,provider" },
        )
        .select("*")
        .single(),
    );
    return toIntegration(row);
  }

  async listConnectedUserIds(provider: IntegrationProvider) {
    // Across all users, so it outgrows one page with the user base.
    const rows = await readAll<{ user_id: string | null }>((from, to) =>
      this.db
        .from("integrations")
        .select("user_id")
        .eq("provider", provider)
        .eq("status", "connected")
        .order("user_id", { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => r.user_id as string).filter(Boolean);
  }

  async listNudges(f: { from: string; to: string }) {
    const userId = currentUserId();
    const rows = await readAll<Record<string, unknown>>((from, to) =>
      this.db
        .from("nudges")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", f.from)
        .lt("created_at", f.to)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows.map(toNudge);
  }

  async createNudge(i: NudgeCreate) {
    const res = await this.db
      .from("nudges")
      .insert({ ...i, user_id: currentUserId() })
      .select("*")
      .single();
    // Unique (user_id, day, key): another check got there first.
    if (res.error?.code === "23505") return null;
    return toNudge(check(res));
  }

  async updateNudgeStatus(id: string, status: NudgeStatus) {
    const row = check(
      await this.db
        .from("nudges")
        .update({ status, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}) })
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toNudge(row) : null;
  }

  async listPushDevices(): Promise<PushDevice[]> {
    const rows = check(
      await this.db
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", currentUserId()),
    );
    return (rows ?? []).map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
  }

  async savePushDevice(device: PushDevice, userAgent: string | null) {
    check(
      await this.db.from("push_subscriptions").upsert(
        {
          user_id: currentUserId(),
          endpoint: device.endpoint,
          p256dh: device.keys.p256dh,
          auth: device.keys.auth,
          user_agent: userAgent,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      ),
    );
  }

  async removePushDevice(endpoint: string) {
    check(
      await this.db
        .from("push_subscriptions")
        .delete()
        .eq("user_id", currentUserId())
        .eq("endpoint", endpoint),
    );
  }

  async getTelegramChat(): Promise<TelegramChat | null> {
    const row = check(
      await this.db
        .from("telegram_chats")
        .select("chat_id, username, connected_at")
        .eq("user_id", currentUserId())
        .not("chat_id", "is", null)
        .maybeSingle(),
    );
    return row ? { chat_id: row.chat_id, username: row.username, connected_at: row.connected_at } : null;
  }

  async bindTelegramChat(chat: { chat_id: string; username: string | null }, link: string) {
    const userId = currentUserId();
    const prev = check(
      await this.db.from("telegram_chats").select("last_link").eq("user_id", userId).maybeSingle(),
    );
    if (prev?.last_link === link) return "used" as const;
    const at = new Date().toISOString();
    // A chat belongs to whoever bound it last (chat_id is unique).
    check(
      await this.db
        .from("telegram_chats")
        .update({ chat_id: null, username: null, connected_at: null, updated_at: at })
        .eq("chat_id", chat.chat_id)
        .neq("user_id", userId),
    );
    check(
      await this.db.from("telegram_chats").upsert(
        {
          user_id: userId,
          chat_id: chat.chat_id,
          username: chat.username,
          connected_at: at,
          last_link: link,
          updated_at: at,
        },
        { onConflict: "user_id" },
      ),
    );
    return "bound" as const;
  }

  async unbindTelegramChat() {
    const rows = check(
      await this.db
        .from("telegram_chats")
        .update({ chat_id: null, username: null, connected_at: null, updated_at: new Date().toISOString() })
        .eq("user_id", currentUserId())
        .not("chat_id", "is", null)
        .select("user_id"),
    );
    return (rows ?? []).length > 0;
  }

  async telegramChatOwner(chatId: string) {
    const row = check(
      await this.db.from("telegram_chats").select("user_id").eq("chat_id", chatId).maybeSingle(),
    );
    return row?.user_id ?? null;
  }

  async listChecklist(f: { from: string; to: string }) {
    const rows = check(
      await this.db
        .from("checklist_items")
        .select("*")
        .eq("user_id", currentUserId())
        .gte("date", f.from)
        .lte("date", f.to),
    );
    return (rows ?? []).map(toChecklistItem).sort(checklistOrder);
  }

  async getChecklistItem(id: string) {
    const row = check(
      await this.db
        .from("checklist_items")
        .select("*")
        .eq("user_id", currentUserId())
        .eq("id", id)
        .maybeSingle(),
    );
    return row ? toChecklistItem(row) : null;
  }

  async createChecklistItem(input: NewChecklistItem) {
    const res = await this.db
      .from("checklist_items")
      .insert({
        user_id: currentUserId(),
        goal_id: input.goal_id,
        date: input.date,
        text: input.text,
        position: input.position,
        carried_from: input.carried_from ?? null,
      })
      .select("*")
      .single();
    // The unique index on open items: two adds at once for the same slot.
    if (res.error?.code === "23505") throw new HttpError("conflict", "That slot of the day is taken");
    return toChecklistItem(check(res));
  }

  async updateChecklistItem(id: string, patch: ChecklistPatch) {
    const changes = withoutUndefined(patch as Record<string, unknown>);
    const q = this.db.from("checklist_items");
    const res =
      Object.keys(changes).length === 0
        ? await q.select("*").eq("user_id", currentUserId()).eq("id", id).maybeSingle()
        : await q.update(changes).eq("user_id", currentUserId()).eq("id", id).select("*").maybeSingle();
    if (res.error?.code === "23505") throw new HttpError("conflict", "That slot of the day is taken");
    const row = check(res);
    return row ? toChecklistItem(row) : null;
  }

  async deleteChecklistItem(id: string) {
    const rows = check(
      await this.db.from("checklist_items").delete().eq("user_id", currentUserId()).eq("id", id).select("id"),
    );
    return (rows ?? []).length > 0;
  }

  async listTargets(from: string, to: string) {
    const rows = check(
      await this.db
        .from("weekly_targets")
        .select("*")
        .eq("user_id", currentUserId())
        .gte("week_start", from)
        .lte("week_start", to)
        .order("week_start"),
    );
    return (rows ?? []).map(toTarget);
  }

  async saveTarget(t: TargetInput) {
    const row = check(
      await this.db
        .from("weekly_targets")
        .upsert(
          {
            user_id: currentUserId(),
            week_start: t.week_start,
            overall_pct: t.overall_pct,
            areas: t.areas,
            floors: t.floors,
            status: t.status,
            set_by: t.set_by,
            reason: t.reason,
            basis: t.basis,
          },
          { onConflict: "user_id,week_start" },
        )
        .select("*")
        .single(),
    );
    return toTarget(row);
  }

  async listRecords() {
    const rows = check(
      await this.db.from("records").select("*").eq("user_id", currentUserId()).order("created_at"),
    );
    return (rows ?? []).map(toRecord);
  }

  async insertRecords(records: NewRecord[]) {
    if (records.length === 0) return [];
    const userId = currentUserId();
    const rows = check(
      await this.db
        .from("records")
        .upsert(
          records.map((r) => ({ ...r, user_id: userId })),
          { onConflict: "user_id,key", ignoreDuplicates: true },
        )
        .select("*"),
    );
    return (rows ?? []).map(toRecord);
  }

  async markRecordAnnounced(id: string) {
    const q = () => this.db.from("records");
    check(
      await q()
        .update({ announced_at: new Date().toISOString() })
        .eq("user_id", currentUserId())
        .eq("id", id)
        .is("announced_at", null),
    );
    const row = check(await q().select("*").eq("user_id", currentUserId()).eq("id", id).maybeSingle());
    return row ? toRecord(row) : null;
  }

  async activeUserIds(since: string) {
    // Users active since the last scheduler tick: far below one PostgREST page (1000 rows).
    const rows = check(await this.db.rpc("active_user_ids", { since }));
    return ((rows ?? []) as unknown[]).map((r) =>
      typeof r === "string" ? r : String((r as Record<string, unknown>).active_user_ids),
    );
  }

  async deleteMyData(scope: DataDeleteScope): Promise<DeleteCounts> {
    const userId = currentUserId();
    const counts: DeleteCounts = {};
    if (scope.everything) {
      for (const table of USER_TABLES) {
        const res = await this.db.from(table).delete({ count: "exact" }).eq("user_id", userId);
        check(res);
        counts[table] = res.count ?? 0;
      }
      return counts;
    }
    let events = this.db.from("events").delete({ count: "exact" }).eq("user_id", userId);
    if (scope.source) events = events.eq("source", scope.source);
    if (scope.from) events = events.gte("start_at", scope.from);
    if (scope.to) events = events.lt("start_at", scope.to);
    const e = await events;
    check(e);
    counts.events = e.count ?? 0;

    const days = summaryDayRange(scope.from, scope.to);
    let summaries = this.db.from("event_summaries").delete({ count: "exact" }).eq("user_id", userId);
    if (scope.source) summaries = summaries.eq("source", scope.source);
    if (days.from) summaries = summaries.gte("day", days.from);
    if (days.to) summaries = summaries.lte("day", days.to);
    const s = await summaries;
    check(s);
    counts.event_summaries = s.count ?? 0;
    return counts;
  }

  async listEventsBefore(before: string, limit: number) {
    const rows = check(
      await this.db
        .from("events")
        .select("*")
        .eq("user_id", currentUserId())
        .lt("start_at", before)
        .order("start_at")
        .order("id")
        .limit(limit),
    );
    return (rows ?? []).map(toEvent);
  }

  async addEventSummaries(rows: EventSummary[]) {
    if (!rows.length) return;
    const userId = currentUserId();
    const days = [...new Set(rows.map((r) => r.day))];
    const existing = (
      check(
        await this.db
          .from("event_summaries")
          .select("day, source, type, category, events, seconds")
          .eq("user_id", userId)
          .in("day", days),
      ) ?? []
    ).map((r) => ({ ...r, events: Number(r.events), seconds: Number(r.seconds) }) as EventSummary);
    const merged = mergeSummaries(existing, rows).map((r) => ({
      ...r,
      user_id: userId,
      updated_at: new Date().toISOString(),
    }));
    check(await this.db.from("event_summaries").upsert(merged, { onConflict: SUMMARY_KEYS }));
  }

  async listEventSummaries() {
    const rows = check(
      await this.db
        .from("event_summaries")
        .select("day, source, type, category, events, seconds")
        .eq("user_id", currentUserId())
        .order("day")
        .limit(5000),
    );
    return (rows ?? []).map(
      (r) => ({ ...r, events: Number(r.events), seconds: Number(r.seconds) }) as EventSummary,
    );
  }

  async usersWithEventsBefore(before: string) {
    const rows = check(await this.db.rpc("users_with_events_before", { before }));
    return ((rows ?? []) as unknown[]).map((r) =>
      typeof r === "string" ? r : String((r as Record<string, unknown>).users_with_events_before),
    );
  }
}
