import { Source, type SourcesStatusResponse } from "@michael/shared";
import { Hono } from "hono";
import { decide, toPrivacyState } from "../privacy";
import { store } from "../store";

// What each source is doing right now (docs/api.md, Sources status): its switch, whether ingest
// would store its events, and when its last event arrived. The Connections rows on You read this
// to say "Last data 12 min ago".
export const sources = new Hono().get("/sources/status", async (c) => {
  const [rules, last] = await Promise.all([store.privacyRules(), store.lastEventAtBySource()]);
  const privacy = toPrivacyState(rules);
  const enabled = new Map(privacy.sources.map((s) => [s.source, s.enabled]));
  const body: SourcesStatusResponse = {
    off_the_record: privacy.off_the_record,
    sources: Source.options.map((source) => ({
      source,
      enabled: enabled.get(source) ?? false,
      collecting: decide(rules, source) === "collect",
      last_event_at: last[source] ?? null,
    })),
  };
  return c.json(body);
});
