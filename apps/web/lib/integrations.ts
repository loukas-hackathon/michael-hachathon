import "server-only";
import { type Integration, IntegrationsResponse, OAuthConnectResponse } from "@michael/shared";
import { bearer } from "./api";

// Server-side calls for connecting sources (Google Calendar). Tokens stay in the API; the browser
// only ever sees Google's consent screen and the connection status.
const USE_MOCKS = process.env.USE_MOCKS !== "false";
const API_URL = process.env.API_URL ?? "http://localhost:8787";

async function call(method: string, path: string): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${await bearer()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res;
}

/** The Google Calendar connection, or null when it cannot be read (mocks, API down). */
export async function getGoogleCalendar(): Promise<Integration | null> {
  if (USE_MOCKS) return null;
  try {
    const body = IntegrationsResponse.parse(await (await call("GET", "/v1/integrations")).json());
    return body.integrations.find((i) => i.provider === "google_calendar") ?? null;
  } catch {
    return null;
  }
}

/** Google's consent screen for the signed-in user (a signed state ties it to them). */
export async function googleConnectUrl(): Promise<string> {
  const res = await call("POST", "/v1/integrations/google_calendar/connect");
  return OAuthConnectResponse.parse(await res.json()).url;
}

export async function syncGoogleCalendar(): Promise<void> {
  await call("POST", "/v1/integrations/google_calendar/sync");
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await call("DELETE", "/v1/integrations/google_calendar");
}
