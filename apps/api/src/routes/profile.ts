import { DEFAULT_PROFILE, Profile, ProfileUpdate } from "@michael/shared";
import { Hono } from "hono";
import { jsonBody, parse } from "../http";
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

// Onboarding answers (docs/api.md, Profile). PUT takes a partial update and returns the whole profile.
export const profile = new Hono()
  .get("/profile", async (c) => c.json(await readProfile()))
  .put("/profile", async (c) => {
    const patch = parse(ProfileUpdate, await jsonBody(c));
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next: Profile = { ...(await readProfile()), ...defined, updated_at: new Date().toISOString() };
    return c.json(await store.saveProfile(next));
  });
