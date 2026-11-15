# Orchestrator handoff (Sun 15 Nov, updated as work lands)

For a new Claude Code session, possibly on another account, that takes over orchestrating the agents
building Michael. Read AGENTS.md first, then this. Loukas' standing orders: never ask him for
permission, keep building with parallel agents, close every issue we can, phone first (laptop still
developed), keep colours and branding exactly as they are (pink `#E6007A`, red `#FF3B30`), and pace
the usage limit by slowing down at about 60% of the window.

## State (updated 08:40 UTC)
- Production: API https://api-production-16521a26.up.railway.app/health, web
  https://michael-zeta-sand.vercel.app. Supabase project `kpcoadbgevifyvvlhdbt`.
- Merged this morning: #407 CI fix, #408 polish, #403 warmer voice, #391/#394/#396 API speed,
  #392 laptop chat, #406 nudge actions, #409 fast notification tap, #411 meetings mode (migration),
  #404 Focus now (migration), #412/#414/#417 thinking steps, #413 nudge names the goal, #416 Start
  focus on the block nudge, #336 laptop sidebar (Loukas marked it ready).
- Closed: #364, #385, #393, #397, #398, #399, #400, #402, #405, #410.

## Still open
- #389 events_window (#298): Loukas said merge now; CI green on a405373, marked ready. Auto-merge
  (cron every 10 min) should land it. Afterwards check /health, the Migrate database run and Today.
- #280 location draft: Loukas must mark it Ready himself.
- #285 and #267 can close once #336 and #280 are in. Manolis: #319, #303, #28.
- Follow-ups with no issue: after-meeting card on Today (API already returns `last` from
  GET /v1/meetings/active), meetings quick toggle in the Mi sheet, phone guarding for Focus now.

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
