import { MapsQuery, type MapsStop, type PrivacyState, Source, type SourceSetting } from "@michael/shared";

// Privacy rules as stored for the current user: off the record, plus the sources the user has
// decided on. A source with no entry has never sent anything and has never been switched.
export interface PrivacyRules {
  offTheRecord: boolean;
  since: string | null;
  sources: Partial<Record<Source, { enabled: boolean; updated_at: string }>>;
  /**
   * Meetings mode windows (#400), recent ones only: when the user had it on. A conversation is
   * kept only when it started inside one. Missing means none.
   */
  meetings?: MeetingWindow[];
}

/** One meetings mode session as ingest sees it: from its start to when it ended (or will end). */
export interface MeetingWindow {
  start: string;
  end: string;
}

// What a store needs to provide for the privacy screen. Both stores implement it.
export interface PrivacyBackend {
  privacyRules(): Promise<PrivacyRules>;
  setSourceEnabled(source: Source, enabled: boolean): Promise<SourceSetting>;
}

// Typed by the user themself, so never "collection": off the record and source switches leave it alone.
const ALWAYS_ALLOWED: ReadonlySet<Source> = new Set<Source>(["manual"]);

export type CollectDecision = "collect" | "off_the_record" | "source_disabled" | "no_meeting";

// Sources that only ever carry conversations: every event they send needs meetings mode.
const CONVERSATION_SOURCES: ReadonlySet<Source> = new Set<Source>(["omi"]);

// A conversation that began this long before the user tapped Start still counts: the recorder
// often starts a breath earlier than the tap.
export const MEETING_GRACE_MS = 2 * 60_000;

/** True for an event that holds a conversation: from a conversation source, or of that type. */
export function isConversation(input: { source: Source; type?: string }): boolean {
  if (ALWAYS_ALLOWED.has(input.source)) return false;
  return CONVERSATION_SOURCES.has(input.source) || input.type === "conversation";
}

/** Did a meetings mode session cover this moment (with the grace before its start)? */
export function inMeeting(windows: MeetingWindow[] | undefined, at: string): boolean {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  return (windows ?? []).some((w) => t >= Date.parse(w.start) - MEETING_GRACE_MS && t <= Date.parse(w.end));
}

/** Pure rule: may an event from `source` be stored right now? No entry counts as allowed. */
export function decide(rules: PrivacyRules, source: Source): CollectDecision {
  if (ALWAYS_ALLOWED.has(source)) return "collect";
  if (rules.offTheRecord) return "off_the_record";
  if (rules.sources[source]?.enabled === false) return "source_disabled";
  return "collect";
}

/**
 * The rule for one event: the source rule first (off the record always wins), then meetings mode.
 * A conversation is kept only when it started while the user had meetings mode on (#400).
 */
export function decideEvent(
  rules: PrivacyRules,
  input: { source: Source; type?: string; start_at?: string },
): CollectDecision {
  const bySource = decide(rules, input.source);
  if (bySource !== "collect") return bySource;
  if (isConversation(input) && !inMeeting(rules.meetings, input.start_at ?? "")) return "no_meeting";
  return "collect";
}

/**
 * The one privacy check for every ingest path. `insertEvents` in both stores calls it, so the
 * events routes, webhooks and MCP tools are all covered; webhook code may also call
 * `isCollecting` first to skip work.
 *
 * Opt in: a source is off until the user connects it, and connecting it (the collector, the
 * webhook or the integration sending its first event) is the opt in. So a source's first event
 * records it as enabled; once the user switches it off, its events are dropped and counted in
 * `ignored`. While off the record everything except manual entries is dropped. Conversations are
 * dropped unless meetings mode covered their start (#400).
 */
export async function screenEvents<T extends { source: Source; type?: string; start_at?: string }>(
  backend: PrivacyBackend,
  inputs: T[],
): Promise<{ allowed: T[]; ignored: number }> {
  if (!inputs.length) return { allowed: [], ignored: 0 };
  const rules = await backend.privacyRules();
  const allowed = inputs
    .filter((i) => decideEvent(rules, i) === "collect")
    .map((i) => redactLocation(rules, i));
  const firstSeen = new Set(
    allowed.map((i) => i.source).filter((s) => !ALWAYS_ALLOWED.has(s) && !rules.sources[s]),
  );
  for (const s of firstSeen) await backend.setSourceEnabled(s, true);
  return { allowed, ignored: inputs.length - allowed.length };
}

/**
 * Location is opt in. A browsing event may carry where a Maps search pointed (`data.maps`, see
 * docs/api.md); its coordinates are kept only while source maps is switched on, otherwise every
 * lat and lng is stored as null and only the names stay, like any other search term. A `maps`
 * field that does not match the contract is dropped whole.
 */
export function redactLocation<T extends { source: Source }>(rules: PrivacyRules, input: T): T {
  const data = (input as { data?: unknown }).data;
  if (!data || typeof data !== "object" || !("maps" in data)) return input;
  const { maps, ...rest } = data as Record<string, unknown>;
  const parsed = MapsQuery.safeParse(maps);
  if (!parsed.success) return { ...input, data: rest };
  if (rules.sources.maps?.enabled === true) return { ...input, data: { ...rest, maps: parsed.data } };
  const blank = (stop: MapsStop | null) => (stop ? { ...stop, lat: null, lng: null } : null);
  const q = parsed.data;
  return {
    ...input,
    data: { ...rest, maps: { ...q, place: blank(q.place), from: blank(q.from), to: blank(q.to) } },
  };
}

/** For webhook code that wants to skip work early. */
export async function isCollecting(backend: PrivacyBackend, source: Source): Promise<boolean> {
  return decide(await backend.privacyRules(), source) === "collect";
}

/** The contract's view: every source, opted out unless the user (or connecting it) opted in. */
export function toPrivacyState(rules: PrivacyRules): PrivacyState {
  const epoch = new Date(0).toISOString();
  return {
    off_the_record: rules.offTheRecord,
    since: rules.offTheRecord ? rules.since : null,
    sources: Source.options.map((source) => ({
      source,
      enabled: rules.sources[source]?.enabled ?? false,
      updated_at: rules.sources[source]?.updated_at ?? epoch,
    })),
  };
}
