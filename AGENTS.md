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
| `apps/collector`        | Runs on the user's Mac: reads local data (app usage and more), posts to the API  |
| `packages/shared`       | zod schemas, types, mock data. **Shared contract.**                              |
| `docs/api.md`           | API + MCP contract in words. **Shared contract.**                                |
| `supabase/migrations`   | database schema                                                                  |

## Commands (from repo root)

```bash
pnpm install
pnpm dev          # api :8787 + web :3000
pnpm check        # typecheck + lint
pnpm test         # unit tests (node --test through tsx; put *.test.ts next to the code)
pnpm format       # auto-fix formatting
```

## How we work

This project is built only by agents (Claude Code), steered by two humans. Agents own their task
end to end: pick it, build it, check it, merge it, deploy it. No gatekeepers, no required reviews.
Be proactive (find the next useful thing and do it) and reactive (notice what changed and adapt).

**Nobody owns an area.** Loukas and Manolis both take backend AND frontend work, and each runs as
many agents in parallel as useful. The `backend` / `frontend` labels only say where the code lives,
not who does it. Always take the most valuable unblocked issue, whatever its label.

### Two sources of truth, read them yourself

- **Build Hub** (product): the team's shared claude.ai artifact with the brief, brand, decisions log
  and board. Its link is in `CLAUDE.local.md` (gitignored, because the link grants edit access;
  if the file is missing, ask your human for the link). Read its `notes` (decisions) and `tasks`
  (board) collections with the ArtifactData tool, and the page itself with the Artifact tool.
- **GitHub issues and PRs** (code): `gh issue list`, `gh pr list`, `git log origin/main`.

Read both at the start of every session and again before each new task. Never wait to be told
about a change: if the Build Hub has a decision the code doesn't reflect yet, create an issue for it
(or update the contract) yourself.

### The loop

```bash
# 1. Catch up (every task)
git checkout main && git pull
gh issue list --label agent-request          # can you do one of these right now? do it first
gh issue list --label in-progress            # who is on what, with ETAs in the comments
git fetch --all --prune && git log --oneline -15 origin/main   # what just landed
gh pr list --state open                      # work in flight: read titles, then `gh pr diff <n>`
git branch -r --sort=-committerdate | head   # pushed branches, newest first, incl. ones with no PR yet
# + read the Build Hub decisions and board (see above)

# 2. Pick: the most valuable unassigned issue whose dependencies are merged (or nearly: see ETAs)
gh issue list --search "no:assignee sort:created-asc"   # lower number = earlier in the plan
gh issue edit <n> --add-assignee @me --add-label in-progress
gh issue comment <n> --body "Claimed. ETA 17:30 (optimistic). Plan: <one line>"

# 3. Build on a branch, commit often
git checkout -b <n>-short-name
pnpm check && git push -u origin HEAD
gh pr create --fill --body "Closes #<n>" && gh pr merge --squash --delete-branch
git checkout main && git pull

# 4. Close the loop (see below), then go back to 1
```

### Optimistic ETAs

Every issue carries an optimistic ETA (Athens time) so every agent can see what will exist and when.
It is a hackathon and agents are fast: plan on 15 to 45 minutes per issue, not hours.

- Each open issue has a `Planned: <day> HH:MM` line in its body: when we expect it merged.
- When you claim an issue, comment `ETA HH:MM` (optimistic: we move fast). If it slips, comment the new
  ETA straight away. On merge the issue closes, which is the "done" signal.
- Use other agents' ETAs to plan: if you need an endpoint that lands at 18:00, build against the
  mocks in `@michael/shared` now and switch over after it merges, rather than waiting.
- If you finish early, pull the next issue forward and tighten the `Planned` times that depend on it.

### Close the loop after every merge

- Comment on issues that depended on yours ("#12 is merged: `/v1/...` is live").
- Update `docs/api.md` status (stub -> live) in your PR when an endpoint goes live.
- Update the Build Hub board: move the matching task to `doing` when work starts and to `done` when
  the feature is live. Add a `note` of kind `decision` for any product-visible choice you made, and
  a `link` for new deploy URLs. Keep entries short and in the Build Hub's voice (British spelling,
  no dashes, no emoji). Never delete or rewrite other people's notes.
- Spotted a bug or a gap? Open an issue for it with files, dependencies and a `Planned` time.

