# Michael

**On your side.** Michael finds the time you lose every day and gives it back to your goals.

Michael is a coach for the whole working day, for founders and executives whose time is the business.
He builds **one timeline of your day** from your Apple Watch,
calendar, Mac, iPhone, browser and Claude Code, checks it against your goals (business, health,
personal), and recommends or makes concrete changes, each tied to a goal.

- **One day, with the maths.** Today shows the share of your planned goal time actually spent, what
  leaked away and to what, and the time won back. Goals have weekly budgets and show the sums.
- **Claude works with your day.** Paste one link into claude.ai and tap Allow: Claude reads your
  day and goals, books focus blocks on your own time, and undoes them. Every agent's question is
  logged under Agents in the Mi button ("who asked about me today").
- **A nudge on your wrist.** At most five a day, never in quiet hours, under fifteen words. They
  land on the iPhone and the Apple Watch; Morning and Evening moments open and close the day.

Private by design: each source is opt in, Off the record stops all collection in one tap, the
database is in the EU, and Michael never deletes, never sends in your name and never touches an
event with other people.

| Try it                | Link                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The app               | https://michael-zeta-sand.vercel.app                                                                                           |
| **Try the demo week** | https://michael-zeta-sand.vercel.app/auth/demo (no sign in; Manolis' real week, names removed)                                 |
| Stage view            | https://michael-zeta-sand.vercel.app/stage (press N to buzz the watch)                                                         |
| **Connect Claude**    | claude.ai, Settings > Connectors > Add custom connector, paste `https://api-production-16521a26.up.railway.app/mcp`, tap Allow |

Pitch script: [`docs/pitch.md`](docs/pitch.md). Pre-stage checklist:
[`docs/demo-runbook.md`](docs/demo-runbook.md).

Built at the Gen AI Summit Hackathon, Athens, 14 and 15 November 2026.

## Architecture

```
 Omi / Health Auto Export / Shortcuts / ActivityWatch    Google Calendar / WHOOP (OAuth)
                     | webhooks                                  | sync
                     v                                           v
          +------------------------- apps/api (Hono, Railway) --------------------------+
          |  /v1 REST    /v1/webhooks/*    /mcp (MCP tools)    Gemini analysis          |
          +-------------------------------+---------------------------------------------+
                                          | Store (service role)
                                          v
                                 Supabase Postgres (events, goals,
                                 analysis_runs, recommendations, integrations)
                                          ^
          apps/web (Next.js, Vercel) -----+ reads via the API, server-side only
```

| Path                  | What                                                   |
| --------------------- | ------------------------------------------------------ |
| `apps/api`            | Hono REST API + MCP server                             |
| `apps/web`            | Next.js dashboard                                      |
| `apps/extension`      | browser extension: live time on each site (no build)   |
| `packages/shared`     | zod schemas, types, mock data (single source of truth) |
| `supabase/migrations` | database schema                                        |
| `docs/api.md`         | full API and MCP contract                              |

## Run locally

