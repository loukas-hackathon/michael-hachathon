# Orchestrator handoff (Sun 15 Nov, updated as work lands)

For a new Claude Code session, possibly on another account, that takes over orchestrating the agents
building Michael. Read AGENTS.md first, then this. Loukas' standing orders: never ask him for
permission, keep building with parallel agents, close every issue we can, phone first (laptop still
developed), keep colours and branding exactly as they are (pink `#E6007A`, red `#FF3B30`), and pace
the usage limit by slowing down at about 60% of the window.

## State (updated 11:15 UTC)
- Production healthy (8aee7f0). This session (loukas-hackathon) is the lead orchestrator.
- Merged since 10:25: #461/#462 sign in/out (service worker double navigation), #464/#467/#473 Michael
  edits and removes the user's own events with undo (rule changed by Loukas), #465 Get the app on
  /login, #469 shortcut no longer traps the installed app, #470 status bar one cover, #471 voice mode
  with no transcript, #472 Timeline columns and no text on text (with a permanent overlap e2e),
  #476/#477 iPhone hand run test and live connection rows, #482 email sign in, #485 first minute for a
  new account, #486 Michael never claims an action he did not make, #487 chat timestamps with the day.
- Open: #484 (email sign up creates confirmed accounts server side, no Supabase setting needed),
  #489 (iPhone opens stored at once), #481 (Railway never sleeps via railway.json).
- Scheduled: final stage rehearsal QA at 13:50 UTC (one agent, read only on production, CSS/copy fixes).
- Human steps for Loukas: Google OAuth test users or publish; DEMO_PRESENTER_KEY on Vercel + Railway;
  optional #450 jwt_exp 86400; reopen the installed app; reseed at T-60 and T-15.
- Manolis' side owns #432 (insights, real time nudges, /learnt, Do Not Disturb, discovery).
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
