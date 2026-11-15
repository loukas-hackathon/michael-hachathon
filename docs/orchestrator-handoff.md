# Orchestrator handoff (Sun 15 Nov, updated as work lands)

For a new Claude Code session, possibly on another account, that takes over orchestrating the agents
building Michael. Read AGENTS.md first, then this. Loukas' standing orders: never ask him for
permission, keep building with parallel agents, close every issue we can, phone first (laptop still
developed), keep colours and branding exactly as they are (pink `#E6007A`, red `#FF3B30`), and pace
the usage limit by slowing down at about 60% of the window.

## State (updated 12:10 UTC)
- Production healthy (0a99ecb). This session (loukas-hackathon) is the lead orchestrator.
- Since 11:15: #484/#496/#500 email only sign in (Loukas decided: no Google sign in; Google only for
  calendar), create account lands signed in, new /login; #489 iPhone opens stored at once; #490 Michael
  knows real connection states, no Mac guard without a live Mac; #497 shortcut opens in Safari (not
  shortcuts://import-shortcut); #481 Railway never sleeps (railway.json).
- Loukas deleted his four accounts (done via auth.users cascade) to start fresh.
- Running (all due 13:45 UTC): instant resume after long idle (last known screen from the service
  worker per user, taps never wait), real account QA walk, copy/voice/numbers audit (#503 open),
  accessibility pass (invisible fixes only; Loukas: never change branding).
- Scheduled: final stage rehearsal QA at 13:50 UTC.
- Human steps for Loukas: create his account, reconnect sources, re-add the iPhone shortcut;
  DEMO_PRESENTER_KEY on Vercel + Railway; optional #450 jwt_exp 86400; reseed at T-60 and T-15.
- Freeze: after 15:00 UTC only copy, CSS, test fixes; after 17:30 UTC no merges unless stage breaking.

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
