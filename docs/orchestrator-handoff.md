# Orchestrator handoff (Sun 15 Nov, 07:30 UTC / 09:30 Athens)

For a new Claude Code session, possibly on another account, that takes over orchestrating the agents
building Michael. Read AGENTS.md first, then this. Loukas' standing orders: never ask him for
permission, keep building with parallel agents, close every issue we can, phone first (laptop still
developed), keep colours and branding exactly as they are (pink `#E6007A`, red `#FF3B30`), and pace
the usage limit by slowing down at about 60% of the window.

## State
- Production: API https://api-production-16521a26.up.railway.app/health (commit 11d8a5c at handoff),
  web https://michael-zeta-sand.vercel.app. Supabase project `kpcoadbgevifyvvlhdbt`.
- **Bottleneck:** CI e2e is red on main (incident #402). The fix is PR #407 (`e2e-on-record-402`):
  the presenter's off the record test left the demo account off the record and broke the booking
  tests. Get #407 green and merged first, then update the branches of the other PRs so they re-run.
- Loukas' deadline: everything that can land is merged by 08:45 UTC. After that he works on UI and UX.

## Open PRs (land in this order)
1. #407: CI fix (#402)
2. #394 (memo) and #396 (phone cadence): API speed (#298). Update branches after #407.
3. #392: chat pane on a laptop (#285)
4. #403: warmer voice (#398)
5. #408: polish (#385, #393)
6. Drafts: #404 Focus now (#397) and #406 nudge actions (#399). Land them if green by the
   deadline, else leave them as drafts.
7. Hold until after the pitch: #389 (DB function, #298). Loukas must mark #280 and #336 Ready
   himself; the permission check refused agents doing it.

## In flight without a PR at handoff
- Branch `nudge-open-fast`: tapping a nudge notification takes over 10 s to load (HIGH PRIORITY).
  The fix: on notificationclick, focus or navigate an existing window, render the nudge card from
  the push payload, skip the blocking session refresh, and lower the service worker shell timeout.
- Meetings mode: consent sheet, start and end with the indicator pill, Omi ingest only during a
  session, off the record wins. Check for a branch or PR; restart it small if there is none.

## Rules learned the hard way
- Never write to the production demo account (test locally). Never push test notifications to
  real devices. Never paste secrets; the presenter key never goes in chat or the repo.
- Migrations: a new timestamped file, unique and later than every existing one (the CI guard checks).
- If the permission check refuses an agent an action, do not do it for them. Ask Loukas.
- Finals freeze: after 17:00 Athens only copy, CSS and test fixes; after 19:30 Athens no merges
  unless something is stage breaking.
- After the deadline: resume the QA loop (Playwright walk of the demo path, fix what breaks).

## Human steps still open (Loukas)
- Set DEMO_PRESENTER_KEY on Vercel (then redeploy) and Railway, and open the presenter link
  on the stage laptop.
- ElevenLabs Speech to Text permission on the "michael" key.
- Delete the `bundle-diet` branch.
- Connect claude.ai from the presenter browser.
- Set the stage laptop's Chrome to English (UK).
- Reseed the demo at T-60 and T-15.
- Stage iPhone: nudges on, watch mirroring on, Focus off.

## Manolis
- #319: Michael's character, pick a direction from his options sheet.
- #303: signed Shortcut plus MICHAEL_SHORTCUT_URL.
- #28: hardware check.
- His part of the pitch.

## Build Hub
The link is in CLAUDE.local.md, which is gitignored: ask Loukas. Keep `findings/status-now` and
`tasks` in sync after merges.
