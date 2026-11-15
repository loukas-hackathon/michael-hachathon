# Orchestrator handoff (Sun 15 Nov, updated as work lands)

For a new Claude Code session, possibly on another account, that takes over orchestrating the agents
building Michael. Read AGENTS.md first, then this. Loukas' standing orders: never ask him for
permission, keep building with parallel agents, close every issue we can, phone first (laptop still
developed), keep colours and branding exactly as they are (pink `#E6007A`, red `#FF3B30`), and pace
the usage limit by slowing down at about 60% of the window.

## State (updated 10:25 UTC)
- Production healthy (965172a). This session (loukas-hackathon) is the lead orchestrator.
- Merged since 09:35: #441 chat offline, #442 QA leftovers (#434), #452 Timeline overlaps on iPhone
  (#448), #453 quick resume splash and session kept fresh (#449). Manolis' side: #440, #444, #439, #456.
- Running here (all due 13:30 UTC at the latest):
  - Michael edits and deletes everything (chat, voice, MCP): `remove_calendar_block` for the user's
    own events with undo; Loukas changed the "never deletes" rule to "removes only the user's own
    events, with undo until the event starts". Gap audit of app actions vs chat tools.
  - Voice mode without a transcript: the Mi mark by state, action chips with Undo, words kept in Chat.
  - Sign out broken and laggy, Google sign in with a second account fails (#459, PR #461).
  - Install as app row on /login (iOS steps sheet, Android install prompt).
- Human steps for Loukas: #450 (Supabase jwt_exp 86400 via the Management API), DEMO_PRESENTER_KEY,
  Railway app sleeping off, maybe Google OAuth app publish (if the sign in agent finds Testing mode).
- Manolis' side owns #432 (insights, real time nudges, /learnt, Do Not Disturb #451, discovery #455).
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
