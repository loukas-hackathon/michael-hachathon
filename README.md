# Michael

**On your side.** Michael finds the time you lose every day and gives it back to your goals.

Michael is a coach for the whole day. He builds **one timeline of your day** from your watch,
devices, conversations and calendar, checks it often against your goals (work, gym, rest, food),
and recommends or makes concrete changes, each tied to a goal. Other AI agents can ask Michael
about you through an **MCP server**, within scopes you choose.

- **Collect:** WHOOP or Apple Health (via Health Auto Export), ActivityWatch (Mac), iPhone
  Shortcuts, Omi wearable (transcripts, memories), Google Calendar.
- **Understand:** every source writes timestamped events into one shared timeline; Gemini
  analyses it against your goals.
- **Optimise:** recommendations with a rationale and, optionally, an action on your own calendar
  or Mac (move a block, add a focus block). Anything involving other people needs your approval,
  and every action can be undone.

Built at the Gen AI Summit Hackathon, Athens, 14-15 November 2026.

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

| Var                                                 | Purpose                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `PORT`                                              | default 8787 (Railway sets it)                                       |
| `API_KEY`                                           | shared bearer secret for `/v1/*` and `/mcp` (required in production) |
| `WEB_ORIGIN`                                        | CORS origins, comma-separated                                        |
| `PUBLIC_API_URL`                                    | public URL of the API, used for OAuth redirect URIs                  |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`         | database; empty = in-memory store                                    |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                    | analysis                                                             |
| `GOOGLE_CLIENT_ID/SECRET`, `WHOOP_CLIENT_ID/SECRET` | OAuth integrations                                                   |

`apps/web` (`apps/web/.env.example`), all server-side:

| Var         | Purpose                                       |
| ----------- | --------------------------------------------- |
| `USE_MOCKS` | `true` serves fixtures from `@michael/shared` |
| `API_URL`   | base URL of the API                           |
| `API_KEY`   | same secret as the API                        |

## Live

- Web: https://michael-zeta-sand.vercel.app
- API: https://api-production-16521a26.up.railway.app (`/health`, MCP at `/mcp`)
- Database: Supabase project `michael`, EU (Frankfurt)

Merging to `main` deploys everything: Railway rebuilds the API, Vercel rebuilds the web app, and
the `Migrate database` GitHub Action applies new files in `supabase/migrations/`.

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
   Set `API_URL` (the Railway URL), `API_KEY` and `USE_MOCKS=false`.

## Connect the MCP server

Tools: `get_timeline`, `get_goals`, `get_recommendations`, `add_event` (see `docs/api.md`).

**Claude Code:**

```bash
claude mcp add --transport http michael https://<railway-domain>/mcp \
  --header "Authorization: Bearer <API_KEY>"
# local: claude mcp add --transport http michael http://localhost:8787/mcp --header "Authorization: Bearer dev-key"
```

**claude.ai** (Settings > Connectors > Add custom connector): custom connectors cannot send a
static bearer header, so use the query-string form of the key:
`https://<railway-domain>/mcp?key=<API_KEY>`. Treat that URL as a secret.

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
