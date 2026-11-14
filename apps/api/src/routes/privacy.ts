import { OffTheRecordUpdate, type PrivacyState, Source, SourceSettingUpdate } from "@michael/shared";
import { Hono } from "hono";
import { jsonBody, parse } from "../http";
import { toPrivacyState } from "../privacy";
import { store } from "../store";

// Per source opt in and off the record (docs/api.md, Privacy). Enforcement lives in privacy.ts.
export const privacy = new Hono()
  .get("/privacy", async (c) => {
    const body: PrivacyState = toPrivacyState(await store.privacyRules());
    return c.json(body);
  })
  .put("/privacy/off-the-record", async (c) => {
    const { off_the_record } = parse(OffTheRecordUpdate, await jsonBody(c));
    const body: PrivacyState = toPrivacyState(await store.setOffTheRecord(off_the_record));
    return c.json(body);
  })
  .patch("/privacy/sources/:source", async (c) => {
    const source = parse(Source, c.req.param("source"));
    const { enabled } = parse(SourceSettingUpdate, await jsonBody(c));
    return c.json(await store.setSourceEnabled(source, enabled));
  });
