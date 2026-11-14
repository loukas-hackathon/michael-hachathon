# Michael - agent guide

Michael is a personal "Jarvis": it builds ONE timeline of the user's day from many sources
(WHOOP / Apple Health, ActivityWatch, iPhone Shortcuts, Omi wearable, Google Calendar),
analyses it with Gemini against the user's goals (work, gym, rest, food), and recommends concrete
changes tied to a goal. It exposes the timeline to other agents through an MCP server.

Hackathon: Sat 14 Nov 12:00 -> Sun 15 Nov 24:00 (Athens). Two humans, each driving Claude Code in
parallel. Judged on usefulness, craft, aura. Move fast, keep quality, commit often.

## Repo map

| Path                    | What                                                                               | Deploy                            |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------- |
| `apps/api`              | Node + Hono: REST API under `/v1`, MCP server at `/mcp`, webhooks, Gemini analysis | Railway (`apps/api/railway.json`) |
| `apps/api/src/store.ts` | `Store` interface (the only DB boundary) + `MemoryStore`                           |                                   |
| `apps/api/src/mcp.ts`   | MCP tools (stateless Streamable HTTP, official SDK)                                |                                   |
| `apps/api/src/routes/*` | One file per resource                                                              |                                   |
| `apps/web`              | Next.js App Router + Tailwind; reads data server-side via `lib/api.ts`             | Vercel (root dir `apps/web`)      |
| `packages/shared`       | zod schemas + inferred types + mock data. **Contract.**                            |                                   |
| `docs/api.md`           | Human-readable API contract. **Contract.**                                         |                                   |
| `supabase/migrations`   | SQL migrations (Supabase Postgres)                                                 | Supabase                          |
| `apps/mobile`           | Future Expo app. Does not exist yet; don't create it.                              |                                   |

## Commands (run from repo root)

```bash
pnpm install            # install everything
pnpm dev                # api on :8787 + web on :3000
pnpm dev:api | dev:web  # one side only
pnpm typecheck          # tsc in every package
pnpm lint               # biome check
pnpm format             # biome check --write (auto-fix)
pnpm check              # typecheck + lint; MUST pass before every PR
pnpm --filter @michael/web build   # full Next build
```

Smoke test: `curl localhost:8787/health`, then
`curl -H "Authorization: Bearer dev-key" localhost:8787/v1/timeline`.

## Rules

- **TypeScript everywhere.** zod for every external input. Current stable versions.
- **Data shapes live only in `packages/shared`.** Never redeclare a type in an app.
- **Contract rule:** `packages/shared` + `docs/api.md` are what both humans depend on. Any change
  to them must be mentioned in the issue, and both must be updated in the SAME PR. If a DB column
  changes, add a new migration in `supabase/migrations` in that PR too (never edit an applied one).
- **DB access only in `apps/api`**, only through `Store` (`apps/api/src/store.ts`), using the
  Supabase service role key server-side. The web app never talks to the DB.
- **Gemini only from `apps/api`** (`@google/genai`).
- **Next.js 16 differs from your training data.** Before writing web code, read `apps/web/AGENTS.md`
  and the guides in `apps/web/node_modules/next/dist/docs/`.
- **Web uses mocks until the endpoint exists:** `USE_MOCKS=true` (default) in `apps/web` serves
  fixtures from `@michael/shared`. When the real endpoint ships, flip it per call site, not globally.
- **Actions are advise-only.** `Recommendation.action` is modelled but never executed. Don't build
  action execution unless an issue explicitly asks.
- **Auth is provisional:** a shared `API_KEY` bearer token. Don't build user accounts.
- Errors always use the `ApiError` shape (`apps/api/src/http.ts`: throw `HttpError`).
- Secrets only in env vars. Update the relevant `.env.example` when you add one.
- No emojis anywhere. Comments in English. Keep files small and focused.
- **If anything is unclear, ask the human. Don't assume.**

## Ownership and locking

There is no fixed ownership (Loukas leans backend, the teammate leans frontend).
**An open issue with the `in-progress` label is the lock:** whoever is assigned owns the files it
lists until its PR is merged.

Before starting, run `gh issue list --label in-progress` and read the "Files likely touched" of
each. If your task would touch the same files, pick another task or comment on their issue first.

## Workflow for every task

```bash
git checkout main && git pull
gh issue list --label in-progress                      # don't touch claimed work
gh issue list --state open --search "no:assignee"      # pick the lowest-numbered unblocked issue
# claim an existing issue:
gh issue edit <n> --add-label in-progress --add-assignee @me
# or create one:
gh issue create --title "<task>" --label in-progress --label <backend|frontend> --assignee @me
git checkout -b <n>-short-name
# ... small change (< 1h) ...
pnpm check
git add -A && git commit -m "<what> (#<n>)"
git push -u origin HEAD
gh pr create --fill --body "Closes #<n>"
gh pr merge --squash --delete-branch
git checkout main && git pull
```

- **Never push directly to `main`.** Always branch + PR, even for one-line fixes.
- One issue = one branch = one PR. Keep PRs small; merge as soon as `pnpm check` passes.
- If `main` moved while you worked: `git pull origin main` into your branch, re-run `pnpm check`.
- Blocked on something? Add the `blocked` label and comment why, then pick another issue.
- Update the `Status` column in `docs/api.md` when an endpoint goes from `stub` to `live`.
