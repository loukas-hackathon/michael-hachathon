import type {
  AnalysisRun,
  ChatMessage,
  ChatRole,
  Event,
  EventInput,
  EventSummary,
  Goal,
  GoalCreate,
  GoalUpdate,
  Instruction,
  InstructionCreate,
  InstructionUpdate,
  IntegrationProvider,
  Nudge,
  NudgeStatus,
  Place,
  Profile,
  Recommendation,
  RecommendationStatus,
  Source,
  SourceSetting,
} from "@michael/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { currentUserId } from "./context";
import { HttpError } from "./http";
import type { GeocodeHit } from "./integrations/maps";
import { type PrivacyRules, screenEvents } from "./privacy";
import {
  type AskedQuestion,
  type DataDeleteScope,
  type DeleteCounts,
  type EventPatch,
  type InsertResult,
  type IntegrationPatch,
  type IntegrationRecord,
  type NewAnalysis,
  type NewRecommendation,
  type NudgeCreate,
  type PushDevice,
  type RecommendationActionUpdate,
  type SeedResult,
  type Store,
  sameEvent,
  summaryDayRange,
  type TelegramChat,
  type TimelineFilter,
  toInstruction,
  type UpsertResult,
} from "./store";
import { mergeSummaries } from "./summaries";

type EventRow = z.output<typeof EventInput>;

const EVENT_PAGE = 1000;
const MAX_EVENTS = 20_000;

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
  "nudges",
  "recommendations",
  "analysis_runs",
  "goals",
  "events",
  "event_summaries",
  "chat_messages",
  "instructions",
  "telegram_chats",
  "integrations",
  "push_subscriptions",
  "places",
  "geocode_cache",
  "source_settings",
  "privacy_state",
  "user_profiles",
] as const;

const SUMMARY_KEYS = "user_id,day,source,type,category";

const withoutUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async listEvents(f: TimelineFilter) {
    // PostgREST caps every response (1000 rows by default) and a real workday is 1,200 to 1,500
    // events, so read page by page. Ordered by start_at then id, so pages never skip or repeat.
    const userId = currentUserId();
    const events: Event[] = [];
    for (let offset = 0; offset < MAX_EVENTS; offset += EVENT_PAGE) {
      // Overlap with [from, to]: starts before `to` and ends (or, if instant, starts) after `from`.
      let q = this.db
        .from("events")
        .select("*")
        .eq("user_id", userId)
        .lte("start_at", f.to)
        .or(`end_at.gte.${f.from},and(end_at.is.null,start_at.gte.${f.from})`)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + EVENT_PAGE - 1);
      if (f.source?.length) q = q.in("source", f.source);
      if (f.type?.length) q = q.in("type", f.type);
      const page = check(await q) ?? [];
      events.push(...page.map(toEvent));
      if (page.length < EVENT_PAGE) break;
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
    let q = this.db
      .from("recommendations")
      .select("*")
      .eq("user_id", currentUserId())
      .order("created_at", { ascending: false });
    if (filter?.status) q = q.eq("status", filter.status);
    return (check(await q) ?? []).map(toRecommendation);
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

  async createRecommendation(i: NewRecommendation) {
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
    // Every row of one insert must name the same columns.
    const withEvidence = input.recommendations.some((r) => r.evidence?.length);
    const rows = check(
      await this.db
        .from("recommendations")
        .insert(
          input.recommendations.map((r) => ({
            user_id: userId,
            analysis_run_id: saved.id,
            goal_id: r.goal_id,
            title: r.title,
            rationale: r.rationale,
            action: r.action,
            ...(withEvidence ? { evidence: r.evidence ?? [] } : {}),
            status: "proposed",
          })),
        )
        .select("*"),
    );
    return { run: saved, recommendations: (rows ?? []).map(toRecommendation) };
  }

  async listChatMessages(limit: number) {
    const rows = check(
      await this.db
        .from("chat_messages")
        .select("*")
        .eq("user_id", currentUserId())
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return (rows ?? []).map(toChatMessage).reverse();
  }

  async addChatMessage(role: ChatRole, content: string) {
    const row = check(
      await this.db
        .from("chat_messages")
        .insert({ user_id: currentUserId(), role, content })
        .select("*")
        .single(),
    );
    return toChatMessage(row);
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
    const rows = check(
      await this.db.from("integrations").select("user_id").eq("provider", provider).eq("status", "connected"),
    );
    return (rows ?? []).map((r) => r.user_id as string).filter(Boolean);
  }

  async listNudges(f: { from: string; to: string }) {
    const rows = check(
      await this.db
        .from("nudges")
        .select("*")
        .eq("user_id", currentUserId())
        .gte("created_at", f.from)
        .lt("created_at", f.to)
        .order("created_at", { ascending: true }),
    );
    return (rows ?? []).map(toNudge);
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

  async activeUserIds(since: string) {
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
