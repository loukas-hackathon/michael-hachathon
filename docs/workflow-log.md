# Workflow log

One line per change to how we work (newest first): date, what changed, why.

- Sat 14 Nov 23:00: Vercel pull request previews back on (main only `git.deploymentEnabled` removed from apps/web/vercel.json). Why: the team is on Vercel Pro, so previews no longer eat a daily deployment limit (#283).
- Sat 14 Nov 20:10: CI runs `pnpm test` (hermetic: `apps/api/src/test-env.ts` clears real keys), `pnpm --filter @michael/web build` and a migrations guard (unique timestamps, new files sort after main; Auto-merge rechecks against main before merging). Why: regressions slipped through untested merges, a web build break blocked API deploys, and duplicate migration timestamps stopped production migrations (#178).
- Sat 14 Nov 20:05: Vercel builds only main (apps/web/vercel.json); PR previews off. Why: previews plus merges hit the Hobby daily deployment limit and production stopped updating (#161).
- Sat 14 Nov 18:25: AGENTS.md rewritten lean (247 to about 90 lines): goals, facts and a few principles instead of scripts. Why: strong models need context, not step-by-step rules.
- Sat 14 Nov 18:20: SessionStart catch-up hook; failed deploys/migrations open `incident` issues; Auto-merge closes linked issues. Why: Railway crashed on Node 20 unnoticed until a human looked, and bot merges left issues open.
- Sat 14 Nov 17:50: Auto-merge merges green PRs and dispatches deploys; Deploy API ships to Railway with a project token; ETAs default to now + 20 min. Why: zero manual merging, verification or approvals; speed first.
- Sat 14 Nov 18:00: `pnpm test` runs unit tests with Node's own runner through tsx (no new dependency); tests sit next to the code as `*.test.ts`. Why: the pattern detectors need answers checked by hand.
- Sat 14 Nov 17:30: agents read open PRs and remote branches during catch-up and build on in-flight work. Why: avoid duplicate work between parallel agents.
- Sat 14 Nov 17:15: /health reports the deployed commit. Why: agents verify their merge actually reached production.
- Sat 14 Nov 17:00: merging is deploying (Railway, Vercel, migration action); `agent-request` label for work that needs access; agents improve the workflow themselves. Why: fully agentic, no manual steps.
- Sat 14 Nov 16:30: no area ownership; optimistic ETAs of 15 to 45 minutes per issue. Why: both people run many agents in parallel.
- Sat 14 Nov 16:10: agents read the Build Hub and GitHub before every task and sync the board after merges. Why: product and code stay in sync without humans relaying.
- Sat 14 Nov: the Build Hub now has a `findings` collection for status, findings and research; agents update it after every merge. Why: Manolis wants everything we learn on the shared hub, not only in the repo.
- Sat 14 Nov: `/idea` command (`.claude/commands/idea.md`). Why: ideas were told to one chat and reached the Build Hub, the repo and the other chats unevenly. One procedure now records the idea everywhere and tells each chat what changes for it.
- Sat 14 Nov 17:35: `Migrate database` runs `db push --include-all`. Why: parallel PRs merged migrations out of timestamp order (personal_tokens after google_calendar) and the push refused, blocking every later migration.
- Sat 14 Nov 18:50: `Railway region` workflow (dispatch only) shows where the API runs and moves it with `railway scale`. Why: `multiRegionConfig` in railway.json did not move the API to the EU (#229), and nobody has a Railway seat to click Region.
- Sat 14 Nov 21:30: CI job `e2e` and `pnpm e2e`: Playwright drives the production web build against the in-memory API through the whole demo path (login, Today, Timeline, Goals, Do it and Undo, chat, Agents, stage N, onboarding), failing on any console error, outside request or serious axe finding. Why: a merge could break the pitch with every unit test green.
- Sat 14 Nov 23:59: `.scratch/` is gitignored. Why: agents keep screenshots, logs and one off scripts there, and one careless `git add .` would commit them.
