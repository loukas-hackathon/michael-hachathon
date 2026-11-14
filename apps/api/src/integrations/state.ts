import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { IntegrationProvider, ReturnPath } from "@michael/shared";
import { z } from "zod";
import { env } from "../env";

// OAuth `state`: who started the connect, for which provider, until when, and where the web app
// should land afterwards. Signed with a key derived from API_KEY, so the callback (which arrives
// without auth) can trust what is in it.
const TTL_MS = 15 * 60_000;
const key = () => createHmac("sha256", env.API_KEY).update("michael-oauth-state").digest();
const sign = (body: string) => createHmac("sha256", key()).update(body).digest("base64url");

const Payload = z.object({
  u: z.uuid(),
  p: IntegrationProvider,
  exp: z.number(),
  n: z.string(),
  r: ReturnPath.optional(),
});

export type VerifiedState = { userId: string; provider: IntegrationProvider; returnTo?: string };

export function signState(
  userId: string,
  provider: IntegrationProvider,
  now = Date.now(),
  returnTo?: string,
): string {
  const r = returnTo === undefined ? undefined : ReturnPath.parse(returnTo);
  const body = Buffer.from(
    JSON.stringify({ u: userId, p: provider, exp: now + TTL_MS, n: randomBytes(8).toString("hex"), r }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The user, provider and return path, or null when the state is forged, tampered with or expired. */
export function verifyState(state: string, now = Date.now()): VerifiedState | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = Payload.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
    if (p.exp < now) return null;
    return { userId: p.u, provider: p.p, ...(p.r ? { returnTo: p.r } : {}) };
  } catch {
    return null;
  }
}
