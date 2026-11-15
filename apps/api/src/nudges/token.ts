import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

// The action token a push carries (#399). The service worker has no session, so a button on the
// notification proves who it is with this: the nudge id, the user id and an expiry, signed with a
// key derived from API_KEY. It is scoped to that one nudge and user, and single use because the
// nudge itself can only be acted on once (store.claimNudgeAction).

/** A nudge is about now: its buttons stop working after this long. */
export const ACTION_TOKEN_TTL_MS = 3 * 3600_000;

const key = () => createHmac("sha256", env.API_KEY).update("michael-nudge-action").digest();
const mac = (body: string) => createHmac("sha256", key()).update(body).digest("base64url").slice(0, 32);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signActionToken(nudgeId: string, userId: string, now = Date.now()): string {
  const exp = Math.ceil((now + ACTION_TOKEN_TTL_MS) / 1000).toString(36);
  const body = `${nudgeId}.${userId}.${exp}`;
  return `${body}.${mac(body)}`;
}

export type TokenCheck = { ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" };

/** Checks the token for this nudge. The user id only ever comes from a valid signature. */
export function verifyActionToken(token: string, nudgeId: string, now = Date.now()): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "invalid" };
  const [n = "", u = "", exp = "", sig = ""] = parts;
  if (!UUID.test(n) || !UUID.test(u) || !/^[0-9a-z]{1,10}$/.test(exp))
    return { ok: false, reason: "invalid" };
  const expected = Buffer.from(mac(`${n}.${u}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: "invalid" };
  // A valid token for another nudge is no key to this one.
  if (n.toLowerCase() !== nudgeId.toLowerCase()) return { ok: false, reason: "invalid" };
  if (Number.parseInt(exp, 36) * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, userId: u };
}
