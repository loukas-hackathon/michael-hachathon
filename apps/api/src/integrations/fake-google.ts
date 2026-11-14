// A small in-memory Google (OAuth token endpoint + Calendar v3 events) for tests. Not used at runtime.
import type { GoogleEvent } from "./google";

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const idToken = (email: string) => `${b64({ alg: "RS256" })}.${b64({ email, email_verified: true })}.sig`;

export interface FakeGoogle {
  fetch: typeof fetch;
  events: Map<string, GoogleEvent>;
  calls: { method: string; url: string; body: string | null }[];
  /** Next token request fails with this OAuth error code (e.g. "invalid_grant"). */
  failTokenWith: string | null;
  tokensIssued: number;
}

export function fakeGoogle(initial: GoogleEvent[] = []): FakeGoogle {
  const g: FakeGoogle = {
    events: new Map(initial.map((e) => [e.id, structuredClone(e)])),
    calls: [],
    failTokenWith: null,
    tokensIssued: 0,
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      const body = init?.body ? String(init.body) : null;
      g.calls.push({ method, url: url.href, body });
      const json = (v: unknown, status = 200) =>
        new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

      if (url.href.startsWith("https://oauth2.googleapis.com/token")) {
        if (g.failTokenWith) {
          const error = g.failTokenWith;
          g.failTokenWith = null;
          return json({ error }, 400);
        }
        const params = new URLSearchParams(body ?? "");
        g.tokensIssued++;
        return json({
          access_token: `access-${g.tokensIssued}`,
          expires_in: 3599,
          ...(params.get("grant_type") === "authorization_code"
            ? { refresh_token: "refresh-1", id_token: idToken("calendar.owner@example.com") }
            : {}),
          scope: "https://www.googleapis.com/auth/calendar.events",
          token_type: "Bearer",
        });
      }
      if (url.href.startsWith("https://oauth2.googleapis.com/revoke"))
        return new Response(null, { status: 200 });

      const prefix = "/calendar/v3/calendars/primary/events";
      if (url.hostname === "www.googleapis.com" && url.pathname.startsWith(prefix)) {
        const id = decodeURIComponent(url.pathname.slice(prefix.length + 1));
        if (!id && method === "GET") {
          return json({
            summary: "manolis@example.com",
            timeZone: "Europe/Athens",
            items: [...g.events.values()],
          });
        }
        if (!id && method === "POST") {
          const created = {
            ...(JSON.parse(body ?? "{}") as object),
            id: `m${g.events.size + 1}x`,
          } as GoogleEvent;
          created.organizer = { email: "manolis@example.com", self: true };
          created.status = "confirmed";
          g.events.set(created.id, created);
          return json(created);
        }
        const found = g.events.get(id);
        if (!found) return json({ error: { code: 404 } }, 404);
        if (method === "GET") return json(found);
        if (method === "PATCH") {
          Object.assign(found, JSON.parse(body ?? "{}"));
          return json(found);
        }
        if (method === "DELETE") {
          g.events.delete(id);
          return new Response(null, { status: 204 });
        }
      }
      return json({ error: "unexpected request" }, 500);
    },
  };
  return g;
}

/** A Google event at `start` for `minutes`, organised by the user unless told otherwise. */
export function gEvent(
  id: string,
  start: number,
  minutes: number,
  extra: Partial<GoogleEvent> = {},
): GoogleEvent {
  return {
    id,
    status: "confirmed",
    summary: `Event ${id}`,
    start: { dateTime: new Date(start).toISOString() },
    end: { dateTime: new Date(start + minutes * 60_000).toISOString() },
    organizer: { email: "manolis@example.com", self: true },
    ...extra,
  };
}
