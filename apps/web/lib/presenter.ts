import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The presenter: the one browser that may connect Claude to the shared demo week (#343). Demo
// visitors cannot (connecting grants an agent full write on the shared account), so the presenter
// opens /auth/presenter?key=<DEMO_PRESENTER_KEY> once on the presenting laptop. That sets an
// httpOnly cookie signed with the key; while it is valid, the server sends the key to the API with
// the API key and the visitor id (server to server, never to the browser), and the API lets the
// connect decision through. Without DEMO_PRESENTER_KEY there is no presenter at all.

export const PRESENTER_COOKIE = "michael_presenter";

/** How long the presenting laptop stays the presenter: the whole hackathon weekend and the pitch. */
export const PRESENTER_MAX_AGE_S = 3 * 24 * 3600;

const key = () => process.env.DEMO_PRESENTER_KEY?.trim() || null;

/** True when this deployment has a presenter key (the consent page says so when it does not). */
export const presenterConfigured = () => key() !== null;

/** The key the API checks, for the server to server header. Null when not configured. */
export const presenterKey = key;

const digest = (s: string) => createHash("sha256").update(s).digest();
// Constant time (hashing first equalises lengths).
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** True when the key in the presenter link is this deployment's key. */
export function presenterKeyMatches(given: string | null | undefined): boolean {
  const k = key();
  return Boolean(k && given && same(given, k));
}

const sign = (k: string, expires: number) =>
  createHmac("sha256", k).update(`presenter:${expires}`).digest("base64url");

/** The cookie value: its expiry and a signature with the key, so it cannot be made by hand. */
export function presenterCookieValue(now = Date.now()): string {
  const k = key();
  if (!k) throw new Error("DEMO_PRESENTER_KEY is not set");
  const expires = Math.floor(now / 1000) + PRESENTER_MAX_AGE_S;
  return `${expires}.${sign(k, expires)}`;
}

/** True when the cookie was made by /auth/presenter with the current key and has not expired. */
export function validPresenterCookie(value: string | undefined, now = Date.now()): boolean {
  const k = key();
  if (!k || !value) return false;
  const [raw, signature, extra] = value.split(".");
  if (extra !== undefined || !raw || !signature || !/^\d+$/.test(raw)) return false;
  const expires = Number(raw);
  if (expires * 1000 <= now) return false;
  return same(signature, sign(k, expires));
}

// Tries per address on /auth/presenter, so the key cannot be guessed (it is 32 random bytes anyway).
// In memory per server instance: a best effort brake, not an account lockout.
const WINDOW_MS = 10 * 60_000;
const MAX_TRIES = 10;
const tries = new Map<string, { count: number; until: number }>();

/** Counts one try from this address; false once it has used up its tries for the window. */
export function presenterTryAllowed(address: string, now = Date.now()): boolean {
  if (tries.size > 5000) tries.clear();
  const hit = tries.get(address);
  if (!hit || hit.until <= now) {
    tries.set(address, { count: 1, until: now + WINDOW_MS });
    return true;
  }
  hit.count += 1;
  return hit.count <= MAX_TRIES;
}
