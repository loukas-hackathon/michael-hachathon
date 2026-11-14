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

## Workstreams (each one is a GitHub issue; read its latest comment)

| Workstream                                     | Issues                                                    |
| ---------------------------------------------- | --------------------------------------------------------- |
| MCP OAuth: add Michael to Claude with one link | #121, then #156                                           |
| Motion and feedback                            | #244 (shipped #264), #249, #246                           |
| Performance                                    | #234, #255, #241                                          |
| Timeline layout, Goals, calm New goal sheet    | #262 (shipped #263), #117                                 |
| Mobile sweep: Today, You, Chat, Agents, Delete | #239, #219, #27, #11                                      |
| Location on the timeline, no setup             | its own issue ("Location: ...")                           |
| Edit the calendar in the app                   | its own issue ("Timeline: edit your calendar in the app") |
| Onboarding redesign                            | its own issue ("Onboarding: ...")                         |

Left on purpose: #238, #167 and #84 belong to Manolis. #221, #206, #40 and #114 have open PRs by
others. #28 needs hardware. #229 (moving API and web to the EU) is a hosting decision for a human.

## Known gaps

- The Build Hub artifact was shared from outside the organisation of the account that ran these
  sessions, so nobody could sync it. Sync it from an account that can.
- Connectors other than Claude were not tested against production (the cloud sandbox blocks the
  production hosts). A human should tap through Google Calendar, Telegram, Apple Watch and Mac on a
  real phone.
