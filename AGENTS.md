# Michael - agent guide

Michael is a coach for the whole day. He builds ONE timeline of the user's day from many sources
(Apple Watch via Health Auto Export, WHOOP, ActivityWatch, iPhone Shortcuts, Omi, Google Calendar),
checks it often against the user's goals (work, gym, rest, food), and recommends or makes concrete
changes tied to a goal. Other AI agents can ask Michael about the user through our MCP server.

Tagline: "On your side." Mission: "Michael finds the time you lose every day and gives it back to
your goals." Product decisions live in the team's Build Hub; the parts that affect code are below.

Hackathon: Sat 14 Nov 12:00 -> Sun 15 Nov 24:00 (Athens). Finalists Sun 20:00, pitch Mon 16 Nov.
Two people (Loukas, Manolis) running Claude Code agents in parallel. Judged on usefulness, craft,
aura. Move fast, keep quality, commit often.

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
pnpm check        # typecheck + lint
pnpm format       # auto-fix formatting
```

## How we work

Agents own their task end to end: pick it, build it, check it, merge it, deploy it. There are
no gatekeepers and no required reviews. A few habits keep two people and many agents from
colliding:

- **Say what you're on.** Assign yourself the issue (or create one) and add `in-progress`, so the
  other side's agents can see it and steer around the files it lists.
- **Branch and PR, then merge it yourself.** `pnpm check` green is enough to merge. PRs give us a
  readable history and frequent commits, which the organisers want to see.
- **Keep the shared contract in sync.** If you change `packages/shared`, update `docs/api.md` (and
  add a migration if the DB changes) in the same PR, and mention it in the issue.
- **Ask the human when a product decision is unclear.** For third-party APIs, check the official docs
  rather than guessing.

```bash
git checkout main && git pull
gh issue list --label in-progress            # what others are on
gh issue list --search "no:assignee"         # pick one whose dependencies are done
gh issue edit <n> --add-assignee @me --add-label in-progress
git checkout -b <n>-short-name
# ... work, commit often ...
pnpm check && git push -u origin HEAD
gh pr create --fill --body "Closes #<n>" && gh pr merge --squash --delete-branch
git checkout main && git pull
```

Several agents on one machine? Give each its own folder so they don't switch branches under each
other: `git worktree add .worktrees/<n>-name -b <n>-name origin/main`, then `pnpm install &&
pnpm env:copy` inside it, use other ports (`PORT=8788 pnpm dev:api`), and merge with
`gh pr merge --squash` (no `--delete-branch` inside a worktree).

## Product decisions that affect code

- **Autonomy:** "acts on your time, advises on your life". Michael may act on the user's OWN
  calendar blocks and Mac: move blocks, create focus blocks, block distracting Mac apps, draft
  follow-ups. He never touches events with other people, never deletes, never sends in the user's
  name. Every action can be undone until the event starts.
- **Goals** have a weekly time budget (for example "70.3 training: 9 hours this week").
- **Headline score:** share of planned goal time actually spent on goals; "time won back" beneath.
- **Two moments:** Morning (when the watch detects waking) and Evening (one hour before usual bedtime).
- **Nudges:** at most 5 per day, via watch, push and Telegram. Chat by typing or voice.
- **Navigation:** Today, Timeline, Goals, Agents.
- **Off the record:** one tap stops all collection.
- **Michael for agents:** other agents query Michael within scopes the user chooses. A new agent's
  first request needs one-tap approval; every query is logged and visible ("who asked about me today").
- **Demo:** Manolis is the demo user with real data and wears an Apple Watch on stage.

## Privacy rules (build them in, don't bolt them on)

- Watch data is health data: explicit opt-in and one on/off switch per source.
- Conversations are recorded only in a user-started meetings mode. Raw audio is deleted after
  transcription. Store only lessons and the user's own commitments, never other people's words.
- EU-region database. Full detail for 90 days, summaries after. Deletion must really delete.
- Send summaries to models where possible, not raw data.

## Voice and copy (any user-facing text)

- Michael is a firm sports coach: talks only about goals, asks only when unsure, admits mistakes in
  one line, respects quiet hours (deep work, dinner, after 22:00), shows the maths when goals compete.
- British spelling, 24-hour time, nudges under 15 words. "I" for Michael's actions, "we" for the team.
- No emoji. No dashes in copy. Never use the words "productivity" or "wellness".
- Never name the Marvel assistant that inspired the idea, anywhere public (code, README, UI, commits).
- Visual: light paper by default, dark at night and on the watch, warm humanist sans. The symbol is
  not a face. No eyes, robots, or gradients/glow on the logo. Colours and fonts: ask Manolis/Loukas.

## Code conventions

- TypeScript everywhere; validate every external input with zod.
- Types come from `@michael/shared` only; never redeclare them in an app.
- Only `apps/api` touches the database (via `Store`) and Gemini. The web app calls the API
  server-side (`apps/web/lib/api.ts`); `USE_MOCKS=true` serves mock data until an endpoint exists.
- API errors: throw `HttpError` (`apps/api/src/http.ts`) so every error has the `ApiError` shape.
- Auth is a provisional shared `API_KEY`; don't build user accounts.
- Secrets only in env vars; add new ones to the matching `.env.example`.
- Next.js 16 is newer than most training data: read `apps/web/AGENTS.md` before web work.
- Comments in English. When an endpoint goes live, update its status in `docs/api.md`.
