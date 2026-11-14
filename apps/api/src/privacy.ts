import { type PrivacyState, Source, type SourceSetting } from "@michael/shared";

// Privacy rules as stored for the current user: off the record, plus the sources the user has
// decided on. A source with no entry has never sent anything and has never been switched.
export interface PrivacyRules {
  offTheRecord: boolean;
  since: string | null;
  sources: Partial<Record<Source, { enabled: boolean; updated_at: string }>>;
}

// What a store needs to provide for the privacy screen. Both stores implement it.
export interface PrivacyBackend {
  privacyRules(): Promise<PrivacyRules>;
  setSourceEnabled(source: Source, enabled: boolean): Promise<SourceSetting>;
}

// Typed by the user themself, so never "collection": off the record and source switches leave it alone.
const ALWAYS_ALLOWED: ReadonlySet<Source> = new Set<Source>(["manual"]);

export type CollectDecision = "collect" | "off_the_record" | "source_disabled";

/** Pure rule: may an event from `source` be stored right now? No entry counts as allowed. */
export function decide(rules: PrivacyRules, source: Source): CollectDecision {
  if (ALWAYS_ALLOWED.has(source)) return "collect";
  if (rules.offTheRecord) return "off_the_record";
  if (rules.sources[source]?.enabled === false) return "source_disabled";
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
 * `ignored`. While off the record everything except manual entries is dropped.
 */
export async function screenEvents<T extends { source: Source }>(
  backend: PrivacyBackend,
  inputs: T[],
): Promise<{ allowed: T[]; ignored: number }> {
  if (!inputs.length) return { allowed: [], ignored: 0 };
  const rules = await backend.privacyRules();
  const allowed = inputs.filter((i) => decide(rules, i.source) === "collect");
  const firstSeen = new Set(
    allowed.map((i) => i.source).filter((s) => !ALWAYS_ALLOWED.has(s) && !rules.sources[s]),
  );
  for (const s of firstSeen) await backend.setSourceEnabled(s, true);
  return { allowed, ignored: inputs.length - allowed.length };
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
