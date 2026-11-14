# Michael - agent guide

Michael is a personal "Jarvis": it builds ONE timeline of the user's day from many sources
(WHOOP / Apple Health, ActivityWatch, iPhone Shortcuts, Omi wearable, Google Calendar),
analyses it with Gemini against the user's goals (work, gym, rest, food), and recommends concrete
changes tied to a goal. Other agents can use the timeline through our MCP server.

Hackathon: Sat 14 Nov 12:00 -> Sun 15 Nov 24:00 (Athens). Two people (Loukas, Manolis), each running
Claude Code agents in parallel. Judged on usefulness, craft, aura. Move fast, keep quality.

## Repo map

| Path                    | What                                                                             |
| ----------------------- | -------------------------------------------------------------------------------- |
| `apps/api`              | Hono API: REST under `/v1`, MCP at `/mcp`, webhooks, Gemini. Deploys to Railway. |
| `apps/api/src/store.ts` | `Store` interface: the only way to read/write data                               |
| `apps/web`              | Next.js App Router + Tailwind. Deploys to Vercel (root dir `apps/web`).          |
| `packages/shared`       | zod schemas, types, mock data. **Shared contract.**                              |
| `docs/api.md`           | API + MCP contract in words. **Shared contract.**                                |
| `supabase/migrations`   | database schema                                                                  |

## Commands (from repo root)

```bash
pnpm install
pnpm dev          # api :8787 + web :3000
pnpm check        # typecheck + lint, run before every PR
pnpm format       # auto-fix formatting
```

## The rules (keep it simple)

1. **Never push to `main`.** Branch, PR, squash-merge.
2. **Claim before you code.** Assign yourself an issue and add the `in-progress` label. Skip issues
   someone else has claimed, and avoid editing files listed in their issue.
3. **Small PRs.** One issue = one branch = one PR, ideally under an hour. `pnpm check` must pass.
4. **Shared contract changes go together.** If you change `packages/shared`, update `docs/api.md`
   in the same PR (and add a migration if the DB changes). Say so in the issue.
5. **Ask the human when unsure.** Don't guess at requirements or third-party APIs; check the docs.

## Workflow

```bash
git checkout main && git pull
gh issue list --label in-progress            # what's taken
gh issue list --search "no:assignee"         # pick one whose dependencies are done
gh issue edit <n> --add-assignee @me --add-label in-progress
git checkout -b <n>-short-name
# ... work, commit often ...
pnpm check
git push -u origin HEAD
gh pr create --fill --body "Closes #<n>"
gh pr merge --squash --delete-branch
git checkout main && git pull
```

New idea that has no issue? `gh issue create --label <backend|frontend> --assignee @me` first.
Stuck? Add the `blocked` label with a comment and pick something else.

### Running more than one agent on the same machine

Give each extra agent its own folder so they don't switch branches under each other:

```bash
git worktree add .worktrees/<n>-short-name -b <n>-short-name origin/main
cd .worktrees/<n>-short-name && pnpm install && pnpm env:copy
```

Use other ports there (`PORT=8788 pnpm dev:api`, `pnpm --filter @michael/web exec next dev --port 3001`).
Merge with `gh pr merge --squash` (no `--delete-branch` inside a worktree), then from the main
folder: `git worktree remove .worktrees/<n>-short-name`.

## Code conventions

- TypeScript everywhere; validate every external input with zod.
- Types come from `@michael/shared` only; never redeclare them in an app.
- Only `apps/api` touches the database (via `Store`) and Gemini. The web app calls the API
  server-side (`apps/web/lib/api.ts`); `USE_MOCKS=true` serves mock data until an endpoint exists.
- API errors: throw `HttpError` (`apps/api/src/http.ts`) so every error has the `ApiError` shape.
- Recommendations may carry an `action`, but nothing executes actions yet (advise-only).
- Auth is a provisional shared `API_KEY`; don't build user accounts.
- Secrets only in env vars; add new ones to the matching `.env.example`.
- Next.js 16 is newer than most training data: read `apps/web/AGENTS.md` before web work.
- No emojis. Comments in English. When an endpoint goes live, update its status in `docs/api.md`.