### Automation: merging is deploying

| On merge to `main`                 | What happens                                                | Check it                                                                               |
| ---------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| API, shared or root config change  | GitHub Action `Deploy API` ships it to Railway (2 to 3 min) | `curl https://api-production-16521a26.up.railway.app/health` (`commit` = deployed SHA) |
| any change                         | Vercel redeploys the web app                                | https://michael-zeta-sand.vercel.app                                                   |
| new file in `supabase/migrations/` | GitHub Action `Migrate database` applies it to production   | `gh run list --workflow migrate.yml`                                                   |
| every PR and push                  | GitHub Action `CI` runs `pnpm check`                        | `gh pr checks` / `gh run list`                                                         |

- **Merge your own PRs** as soon as `pnpm check` is green; nobody verifies manually.
- **Database changes are code:** add a new timestamped `.sql` file in `supabase/migrations/`, merge
  it, and the action applies it. Never edit an applied migration and never apply SQL by hand. If
  the action fails, read `gh run view --log-failed`, fix forward with a new migration.
- **After every merge, verify production** (health, the page, the endpoint you touched). If it
  broke, fix it immediately; that beats everything else on your list.

### Agents talk through GitHub

- Comments are the chat: `gh issue comment <n>` / `gh pr comment <n>`. During catch-up read the
  comments on your issues and on everything `in-progress` (`gh issue view <n> --comments`), and
  answer questions addressed to you or your area.
- **Need something you can't do** (a secret, a dashboard setting, an account, a command that needs
  credentials you don't have)? Open an issue labelled `agent-request` with the exact command or
  steps, why, and what unblocks. Every agent checks `gh issue list --label agent-request` during
  catch-up; one that can do it does it, comments the result and closes it. Only if no agent can,
  it asks its human.
- Never paste secret values into issues or comments; say where they are set instead.

### Improve the workflow yourself

When you hit friction, a repeated mistake, or a rule that slows us down, fix it on the spot: edit
`AGENTS.md`, a script, or a workflow in a small PR titled `workflow: <what>`, merge it, and add one
line to `docs/workflow-log.md` (what changed and why). No permission needed. Keep rules few and short.

### Watch the work in flight, not only `main`

- Before you touch a file, check whether an open PR or a recent branch already changes it:
  `gh pr list --search "<path or keyword>"`, `gh pr diff <n> --name-only`,
  `git log origin/<branch> --oneline -5`, `git diff origin/main...origin/<branch> --stat`.
- Build on top of in-flight work instead of redoing it: if you need code from an open PR, comment
  on it, or branch from its branch and say so in your PR.
- Review as you pass: if another agent's open PR has an obvious bug, conflicts with your work, or
  breaks the contract, leave a `gh pr comment` (or fix it on their branch if it's tiny and green).
- Stale work: a branch with no commits for 2 hours and no open PR is fair game; comment on its
  issue, then take it over or delete the branch.

### Habits that prevent collisions

- **Claim before you code** and steer around files listed in other `in-progress` issues. If you
  must touch them, comment on that issue first.
- **Keep the shared contract in sync.** If you change `packages/shared`, update `docs/api.md` (and
  add a migration if the DB changes) in the same PR, and mention it in the issue.
- **Merge small and often.** `pnpm check` green is enough. Frequent commits are judged.
- **Ask the human only for real product decisions or credentials.** For third-party APIs, read the
  official docs rather than guessing.
- **Several agents on one machine:** give each its own folder:
  `git worktree add .worktrees/<n>-name -b <n>-name origin/main`, then `pnpm install &&
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
- **Real data by Sunday:** Apple Watch, Google Calendar, Mac activity, iPhone app opens. Public or
  seeded data fills the gaps. Omi/conversations and WHOOP come after those.
- **Main surface:** a phone first, installable web app (PWA) built around dashboards (Today, weekly
  score). No native app.
- **Demo:** Manolis is the demo user with real data (private names edited out) and wears an Apple
  Watch on stage; the live moment is the watch buzzing while Michael's message shows on the big screen.

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
  not a face. No eyes, robots, or gradients/glow on the logo. Colours and fonts: use the provisional
  tokens in the Build Hub's "Colour and type" section (currently Palette 1 Forest, font Figtree)
  as CSS variables, so a later pick only changes the values.

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
