import { z } from "zod";
import { env } from "../env";
import { HttpError } from "../http";
import { store } from "../store";

// Google OAuth 2.0 (web server flow) and the Calendar v3 REST calls Michael needs, with plain fetch.
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server
//       https://developers.google.com/workspace/calendar/api/v3/reference/events

// Read and write events on the user's calendars. Michael only writes his own blocks and the
// user's solo blocks (see actions); the scope cannot be narrower than that.
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
// openid + email: the address of the account the user picked, shown as "Connected as".
export const GOOGLE_SCOPES = ["openid", "email", GOOGLE_CALENDAR_SCOPE].join(" ");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// Tests swap this for a fake Google.
let fetchImpl: typeof fetch = (...args) => fetch(...args);
export const setGoogleFetch = (f: typeof fetch) => {
  fetchImpl = f;
};

export const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const redirectUri = () => `${env.PUBLIC_API_URL.replace(/\/$/, "")}/oauth/google/callback`;

function requireConfig() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError("not_implemented", "Google Calendar is not configured on this server yet");
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

export function authUrl(state: string): string {
  const { clientId } = requireConfig();
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    // select_account: the user picks which Google account to connect (it can differ from the one
    // they signed in with). consent + offline: a refresh token every time, so a reconnect works.
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${qs}`;
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

/**
 * The account address in an ID token. The token comes straight from Google's token endpoint over
 * TLS, so its signature need not be checked (Google's OpenID Connect docs say the same).
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
    throw new GoogleAuthError(code);
  }
  const parsed = TokenResponse.safeParse(body);
  if (!parsed.success) throw new HttpError("upstream_error", "Google sent an unexpected token response");
  return parsed.data;
}

export class GoogleAuthError extends HttpError {
  constructor(public googleCode: string) {
    super("upstream_error", `Google refused the token request (${googleCode})`);
  }
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
}

export async function revokeToken(token: string): Promise<void> {
  // Best effort: the user may already have removed access in their Google account.
  await fetchImpl(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: "POST" }).catch(
    () => undefined,
  );
}

export const NOT_CONNECTED = "Connect Google Calendar first";

/** A valid access token for the current user, refreshed (and saved) when it is about to expire. */
export async function accessToken(): Promise<string> {
  const rec = await store.getIntegration("google_calendar");
  if (!rec || rec.status === "disconnected" || !rec.refresh_token)
    throw new HttpError("conflict", NOT_CONNECTED);
  if (rec.access_token && rec.expires_at && Date.parse(rec.expires_at) > Date.now() + 60_000) {
    return rec.access_token;
  }
  const { clientId, clientSecret } = requireConfig();
  try {
    const t = await tokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: rec.refresh_token,
      grant_type: "refresh_token",
    });
    await store.saveIntegration("google_calendar", {
      access_token: t.access_token,
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
      ...(t.scope ? { scope: t.scope } : {}),
    });
    return t.access_token;
  } catch (err) {
    if (err instanceof GoogleAuthError && err.googleCode === "invalid_grant") {
      // The user removed Michael in their Google account, or the grant expired.
      await store.saveIntegration("google_calendar", {
        status: "error",
        error: "Google access was removed. Connect again.",
        access_token: null,
      });
      throw new HttpError("conflict", "Google access was removed. Connect Google Calendar again.");
    }
    throw err;
  }
}

// ---------- Calendar v3 ----------

const EventTime = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
  timeZone: z.string().optional(),
});

const Person = z.object({
  email: z.string().optional(),
  self: z.boolean().optional(),
  resource: z.boolean().optional(),
  organizer: z.boolean().optional(),
  responseStatus: z.string().optional(),
});

export const GoogleEvent = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  updated: z.string().optional(),
  start: EventTime.optional(),
  end: EventTime.optional(),
  attendees: z.array(Person).optional(),
  organizer: Person.optional(),
  creator: Person.optional(),
  transparency: z.string().optional(),
  recurringEventId: z.string().optional(),
  extendedProperties: z
    .object({
      private: z.record(z.string(), z.string()).optional(),
      shared: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});
export type GoogleEvent = z.infer<typeof GoogleEvent>;

const EventList = z.object({
  summary: z.string().optional(),
  timeZone: z.string().optional(),
  items: z.array(z.unknown()).default([]),
  nextPageToken: z.string().optional(),
});

async function calendarRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const res = await fetchImpl(`${CALENDAR_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  if (res.status === 404 || res.status === 410) throw new HttpError("not_found", "Calendar event not found");
  if (!res.ok) throw new HttpError("upstream_error", `Google Calendar answered ${res.status}`);
  return res;
}

export interface CalendarPage {
  /** The calendar's name; for the primary calendar, the owner's address. */
  summary: string | null;
  timeZone: string | null;
  events: GoogleEvent[];
}

/** Every event instance (recurring ones expanded) that overlaps [from, to]. */
export async function listCalendarEvents(from: string, to: string): Promise<CalendarPage> {
  const out: CalendarPage = { summary: null, timeZone: null, events: [] };
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await calendarRequest(`?${qs}`);
    const list = EventList.parse(await res.json());
    out.summary ??= list.summary ?? null;
    out.timeZone ??= list.timeZone ?? null;
    for (const item of list.items) {
      const e = GoogleEvent.safeParse(item);
      if (e.success) out.events.push(e.data);
    }
    pageToken = list.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export async function getCalendarEvent(id: string): Promise<GoogleEvent> {
  const res = await calendarRequest(`/${encodeURIComponent(id)}`);
  return GoogleEvent.parse(await res.json());
}

export async function insertCalendarEvent(body: Record<string, unknown>): Promise<GoogleEvent> {
  const res = await calendarRequest("", { method: "POST", body: JSON.stringify(body) });
  return GoogleEvent.parse(await res.json());
}

export async function patchCalendarEvent(id: string, body: Record<string, unknown>): Promise<GoogleEvent> {
  const res = await calendarRequest(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return GoogleEvent.parse(await res.json());
}

/** Only ever called for the user's own events with nobody else on them (checked by the caller). */
export async function deleteCalendarEvent(id: string): Promise<void> {
  await calendarRequest(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** True when anyone else is on the invite or someone else organised it. Rooms do not count. */
export function withOthers(e: GoogleEvent): boolean {
  if (e.organizer && e.organizer.self !== true) return true;
  return (e.attendees ?? []).some((a) => !a.self && !a.resource);
}

/** True for blocks Michael created (tagged in private extended properties). */
export const createdByMichael = (e: GoogleEvent) => e.extendedProperties?.private?.michael === "1";
