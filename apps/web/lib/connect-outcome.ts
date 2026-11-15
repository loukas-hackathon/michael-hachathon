import { safeNext } from "./next-path";

// The consent page and its form (app/connect) turn every API answer into a next step, so a person
// connecting Claude never lands on a raw error page (production, 14 Nov: three Allow taps, three
// error pages, no connection).

export type ConnectOutcome = "ok" | "expired" | "signed_out" | "failed";

/** What an API status means for a connect request (GET) or decision (POST). */
export function connectOutcome(status: number): ConnectOutcome {
  if (status >= 200 && status < 300) return "ok";
  // Unknown, expired or already answered: start again from Claude.
  if (status === 400 || status === 404 || status === 409) return "expired";
  // The session outlived its account or its token: sign in again and come back here.
  if (status === 401) return "signed_out";
  return "failed";
}

/** The consent page for one request; `failed` adds the one line that says to try again. */
export function consentPath(id: string, failed = false): string {
  return `/connect?request=${encodeURIComponent(id)}${failed ? "&error=failed" : ""}`;
}

/**
 * A dead session at consent: sign out (clears the cookies the proxy and the API disagree on), then
 * the login page, then back to this same consent page after Google (the request lives 30 minutes).
 */
export function signInAgainPath(id: string): string {
  const next = safeNext(consentPath(id)) ?? "/";
  return `/auth/signout?next=${encodeURIComponent(next)}`;
}
