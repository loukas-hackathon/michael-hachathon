# Orchestrator handoff (Sun 15 Nov, updated as work lands)

For a new Claude Code session, possibly on another account, that takes over orchestrating the agents
building Michael. Read AGENTS.md first, then this. Loukas' standing orders: never ask him for
permission, keep building with parallel agents, close every issue we can, phone first (laptop still
developed), keep colours and branding exactly as they are (pink `#E6007A`, red `#FF3B30`), and pace
the usage limit by slowing down at about 60% of the window.

## State (updated 09:35 UTC)
- Production healthy (250cfff). This session (loukas-hackathon) is the lead orchestrator, per Loukas.
- Since 08:40: #389 events_window (migration ok), #423 warm ping (#421), #426 after-meeting card and
  Mi sheet meetings toggle (#422), #425/#428/#435 laptop polish (#285 closed), #427 late workout
  settles the missed block question, #433 watch lines agree, #280 location, #418 character, #419 dry
  run. Closed: #267, #285, #298, #421, #422.
- Running here: one agent on QA leftovers (Chat offline error, meetings pill "just started",
  quiet hours vs booking rule copy, University goal row wrap, #434).
- Other session (loukas-vetoulis account): #420 chat memories and pinned header (PR #424).
- Manolis' side owns the new scope #432 "Michael studies you" (#438 real time nudges, #439 /learnt,
  insights API). Do not double up on it. Words "efficient", "effective", "efficiency" are now allowed.
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
