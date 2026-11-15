# Google Calendar

The planned day. The user taps Connect on the You screen, picks a Google account (it can differ
from the one they signed in with), and Michael mirrors today plus and minus 7 days into the
timeline, then keeps it fresh every 15 minutes. Contract: `docs/api.md`, "Integrations (OAuth)".

## One time setup in Google Cloud (a human with the Google account)

1. https://console.cloud.google.com: create or pick a project (for example `michael`).
2. APIs and Services, Library: enable **Google Calendar API**.
3. Google Auth Platform (OAuth consent screen):
   - Audience: **External**. Publishing status **In production** (setup manual, "Open Google sign in
     to everyone"). In Testing, add every Google
     account that will connect (Manolis, Loukas) under **Test users**. In Testing, refresh tokens
     expire after 7 days, so reconnect before the pitch or publish the app.
   - Branding: app name `Michael`, support email, and authorised domains `vercel.app` and
     `up.railway.app` (optional in Testing).
   - Data access, scopes: `openid`, `.../auth/userinfo.email` and
     `https://www.googleapis.com/auth/calendar.events` (sensitive: fine in Testing; publishing
     needs Google verification).
4. Clients: **Create client**, type **Web application**, name `michael-api`.
   - Authorised redirect URIs:
     - `https://api-production-16521a26.up.railway.app/oauth/google/callback`
     - `http://localhost:8787/oauth/google/callback` (local dev)
   - Authorised JavaScript origins: none needed (the flow is server side).
5. Copy the client id and secret.

## Configuration

Railway, service `api`:

| Key                     | Value                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`      | the client id                                                                         |
| `GOOGLE_CLIENT_SECRET`  | the client secret                                                                     |
| `PUBLIC_API_URL`        | `https://api-production-16521a26.up.railway.app` (already set)                        |
| `WEB_URL`               | `https://michael-zeta-sand.vercel.app` (optional: defaults to the first `WEB_ORIGIN`) |
| `CALENDAR_SYNC_MINUTES` | optional, default `15`; `0` turns background sync off                                 |

Vercel needs nothing new (`USE_MOCKS=false` and `API_URL` are already set). Locally, put the same
keys in `apps/api/.env`.

## How it works

- `apps/api/src/integrations/google.ts`: OAuth URL, code exchange, refresh, revoke, Calendar v3 calls
  (plain fetch, responses checked with zod).
- `apps/api/src/integrations/state.ts`: signed, expiring `state` (CSRF and user binding).
- `apps/api/src/integrations/calendar-sync.ts`: Google event to timeline event, idempotent upsert by
  Google id, removal of mirrored events deleted in Google, `with_others` marking.
- `apps/api/src/integrations/scheduler.ts`: background sync for every connected user.
- Web: `apps/web/app/you/google-calendar.tsx` (the row), `apps/web/app/integrations/google/connect`
  (the one tap redirect).

Why not ask for calendar access at Supabase sign in: Supabase hands Google's refresh token to the
browser once and does not keep it, the user could not pick a different account, and the demo
account (which never signs in with Google) could not connect at all. A separate flow avoids all three.

Tests: `apps/api/src/routes/integrations.test.ts` runs the whole flow against a fake Google
(`apps/api/src/integrations/fake-google.ts`).
