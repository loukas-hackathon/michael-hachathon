# Pitch: three minutes

One speaker talks, one drives. Everything below is on `main` and was checked in code on Sat 14 Nov
(commit `e906d43`). Run `docs/demo-runbook.md` first. Lines in quotes are said out loud; numbers are
read off the screen, never from this page, because the demo week follows the clock.

**Setup on stage.** Laptop on the projector, signed in to the demo week, tabs open in the runbook's
order. Speaker wears the Apple Watch; the paired iPhone is locked in a pocket. A second phone or the
laptop has claude.ai with the Michael connector on.

**Every screen used** is the demo account: the web app through "See the demo week" (`/auth/demo`),
and the claude.ai connector authorised from that same browser, so Claude, Today, the stage and the
watch all see one day.

| Time      | Beat                     | Screen                          |
| --------- | ------------------------ | ------------------------------- |
| 0:00 0:20 | The problem              | `/stage`                        |
| 0:20 0:30 | The promise              | `/stage`                        |
| 0:30 1:05 | One day, the maths       | Today, Timeline, Goals          |
| 1:05 1:45 | Claude reads and books   | claude.ai, then Today           |
| 1:45 2:00 | Voice                    | claude.ai voice mode (or /chat) |
| 2:00 2:20 | The watch buzzes         | `/stage`, press N               |
| 2:20 2:35 | Who asked about me today | Agents                          |
| 2:35 2:52 | Privacy                  | You                             |
| 2:52 3:00 | Close                    | `/stage`                        |

---

## 0:00 to 0:20 · The problem

