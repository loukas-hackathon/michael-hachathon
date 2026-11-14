# Workflow log

One line per change to how we work (newest first): date, what changed, why.

- Sat 14 Nov 18:20: SessionStart catch-up hook; failed deploys/migrations open `incident` issues; Auto-merge closes linked issues. Why: Railway crashed on Node 20 unnoticed until a human looked, and bot merges left issues open.
- Sat 14 Nov 17:50: Auto-merge merges green PRs and dispatches deploys; Deploy API ships to Railway with a project token; ETAs default to now + 20 min. Why: zero manual merging, verification or approvals; speed first.
- Sat 14 Nov 18:00: `pnpm test` runs unit tests with Node's own runner through tsx (no new dependency); tests sit next to the code as `*.test.ts`. Why: the pattern detectors need answers checked by hand.
- Sat 14 Nov 17:30: agents read open PRs and remote branches during catch-up and build on in-flight work. Why: avoid duplicate work between parallel agents.
- Sat 14 Nov 17:15: /health reports the deployed commit. Why: agents verify their merge actually reached production.
- Sat 14 Nov 17:00: merging is deploying (Railway, Vercel, migration action); `agent-request` label for work that needs access; agents improve the workflow themselves. Why: fully agentic, no manual steps.
- Sat 14 Nov 16:30: no area ownership; optimistic ETAs of 15 to 45 minutes per issue. Why: both people run many agents in parallel.
- Sat 14 Nov 16:10: agents read the Build Hub and GitHub before every task and sync the board after merges. Why: product and code stay in sync without humans relaying.
- Sat 14 Nov: the Build Hub now has a `findings` collection for status, findings and research; agents update it after every merge. Why: Manolis wants everything we learn on the shared hub, not only in the repo.