Requires Node 20+ and pnpm (`npm i -g pnpm`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev            # api: http://localhost:8787   web: http://localhost:3000
pnpm check          # typecheck + lint
```

With no Supabase variables set, the API uses an in-memory store seeded with a mock day, so
everything works offline. The web app serves mock data while `USE_MOCKS=true`.

```bash
curl localhost:8787/health
curl -H "Authorization: Bearer dev-key" "localhost:8787/v1/timeline?from=2026-11-14T00:00:00Z&to=2026-11-15T00:00:00Z"
```

## Environment variables

`apps/api` (`apps/api/.env.example`):

| Var                                                             | Purpose                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                                                          | default 8787 (Railway sets it)                                                                     |
| `API_KEY`                                                       | shared bearer secret; acts as the demo account (required in production)                            |
| `DEMO_WEEK`                                                     | `on` (default): the demo account carries a generated week up to now; `off` turns it off            |
| `DEMO_USER_ID`                                                  | the demo account's user id (has a default)                                                         |
| `WEB_ORIGIN`                                                    | CORS origins, comma-separated                                                                      |
| `PUBLIC_API_URL`                                                | public URL of the API, used for OAuth redirect URIs                                                |
| `PUBLIC_WEB_URL`                                                | public URL of the web app (MCP OAuth consent page); empty = first non local `WEB_ORIGIN`           |
| `WEB_URL`                                                       | web app URL the OAuth callbacks return to (defaults to the first `WEB_ORIGIN`)                     |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                     | database; empty = in-memory store                                                                  |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                                | analysis                                                                                           |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`                          | chat with Michael (`POST /v1/chat`, chat actions); without a key chat answers 503                  |
| `GOOGLE_CLIENT_ID/SECRET`, `WHOOP_CLIENT_ID/SECRET`             | OAuth integrations                                                                                 |
| `CALENDAR_SYNC_MINUTES`                                         | minutes between background Google Calendar syncs for every connected user (0 = off)                |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`                         | Web Push for nudges (iPhone, Apple Watch mirror); `npx web-push generate-vapid-keys`               |
| `VAPID_SUBJECT`                                                 | contact for push services, e.g. `mailto:team@michael.app`                                          |
| `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_MINUTES`               | nudge check for every active user (default on in production, every 5 minutes)                      |
| `GOOGLE_MAPS_API_KEY`                                           | travel times (Routes and Geocoding APIs); empty = places kept, travel skipped                      |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | Michael's spoken voice (`POST /v1/voice/speak`, free tier); without a key the browser voice speaks |

`apps/web` (`apps/web/.env.example`). Only `NEXT_PUBLIC_` vars reach the browser:

| Var                                                         | Purpose                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `USE_MOCKS`                                                 | `true` serves fixtures from `@michael/shared`                         |
| `API_URL`                                                   | base URL of the API                                                   |
| `API_KEY`                                                   | same secret as the API (the demo week)                                |
| `PUBLIC_API_URL`                                            | optional: API URL shown in device keys (defaults to `API_URL`)        |
| `MCP_URL`                                                   | optional: the MCP URL shown on the Agents screen (`API_URL` + `/mcp`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Google sign in through Supabase Auth (anon key is public by design)   |

## Browser extension

`apps/extension` records how long the active tab stays on each site and posts `web_visit` events
(host, page title and seconds, never the full address) to `POST /v1/events/batch`. No build step:

1. Open `chrome://extensions`, switch on Developer mode, choose **Load unpacked** and pick
   `apps/extension`.
2. Open the extension's Settings, enter the API address and key, and press **Send a test event**.

It never records incognito windows, banking, health, adult or password manager sites, or anything
on your own list, and one switch takes it off the record. Rules and permissions:
[`apps/extension/README.md`](apps/extension/README.md).

## Live services (everything deploys from `main`)

| What                           | URL                                                                             | Dashboard                                                        |
| ------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Web app (Vercel)               | https://michael-zeta-sand.vercel.app                                            | https://vercel.com/loukas-hackathon/michael                      |
| API (Railway)                  | https://api-production-16521a26.up.railway.app                                  | https://railway.com/project/85b0188b-6790-41ef-8529-3f669c8f7955 |
| Health check                   | https://api-production-16521a26.up.railway.app/health (`commit` = deployed SHA) |                                                                  |
| MCP server                     | https://api-production-16521a26.up.railway.app/mcp                              |                                                                  |
| Database (Supabase, Frankfurt) | project `michael`, ref `kpcoadbgevifyvvlhdbt`                                   | https://supabase.com/dashboard/project/kpcoadbgevifyvvlhdbt      |
| Repo and automation            | https://github.com/loukas-hackathon/michael-hachathon                           | https://github.com/loukas-hackathon/michael-hachathon/actions    |

What happens on merge, with no human involved:

| Trigger                                       | Automation                                                    |
| --------------------------------------------- | ------------------------------------------------------------- |
| PR opened, CI green, no conflicts             | `Auto-merge` action squash-merges it                          |
| API, `packages/shared` or root config changed | `Deploy API` action deploys to Railway, then checks `/health` |
| new file in `supabase/migrations/`            | `Migrate database` action applies it to production            |
| anything on `main`                            | Vercel rebuilds the web app (no PR previews, `vercel.json`)   |

Where configuration lives (values are never committed):

| Place                                        | Keys                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Railway, service `api`                       | `NODE_ENV`, `API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEB_ORIGIN`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `WEB_URL`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDAR_SYNC_MINUTES`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_MINUTES`, `GOOGLE_MAPS_API_KEY`, `ELEVENLABS_API_KEY` (optional) |
| Vercel, project `michael`                    | `API_URL`, `API_KEY`, `USE_MOCKS=false`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `MCP_URL` (optional), `PUBLIC_API_URL` (optional)                                                                                                                                                                                                                                                                             |
| GitHub repo secrets                          | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `RAILWAY_TOKEN`; variable `SUPABASE_PROJECT_REF`                                                                                                                                                                                                                                                                                                                                   |
| Local `apps/api/.env`, `apps/web/.env.local` | copies for local runs (`pnpm env:copy` in worktrees)                                                                                                                                                                                                                                                                                                                                                                                |

The production API key and access notes for the team are on the Build Hub (link in `CLAUDE.local.md`).

Seed the demo goals and recommendations (idempotent, never events): `pnpm --filter @michael/api seed`.

## Deploy (from scratch)

1. **Supabase:** create a project, then apply `supabase/migrations/*.sql`
   (`supabase link --project-ref <ref> && supabase db push`, or paste into the SQL editor).
   Copy the project URL and the service role key.
2. **Railway (API):** new service from this GitHub repo. Keep the root directory as the repo root
   (pnpm workspaces need it); Railway picks up `railway.json` at the root automatically.
   Set `NODE_ENV=production`, `API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `GEMINI_API_KEY`, `WEB_ORIGIN` (the Vercel URL) and `PUBLIC_API_URL` (the Railway URL).
   Generate a domain, then check `https://<railway-domain>/health`.
3. **Vercel (web):** import the repo, set the root directory to `apps/web` (framework Next.js).
   Set `API_URL` (the Railway URL), `API_KEY`, `USE_MOCKS=false`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Connect the MCP server

Tools: read the day (`get_timeline`, `get_goals`, `get_score`, `get_patterns`, `get_moments`,
`get_nudges`, `list_recommendations`) and change it (`add_event`, `add_goal`, `update_goal`,
`update_recommendation`, `execute_recommendation`, `undo_recommendation`, `create_focus_block`,
`plan_travel`).
See `docs/api.md`.

**Claude Code:**

```bash
claude mcp add --transport http michael https://<railway-domain>/mcp \
  --header "Authorization: Bearer <API_KEY>"
# local: claude mcp add --transport http michael http://localhost:8787/mcp --header "Authorization: Bearer dev-key"
```

**claude.ai** (Settings > Connectors > Add custom connector): paste
`https://api-production-16521a26.up.railway.app/mcp` (no key), then tap Allow on Michael's consent
page. claude.ai signs in with MCP OAuth (`apps/api/src/routes/oauth.ts`): you sign in with Google
in the web app, and the token Claude gets acts for you only. The Agents screen shows the same URL
with a copy button. The old `?key=<API_KEY>` form still works and acts as the demo account.

**Any other agent** gets its own token the same way (any MCP client with OAuth support): the
Allow tap makes it an agent on the Agents screen, where you change its scopes or revoke it, and
every question it asks is listed there.

Claude Code can use the same OAuth flow: `claude mcp add --transport http michael <url>/mcp`, then
`/mcp` in Claude Code to sign in.

**Any MCP client:** Streamable HTTP, stateless, `POST /mcp`, JSON responses.

## Connect Claude Code

Michael sees your Claude Code work in two ways. The collector reads the history from the
transcripts on your Mac (`pnpm collect --sources claude-code`, see `apps/collector/README.md`).
Hooks add the live part: each prompt the moment you send it, and each time Claude Code is left
waiting for you.

Add this to `~/.claude/settings.json` (merge it into an existing `hooks` block if you have one):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://<railway-domain>/v1/webhooks/claude-code",
            "timeout": 3,
            "headers": { "Authorization": "Bearer $MICHAEL_API_KEY" },
            "allowedEnvVars": ["MICHAEL_API_KEY"]
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt|idle_prompt",
        "hooks": [
          {
            "type": "http",
            "url": "https://<railway-domain>/v1/webhooks/claude-code",
            "timeout": 3,
            "headers": { "Authorization": "Bearer $MICHAEL_API_KEY" },
            "allowedEnvVars": ["MICHAEL_API_KEY"]
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://<railway-domain>/v1/webhooks/claude-code",
            "timeout": 3,
            "headers": { "Authorization": "Bearer $MICHAEL_API_KEY" },
            "allowedEnvVars": ["MICHAEL_API_KEY"]
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://<railway-domain>/v1/webhooks/claude-code",
            "timeout": 1,
            "headers": { "Authorization": "Bearer $MICHAEL_API_KEY" },
            "allowedEnvVars": ["MICHAEL_API_KEY"]
          }
        ]
      }
    ]
  }
}
```

- The key is read from the environment, never written in the file: put
  `export MICHAEL_API_KEY=<API_KEY>` in your shell profile and restart Claude Code. Only variables
  listed in `allowedEnvVars` reach the header. If the variable is missing, the API answers `401`,
  nothing is stored and the session carries on.
- Local API: use `http://localhost:8787/v1/webhooks/claude-code` and the key `dev-key`.
- A hook cannot fail a session. The API answers `204` straight away, and Claude Code carries on if
  the post fails. If the API cannot be reached at all, a prompt waits 3 seconds at most. `SessionEnd`
  gets 1 second because Claude Code allows 1.5 seconds for all hooks on exit.
- Stored: the first 120 characters of each prompt with anything that looks like a key masked, and a
  mark each time Claude Code waits for an approval or sits idle after finishing. `Stop` and
  `SessionEnd` are accepted and not stored yet, so you can leave those two out. Tool input, tool
  output and Claude's answers are never stored.
- The same prompt arriving later from the transcripts is recognised and not stored twice.

## Privacy

- **Opt in per source.** Every source is off until connected; one tap goes off the record.
- **Full detail for 90 days, then summaries.** A daily job rolls older events into daily totals per
  source, type and category (no titles, no content) and deletes the raw rows
  (`apps/api/src/retention.ts`).
- **Deletion really deletes.** You > Delete my data calls `DELETE /v1/me/data`: every row of the
  account is removed from the database, Google access is revoked and the sign in is deleted. The
  response counts what went, table by table (docs/api.md, "Your data").