Screen: `/stage` (big score, today's tape, latest nudge, agents ticker along the bottom).

> "Your calendar says what you planned. Your watch knows how you slept. Your Mac knows where the
> afternoon went. Nobody puts them together, so every day you lose an hour or two and never see
> where. Calendars plan. Trackers count. Nobody coaches."

Fallback: none needed; the stage view renders "Today is not in yet" if the API is down. Keep talking.

## 0:20 to 0:30 · The promise

> "This is Michael. Michael finds the time you lose every day and gives it back to your goals.
> He is on your side."

## 0:30 to 1:05 · One day, the maths

1. **Today** tab (`/`). Point at the big number.
   > "This is Manolis' real week, private names removed. Today he is at [score]% of his goal time.
   > Pink is time spent on a goal, the grey drops are time that leaked away, the outlines are still
   > ahead."
   The tape key reads e.g. "2h 10 spent, 35 min lost, 1h 30 ahead". Read it. If the "won back"
   line shows, read it too: "[n] minutes won back today."
2. **Timeline** tab. It opens on Thursday 12 November, one of Manolis' real days.
   > "Here is where it went. One timeline: calendar, Mac, iPhone, browser, Claude Code. Every cut
   > inside a block is a distraction, named."
   Point at a lost stretch and the longest uninterrupted stretch.
3. **Goals** tab.
   > "Each goal has a weekly budget. This one is behind. And here is the maths: these goals need
   > [x] more this week, you have [y] free. Which one gives? Michael shows the sums, not vibes."
   ("The maths" card only shows when the week is over budget; if it is missing, read one goal's
   spent of budget instead.)

Fallback: if any screen errors, add `?demo=sample` to the URL (Today, Goals, Agents and `/stage`
accept it) and say "Same screen on yesterday's snapshot."

## 1:05 to 1:45 · Claude reads and books

Screen: claude.ai, a fresh chat, Michael connector switched on in the tools menu.

1. Type:
   > `Use Michael. How is my day going against my goals? Show me the numbers.`
   Claude calls `get_score` (and maybe `get_goals`) and answers with the same percentage as Today.
   > "Claude is reading the same day, through our MCP connector. One link, one tap to allow."
   Glance at the projector tab later: the agents ticker on `/stage` lists "Claude" asking.
2. Type (use the free slot picked at T minus 15 in the runbook):
   > `Book me a 45 minute focus block today at HH:MM called Sales focus.`
   Claude calls `create_focus_block`; the answer ends with "undo until HH:MM".
   > "Michael acts on his own time only: his blocks, never a meeting with other people, never
   > deletes, and everything can be undone until it starts."
3. Switch to **Today** and refresh: "Michael suggests" shows the block with "Done. Undo until HH:MM."
4. Back in claude.ai, type:
   > `Undo that block.`
   Claude calls `undo_recommendation`. "Undone."

Fallback: if Claude is slow or the connector errors, say "Same thing from inside Michael" and do it
in **/chat** (You, Chat with Michael): `Book a 45 minute focus block at HH:MM`, then tap **Undo**
on the "Done" chip. If chat fails too: Today's "Michael suggests" card, tap **Do it**, then **Undo**.

## 1:45 to 2:00 · Voice

Built on `main`: the claude.ai connector also works in the Claude iPhone app's voice mode. Push to
talk inside Michael (`/chat`) is PR #146; use it only if it has merged by pitch time.

- Claude app, voice mode, Michael connector on. Say:
  > "Ask Michael how much time I lost today, and to what."
- Or, with #146 merged: `/chat`, hold the mic, say the same line, let go. Michael answers aloud.

> "Same coach, hands free. On the bike, in the car, between meetings."

Fallback: skip the beat and say "And you can just talk to him." Do not wait on a microphone.

## 2:00 to 2:20 · The watch buzzes

Screen: `/stage` tab, full screen. Speaker raises the wrist.

1. Driver presses **N**. `POST /v1/nudges/test` sends the best current nudge to every device with
   nudges on. The watch buzzes and the same line slides in on the projector with its reason
   underneath; the status line reads "Sent to 1 of 1 device".
   > "That is Michael on my wrist. Under fifteen words, tied to a goal, and at most five a day,
   > never in quiet hours."
2. Read the nudge and its reason off the projector.

Fallback: if the watch stays still, the projector still shows the nudge ("Shown here. No device has
nudges on." means the phone is not subscribed). Say: "On a normal day that lands on the watch;
the stage Wi-Fi is not on my side." Press N once more, no more than that.

## 2:20 to 2:35 · Who asked about me today

Screen: **Agents** tab.

> "Any AI can ask Michael about you, but only with one tap of approval, only the scopes you
> allow, and every question is logged."

Point at "Who asked about you today: Claude." and the Today list of Claude's questions, then at
**Allowed** with its scopes and revoke.

Fallback: `/agents?demo=sample` shows the same layout with sample agents.

## 2:35 to 2:52 · Privacy

Screen: tap the Mi button (top right) to open **You**.

> "Health data is yours. Each source is off until you switch it on. One tap and Michael is off the
> record: every source stops." (Tap **Off the record** on, then off again.)
> "Your data lives in the EU. And three promises: one client, open book, he coaches you and
> forgets everyone else."

Point at the Sources switches and the Three promises.

Fallback: say it over the Today screen; nothing here needs the network to be believed.

**Turn Off the record back off.** It stops nudges and collection.

## 2:52 to 3:00 · Close

Screen: `/stage`.

> "One timeline, one coach, and any AI you trust can work with him. Michael finds the time you
> lose every day and gives it back to your goals. On your side."

---

## If everything is down

Open `https://michael-zeta-sand.vercel.app/?demo=sample`, `/goals?demo=sample`,
`/agents?demo=sample` and `/stage?demo=sample`: these render from fixtures in the web app, with no
API. Timeline always renders (it reads Manolis' real anonymised days from the web app). Say once:
"Live link is down, so this is this morning's snapshot", then run the same beats without Claude.

## Questions we expect

- **Where does the data come from?** Apple Watch through Health Auto Export, Google Calendar,
  the Mac collector (ActivityWatch), iPhone Shortcuts, the Chrome extension, Claude Code hooks,
  Omi. All post into one timeline (`docs/data-sources.md`).
- **How is the score worked out?** Share of planned goal time actually spent. Spent plus lost
  equals elapsed, elapsed plus ahead equals planned, every total is the sum of its parts
  (`docs/api.md`, Score).
- **Can an agent go rogue?** Scoped OAuth tokens, revocable in one tap, every query logged, no tool
  deletes or sends anything, nothing touches an event with other people.
