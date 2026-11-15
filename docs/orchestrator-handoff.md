# Orchestrator handoff (Sun 15 Nov, updated as work lands)

For a new Claude Code session, possibly on another account, that takes over orchestrating the agents
building Michael. Read AGENTS.md first, then this. Loukas' standing orders: never ask him for
permission, keep building with parallel agents, close every issue we can, phone first (laptop still
developed), keep colours and branding exactly as they are (pink `#E6007A`, red `#FF3B30`), and pace
the usage limit by slowing down at about 60% of the window.

## State (updated 07:45 UTC)
- Production: API https://api-production-16521a26.up.railway.app/health, web
  https://michael-zeta-sand.vercel.app. Supabase project `kpcoadbgevifyvvlhdbt`.
- CI is green again: #407 fixed incident #402 (the Off the record switch dropped a second tap).
- Merged this morning: #407 CI fix, #408 polish (#385, #393), #403 warmer voice (#398),
  #391, #394, #396 API speed (#298). Today's first open went from 5.5 s to 2.4 s.
- Loukas' deadline: everything that can land is merged by 08:45 UTC. After that he works on UI and UX.

## Still in flight (check each PR; restart small if it has stalled)
- #392 laptop chat (#285): main merged into the branch, waiting for CI.
- Thinking steps (branch `thinking-steps`): a new SSE `step` event per tool call, a live step line in
  chat and voice, and "How I worked it out" collapsed under each reply. Loukas asked for this.
- #389 events_window (#298): Loukas approved landing it if it is safe. It merges only when the
  migration is purely additive, has a fallback when the RPC fails, and the results are proven
  equivalent. Deadline 14:00 UTC. Check /health and the Migrate database run afterwards.
- Slow notification tap (branch `nudge-open-fast`): HIGH PRIORITY, more than 10 s. On
  notificationclick, focus or navigate an existing window, render the card from the payload, skip
  the blocking session refresh, lower the service worker shell timeout.
- #404 Focus now (#397) and #406 nudge actions (#399): drafts. Land them if green, else leave them.
- Meetings mode: consent sheet, start and end with the pill, Omi ingest only during a session.
- Loukas must mark #280 and #336 Ready himself (the permission check refused agents doing it).

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
