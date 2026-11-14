# Handoff: where the work stands

If you are an agent picking this up (for example on another account after a usage limit), start
here, then read AGENTS.md. Each running workstream keeps a comment on its GitHub issue saying what
is done, what is in progress, what comes next, and any gotchas. Open PRs with the `wip` label or in
draft hold unfinished work: continue on that branch.

## Loukas' product direction (14 Nov, evening)

- The app must feel intuitive with no tutorials: little text, sensible defaults, one obvious action
  per screen. Mobile first; the laptop layout must still work. Study the best consumer apps (Apple
  Health and Fitness, Duolingo, Linear, Things) before designing.
- Forms and sheets: at most about three inputs by default; advanced options sit behind one collapsed
  "More options" row. No footnotes under fields. Placeholders never look like filled values.
- Same words for the same thing everywhere. Connections: buttons are only Connect or Manage, and
  states are Connected, Not connected, Paused or Needs attention.
- Onboarding: understood at once, data in with no manual steps. Sign in, calendar, goals in under a
  minute; everything else optional, one tap each.
- Edit the calendar directly in the app (Timeline), on the user's own blocks, with undo.
- Location matters: where the user is through the day, on the timeline and in coaching, with no
  setup where possible. Future options are in docs/location.md.
- Goals: closing the week should pull you on, like closing a ring or keeping a streak.
- Michael and every connected agent remember what the user told them (chat memory, shipped #261).
- The launch animation plays every time the app opens (#273).
- WHOOP and Meetings (Omi) are out of the app for now.

## Workstreams (status at 22:40 UTC, 14 Nov; each issue's latest comment is the live state)

| Workstream                                     | Issue(s)                      | State                                              |
| ---------------------------------------------- | ----------------------------- | -------------------------------------------------- |
| MCP OAuth: add Michael to Claude with one link | #121                          | Shipped (#268). Needs the human test below         |
| Timeline layout, calm New goal sheet           | #262, #269, #117              | Shipped (#263, #265, #274); #117 closed as covered |
| Motion and feedback                            | #244, #249, #246              | #244 shipped (#264); #249 and #246 in progress     |
| Performance                                    | #234, #255, #241              | #234 shipped (#266); #255 and #241 in progress     |
| Mobile sweep: Today, You, Chat, Agents, Delete | #239, #219, #27, #11          | #239 shipped (#272); #219, #27, #11 in progress    |
| Location on the timeline, no setup             | #267                          | In progress: contract and visits module            |
| Edit the calendar in the app                   | #271                          | In progress: API undo plumbing for in app edits    |
| Onboarding redesign                            | its issue ("Onboarding: ...") | In progress                                        |
| Parking near the destination                   | #156                          | Not started                                        |

Unfinished work sits on each session's branch, in a draft PR or one labelled `wip`. Continue on
that branch; drop the `wip` label or mark the PR ready when done, and it auto-merges on green.

## Human test still needed

Claude connector with no key (#121): sign out of Michael, add
`https://api-production-16521a26.up.railway.app/mcp` as a custom connector on claude.ai (web) and in
the Claude iPhone app, sign in with Google, tap Allow, and ask one question in each.

## Prompt to continue from another account

Paste this into a new Claude Code session on the repo:

> Read docs/handoff.md and AGENTS.md. For each workstream that is not shipped, read its issue's
> latest comment, check out its branch, and finish it end to end (small PRs, CI green, auto-merge).
> Work in parallel sessions, one per workstream. Keep Loukas' product direction above. Before your
> own limit ends, push everything and update the issue comments and this file.

Left on purpose: #238, #167 and #84 belong to Manolis. #221, #206, #40 and #114 have open PRs by
others. #28 needs hardware. #229 (moving API and web to the EU) is a hosting decision for a human.

## Known gaps

- The Build Hub artifact was shared from outside the organisation of the account that ran these
  sessions, so nobody could sync it. Sync it from an account that can.
- Connectors other than Claude were not tested against production (the cloud sandbox blocks the
  production hosts). A human should tap through Google Calendar, Telegram, Apple Watch and Mac on a
  real phone.
