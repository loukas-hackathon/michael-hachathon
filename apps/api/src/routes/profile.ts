import { DEFAULT_PROFILE, Profile, ProfileUpdate } from "@michael/shared";
import { Hono } from "hono";
import { jsonBody, parse } from "../http";
import { assumeUnknownApps } from "../ingest/ios-shortcuts";
import { store } from "../store";

// The stored document, checked field by field: anything missing or no longer valid falls back to
// the default, so an older row never breaks the response.
export async function readProfile(): Promise<Profile> {
  const stored = (await store.getProfile()) ?? {};
  const out: Record<string, unknown> = { ...DEFAULT_PROFILE };
  for (const [key, schema] of Object.entries(Profile.shape)) {
    const value = (stored as Record<string, unknown>)[key];
    if (value !== undefined && schema.safeParse(value).success) out[key] = value;
  }
  return Profile.parse(out);
}

/** A partial update (PUT /v1/profile, and Michael's update_profile in chat); the whole profile back. */
export async function updateProfile(raw: unknown): Promise<Profile> {
  const patch = parse(ProfileUpdate, raw);
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next: Profile = { ...(await readProfile()), ...defined, updated_at: new Date().toISOString() };
  const saved = await store.saveProfile(next);
  // The app the iPhone automation is for: today's unnamed opens take its name too.
  if (patch.default_app) await assumeUnknownApps(patch.default_app);
  return saved;
}

// Onboarding answers (docs/api.md, Profile). PUT takes a partial update and returns the whole profile.
export const profile = new Hono()
  .get("/profile", async (c) => c.json(await readProfile()))
  .put("/profile", async (c) => c.json(await updateProfile(await jsonBody(c))));
