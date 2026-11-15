# Orchestrator handoff (Sun 15 Nov, updated as work lands)

For a new Claude Code session, possibly on another account, that takes over orchestrating the agents
building Michael. Read AGENTS.md first, then this. Loukas' standing orders: never ask him for
permission, keep building with parallel agents, close every issue we can, phone first (laptop still
developed), keep colours and branding exactly as they are (pink `#E6007A`, red `#FF3B30`), and pace
the usage limit by slowing down at about 60% of the window.

## State (updated 13:50 UTC / 15:50 Athens)
- This session (loukas-hackathon) is the lead orchestrator. Production healthy (API f6c86ec).
- Since 13:00: #528 iCloud shortcut links as defaults (Michael c0c2a08d..., Focus 76e297e8...),
  #530 off the record never set by focus/DND words, Michael always states it; #531 automation opens
  with no app name stored as "An app" (iOS App automations pass no input); #532 setup steps, shortcut
  source sends `input` too (the signed file needs re-signing on a Mac: `pnpm shortcut`); #535 Focus now
  runs the Michael Focus shortcut (Do Not Disturb until the end), smooth ring, full title, breathing Mi.
- Loukas' real account: 7259e4cf... (email sign up). Off the record was ON by accident 14:47 to 15:08
  (the You switch row); now off.
- Loukas' first iPhone open stored 13:38 UTC ("An app"). He edited his Michael shortcut so `app` = plain
  Shortcut Input (not its Name); with a per app automation (Text "Instagram" then Run Shortcut Michael)
  names should now arrive. His goal is literally named "Personal T".
- Building (hard deadline 14:45 UTC): "My automation is for" picker on the iPhone page. Unnamed
  shortcut opens get that app name (data.app_assumed); saving renames today's "An app" events; no
  migration. Loukas asked for it; check it merged and tell him to pick Instagram.
- Running (due 14:40 UTC): Focus agent fixing End early stuck on "Saving" and the hidden session pill
  covering the chat composer, then "min kept" + finish moment; a chat agent fixing Michael saying the
  iPhone is not connected (connections-state must match GET /live/connections).
- Scheduled: final stage rehearsal QA at 13:50 UTC (send_later), next build cycle 13:56 UTC.
- Known gaps for after the pitch: #514 (brief/check-ins ignore shortcut opens), app names need the
  re-signed shortcut or the user editing the shortcut to send "Shortcut Input" not its Name,
  Screen Time needs the Mac app (Apple gives it only to native apps).
- Human steps for Loukas: DEMO_PRESENTER_KEY on Vercel + Railway; connect Claude from the presenter
  browser; reseed at T-60 (19:00) and T-15 (19:45) Athens; stage iPhone nudges on, watch mirroring,
  Focus off; optional #450 jwt_exp 86400.
- Freeze: after 15:00 UTC (17:00 Athens) only copy, CSS, test fixes; after 17:30 UTC (19:30 Athens)
  no merges unless stage breaking. Pitch at 20:00 Athens.

## Prompt to continue from another account
Paste into a new Claude Code session on loukas-hackathon/michael-hachathon:

> Read AGENTS.md, then docs/orchestrator-handoff.md on branch claude/busy-fermi-qlziqe. You are the
> lead orchestrator now. Check open PRs and production /health, land anything stuck within the freeze
> rules, run the final stage rehearsal if it has not run, and keep Loukas posted. Don't ask for
> permission; small safe fixes only after 17:00 Athens.

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
