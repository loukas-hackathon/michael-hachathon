# Michael - agent guide

Michael is a coach for the whole day. He builds ONE timeline of the user's day from many sources
(Apple Watch, Google Calendar, Mac and iPhone activity, browser, Claude Code, conversations),
checks it against the user's goals (business, health, personal), and recommends or makes concrete changes
tied to a goal. Claude and other AI agents can read and write the user's day through our MCP server.

Tagline: "On your side." Mission: "Michael finds the time you lose every day and gives it back to
your goals." Hackathon: Sat 14 Nov 12:00 to Sun 15 Nov 24:00 (Athens), finalists Sun 20:00, pitch
Mon 16 Nov. Judged on usefulness, craft and aura. Two people (Loukas, Manolis) steer many Claude
Code agents in parallel. You are trusted: use your judgement; these notes are context, not a cage.

## Where things are

| Path                               | What                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/api`                         | Hono API: REST `/v1`, MCP `/mcp`, webhooks, analysis. Railway.                                     |
| `apps/api/src/store.ts`            | `Store`: the only way to read or write data, scoped to the current user                            |
| `apps/web`                         | Next.js App Router + Tailwind, phone first PWA. Vercel. Read `apps/web/AGENTS.md` first (Next 16). |
| `apps/collector`, `apps/extension` | Run on the user's machines, post events to the API                                                 |
| `packages/shared` + `docs/api.md`  | The shared contract: change them together, in the same PR                                          |
| `supabase/migrations`              | Schema. New file per change; applied automatically on merge                                        |

Live URLs, dashboards and where every setting lives: README "Live services". Commands: `pnpm dev`,
`pnpm check` (typecheck + lint), `pnpm test`, `pnpm e2e` (demo path in a browser), `pnpm format`.

## How we work

- **Own it end to end.** Pick the most valuable unblocked thing (demo path first: real data, analysis,
  Claude connector, the Today/Timeline/Goals/Agents screens), build it, open a PR, and it ships.
  Nobody owns an area; labels say where code lives, not who does it.
- **Stay visible.** Claim the issue (assignee + `in-progress`) with an optimistic ETA comment (aim for
  10 to 30 minutes; ship the smallest working version, improve in the next PR). Glance at open PRs
  and in-progress issues before touching shared files; talk through issue and PR comments.
- **Merging is deploying.** CI runs `pnpm check`, `pnpm test`, the web build, the end-to-end demo path (`e2e/`) and a migration timestamp guard; Auto-merge merges green PRs and closes their issues;
  Deploy API ships to Railway; Migrate database applies new migrations; Vercel redeploys the web.
  Use a draft or the `wip` label to hold a PR. After your merge, check production (`/health` reports
  the deployed commit).
- **Broken beats new.** A failed deploy or migration opens an `incident` issue automatically. Fix it
  forward, then add whatever prevents it next time. Same for anything broken you notice.
- **Human-only setup** (accounts, consoles, phones) lives in `docs/setup-manual.md`, click by click.
  Keep it current when you add something a human must do.
- **Need access you don't have?** Open an `agent-request` issue with the exact steps; any agent that
  can, does it. Ask your human only for product decisions and credentials. Never paste secrets.
- **Improve the workflow** when something slows us down: small `workflow:` PR, one line in
  `docs/workflow-log.md`. Prefer fewer, shorter rules.
- **Several agents on one machine:** one git worktree each (`.worktrees/`), `pnpm env:copy`, other ports.

## The Build Hub is the product source of truth (keep it in sync yourself)

The team's claude.ai artifact (link in `CLAUDE.local.md`; ask your human if missing). Read it with
ArtifactData at session start (a SessionStart hook prints the GitHub side for you):

- `notes`: decisions. A decision the code doesn't reflect yet becomes an issue or a contract change.
- `tasks`: the board. Move a task to `doing`/`done` as its issues move; add tasks for new work.
- `findings`: status, findings and research (`group`, `order`, `title`, `summary`, `body`, `updated`).
  Update `status-now` after merges; add entries for what you learn or test.
  Write in its voice (British spelling, no dashes, no emoji). Never delete other people's entries.
  Humans should never have to sync anything.

## Product decisions that shape code

- **Personal:** every user signs in (Google for the demo) and sees only their own data. The API
  resolves the caller in `apps/api/src/auth.ts` (Supabase token, or `API_KEY` = demo account) and the
  store scopes every query (`currentUserId()`). Never take a user id from a request body.
- **Everything lives in the database** so the user and any AI tool can reach it from anywhere.
- **Simplicity is the product:** connecting a source, integration or AI tool is one tap or one link
  for a non technical user. No keys, URLs, JSON or terminals in the user's path.
- **Claude first:** the claude.ai connector (read and write the day) is the headline demo moment.
- **Autonomy:** acts on the user's own time (own calendar blocks, Mac apps, drafts), advises on the
  rest. Never touches events with other people, never deletes, never sends in the user's name;
  every action can be undone until the event starts.
- Goals have weekly time budgets. Headline score: share of planned goal time actually spent, with
  "time won back" beneath. Morning and Evening moments. At most 5 nudges a day (watch, push,
  Telegram). Off the record stops all collection. Other agents need one tap approval; every query
  is logged ("who asked about me today").
- Demo: Manolis' real week (private names removed), Apple Watch buzzing on stage.

## Privacy

Opt in per source (watch data is health data). Conversations only in user-started meetings mode,
raw audio deleted after transcription, keep only lessons and the user's own commitments. EU
database, full detail 90 days then summaries, deletion really deletes. Send models summaries.

## Voice, copy and look

Everything Michael says, from a model or a template, uses `packages/shared/src/voice.ts`: put
`MICHAEL_VOICE` in the system prompt, check model lines with `voiceProblems`, write durations with
`voiceDuration` ("47 minutes", "2h 15") or `voiceShortDuration` ("47 min", "1h 20"). In short: a tough
sports coach (4 of 5) for founders and executives, number first, one fix, says what he moved and until
when it can be undone, "I" for Michael, "we" for the shared effort, asks only when data is missing.
British spelling, 24 hour time, nudges under 15 words, no emoji, no dashes, no exclamation marks.
Never: productivity, hustle, crush it, journey, wellness, unlock, potential, amazing, great
job, pickups, or the name of the Marvel assistant that inspired the idea. Copy lines: Build Hub voice
sheet. Look: white background, black text, one hot pink for goal time, Apple style, system font in
the app and Mulish outside it; tokens and rules in `docs/design-guide.md`.

## Code

TypeScript; zod on every external input; types only from `@michael/shared`. Only `apps/api` touches
the database and the LLMs. API errors via `HttpError`. Secrets in env vars (update `.env.example`).
Comments in English.
