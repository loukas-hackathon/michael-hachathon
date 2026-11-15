# Pitch: three minutes

One speaker talks, one drives. Rehearsed end to end against production on Sun 15 Nov 06:40 Athens
(commit `8f65dde`; fixes in #335 and #361, Playwright at 390x844 and `/stage` at 1920x1080; issue #253).
Run `docs/demo-runbook.md` first. Lines in quotes are said out loud. Numbers are read off the
screen, never from this page: the demo week follows the clock, and the examples below are what the
screen said at rehearsal.

**Setup on stage.** Laptop on the projector, the presenter link opened once in its browser (so the
laptop is the demo week and may connect Claude and switch Off the record), tabs open in the
runbook's order. Speaker wears the Apple Watch; the paired iPhone is locked in a pocket.

| Time      | Beat                      | Screen                  | Measured on production                |
| --------- | ------------------------- | ----------------------- | ------------------------------------- |
| 0:00 0:15 | The problem               | `/stage`                | loads in 1.7 s                        |
| 0:15 0:25 | The promise               | `/stage`                |                                       |
| 0:25 0:50 | The day, and how I count  | Today, How I count      | Today 2.3 s, sheet instant            |
| 0:50 1:10 | The evening log           | Today `?ritual=evening` | Log the day: 3 to 8 s                 |
| 1:10 1:30 | Talk to him: the ice bath | Chat, Talk to Michael   | typed reply 11 to 12 s; voice by hand |
| 1:30 1:50 | Claude books the block    | claude.ai, then Today   | not run: presenter key not set        |
| 1:50 2:05 | Drag it like Calendar     | Timeline                | drag and save 3 s, Undo 2.5 s         |
| 2:05 2:25 | The watch buzzes          | `/stage`, press N       | not pressed at dawn (see note)        |
| 2:25 2:45 | Privacy                   | You                     | needs this branch + presenter         |
| 2:45 3:00 | Close                     | `/stage`                |                                       |

**Cut to fit three minutes** (all still work; use them in questions or as fallbacks): the Goals
tab ("University needs you most", Book 1h 30), the real Thursday on Timeline, the Agents tab (the
stage ticker shows Claude asking instead), asking Claude "how is my day going" before booking,
undoing in claude.ai, and Claude app voice mode.

---

## 0:00 to 0:15 · The problem

Screen: `/stage` (date, big score or "Your first block starts at HH:MM", Michael's latest nudge,
"Agents asking about me" along the bottom).

> "Your calendar says what you planned. Your watch knows how you slept. Your phone knows where the
> afternoon went. Nobody puts them together, so every day you lose an hour and never see where."

Fallback: none needed. Keep talking.

## 0:15 to 0:25 · The promise

> "This is Michael. He finds the time you lose every day and gives it back to your goals. He is
> on your side."

## 0:25 to 0:50 · The day, and how I count

Screen: **Today** (`/`).

1. Point at the big number under "Optimisation score" and the seven day columns.
   > "This is Manolis' real week, private names removed. [76]% of his goal time this week, two
   > days kept in a row. A day is kept at 70%."
2. Point at the lost line: "[4h 57] lost from your goal blocks this week. [Instagram] took [2h 32]
   of it." Read it as it is.
3. Tap **How I count**. The sheet reads e.g. "15h 23 spent of 20h 20 gone by", Planned 21h 50,
   Spent 15h 23, Lost 4h 57, Still ahead, Time won back.
   > "No vibes. Spent plus lost is the time gone by. Every number adds up." Tap **Cancel**.

## 0:50 to 1:10 · The evening log

Screen: Today with `?ritual=evening` (tab 3 in the runbook; after about 19:00 Today shows it by
itself). The morning plan already set three outcomes (at rehearsal: Statistics past paper, Call
three leads, Yoga before bed).

> "Every morning Michael asks for three outcomes. Every evening, one tap each."

Tap **Done** on the second, **Partly** on the first, **Not** on the third, then **Log the day**.
It reads "The day, logged. 1 of 3 done, 1 partly. 45 min logged for The company."

> "That 45 minutes now counts towards the company goal. No timers, no forms."

Fallback: if the card is not there, the evening was already logged in rehearsal: the logged card
shows instead; read it. Reseed fixes it for next time.

## 1:10 to 1:30 · Talk to him: the ice bath

Screen: **Chat** on the laptop (Chrome listens; the projector shows it). Tap the wave button
(**Talk to Michael**), left of the plus. Say:

> "I took an ice bath for 40 minutes after the ride."

About 12 seconds later he answers aloud, with the words on screen: "I logged the 40 minute ice
bath to 70.3, so you're at [7h 51] of 9h this week." A **Done. Undo until tomorrow HH:MM** chip
sits under it. Tap **End**.

> "Same coach, hands free. He logs it, and shows the maths."

Say the ice bath line exactly: "I took a bath for 40 minutes" on its own makes him ask which goal
it belongs to (he asks only when unsure; no goal mentions baths).

Fallback: type the same line into Chat and press **Send** (same answer, no voice). Talk over the
wait: "He is checking it against the week."

## 1:30 to 1:50 · Claude books the block

Screen: claude.ai, a fresh chat, Michael switched on in the tools menu. Type (slot from the card
picked at T minus 15; on Sunday evening the finalists slot 20:00 to 21:00 has other people in it,
so take 21:15):

> `Use Michael. University is behind. Book me 45 minutes tonight at 21:15 called Statistics.`

Claude calls `create_focus_block`; the answer ends with "undo until 21:15".

> "Claude is reading and writing the same day, through our connector. One link, one tap to allow.
> He acts only on my own time: never a meeting with other people, never deletes, and everything
> can be undone until it starts."

Switch to **Today**: the block sits at the top, "Statistics, 21:15 to 22:00. Asked for in chat.
Wins 45 min for University. Done. Undo until 21:15."

Fallback: in **Chat** type `Book a 45 minute focus block today at 21:15 called Statistics` (at
rehearsal: "I booked Sales focus from 15:00 to 15:45 today under The company ... Undo until
15:00"). If chat fails too: **Goals**, **Book 1h 30** on University.

## 1:50 to 2:05 · Drag it like Calendar

Screen: **Timeline**, today. The Statistics block is there.

Long press it, drag half an hour down, let go. "Moved to 21:45." with **Undo**.

> "And if the plan changes, I just move it. Like Calendar on the iPhone."

Tap **Undo** ("Undone.") so the stage stays as Claude booked it.

Fallback: no booked block (the Claude beat failed)? Tap a free hour after now ("Open these hours to
plan", then the hour), type a title, **Add**, then drag that one.

## 2:05 to 2:25 · The watch buzzes

Screen: `/stage`, full screen. Click the page once so N reaches it. Speaker raises the wrist.

1. Driver presses **N**. The watch buzzes and the same line slides in on the projector with its
   reason underneath; the status line reads "Sent to [2] of [2] devices" (push and Telegram).
   The line is the goal furthest behind its pace, at any hour and by its own name (#361), e.g.
   "University 3h 22 behind this week. Book 90 min today." with the pace maths underneath. Only
   when every goal is on pace does it say "Nudges are on. At most five a day, only when it
   matters."
   > "That is Michael on my wrist. Under fifteen words, tied to a goal, at most five a day, never
   > in quiet hours."
2. Point at the bottom line: "Agents asking about me: Claude". "And every question an AI asks
   about me is logged."

Fallback: the projector shows the nudge even if the watch stays still ("Shown here. No device has
nudges on." means nothing is subscribed). Say: "On a normal day that lands on the watch." Press N
once more, no more. Telegram on the iPhone is the second channel: it buzzes the watch too.

## 2:25 to 2:45 · Privacy

Screen: tap the Mi button (top right) on Today to open **You**.

> "Health data is yours. Each connection is off until you switch it on. One tap and Michael is off
> the record: nothing is collected." Tap **Off the record** on ("Nothing is being collected since
> HH:MM."), then off again.
> "Your data lives in the EU, conversations only when you start them, raw audio deleted once it
> is transcribed."

Off the record needs the presenter link on this laptop: a plain demo visitor gets "This is the
demo week. Sign in with Google to make it yours." and the switch flips back (rehearsal finding,
fixed on this branch for the presenter). If that line appears, do not tap again; say the line over
the screen.

**Turn Off the record back off.** It stops nudges and collection.

## 2:45 to 3:00 · Close

Screen: `/stage`.

> "One timeline, one coach, and any AI you trust can work with him. Michael finds the time you
> lose every day and gives it back to your goals. On your side."

---

## If everything is down

Open `https://michael-zeta-sand.vercel.app/?demo=sample`, `/goals?demo=sample`,
`/agents?demo=sample` and `/stage?demo=sample`: these render from fixtures in the web app, with no
API. Timeline always renders (it reads Manolis' real anonymised days from the web app). Say once:
"Live link is down, so this is this morning's snapshot", then run the same beats without Claude,
chat and the watch.

## Questions we expect

- **Where does the data come from?** Apple Watch through Health Auto Export, Google Calendar,
  the Mac collector (ActivityWatch), iPhone Shortcuts, the Chrome extension, Claude Code hooks,
  Omi. All post into one timeline (`docs/data-sources.md`).
- **How is the score worked out?** Share of planned goal time actually spent. Spent plus lost
  equals time gone by, plus still ahead equals planned. Open How I count on Today.
- **Which goal needs me?** Goals: "University needs you most: 3h 22 behind pace", one tap
  **Book 1h 30**, Undo until it starts.
- **Can an agent go rogue?** Scoped OAuth tokens, revocable in one tap on Agents, every query
  logged, nothing deletes or sends in your name, nothing touches an event with other people.
