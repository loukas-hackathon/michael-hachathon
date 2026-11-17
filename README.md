# Michael

**On your side.** Michael is a coach for your whole day. He finds the time you lose and gives it
back to your goals.

He reads your calendar, your phone, your Mac and your watch, builds one timeline of the day, checks
it against your goals, and tells you (or does for you, with undo) the one fix that matters.

Built in 36 hours at the Gen AI Summit Hackathon, Athens, 14 and 15 November 2026.

## Try it in one minute

**App:** https://michael-zeta-sand.vercel.app

**Best on your phone, as an app.** Open the link in Safari on an iPhone (or Chrome on Android), tap
**Get the app**, and add Michael to your Home Screen. It opens full screen like a native app, with
nudges on your phone and watch. No App Store needed.

**Just as clean on a laptop.** Open the same link in any browser for the full dashboard: sidebar,
columns and keyboard shortcuts. Same account, same data, on both.

| What you want to see                       | How                                                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A full week of real data** (recommended) | Sign in with **`judges@michael.app`** / **`OnYourSide2026`**. Opens Manolis' real week, names removed. Your taps stay in your own copy, so nothing you do breaks it.   |
| **The whole experience from zero**         | On the login page tap **Continue with email**, then **Create account**. No email confirmation. You land in onboarding and set your goals in under a minute.            |
| **Michael inside Claude**                  | claude.ai: Settings, Connectors, Add custom connector, paste `https://api-production-16521a26.up.railway.app/mcp`, sign in, tap Allow. Then ask "How is my day going?" |

## New since the hackathon (17 November)

| Try this                         | How                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yo Michael**                   | Say "Michael", "yo Michael" or "hey Michael" while the app is open, and he answers by voice on the screen you are on. Turn it on when Michael offers it the first time you open **Chat**, or in **You**, "Yo Michael". Best in Chrome on a laptop or Android; Safari on iPhone and Mac works too. Try "Michael, how is my day going?" in one breath. |
| **Hold Mi to talk**              | Press and hold the **Mi** button (top right, or the sidebar on a laptop), speak, let go. Works everywhere, including the iPhone Home Screen app, where saying his name is not allowed by iOS.                                                                                                                                                        |
| **The waiting list**             | https://michael-zeta-sand.vercel.app/join : how many hours you lose a week, your email, done. Then your place in the queue and your invite link: each friend who joins moves you up 5 places.                                                                                                                                                        |
| **Admin: who joined**            | https://michael-zeta-sand.vercel.app/waitlist : the list, the numbers and a CSV. Needs `ADMIN_EMAILS` set once (below).                                                                                                                                                                                                                              |
| **Admin: numbers for investors** | https://michael-zeta-sand.vercel.app/traction : the waiting list, sign ups, activation, weekly active, retention and time won back, with **Copy for investors**. No names on it, so it is safe to show on screen. Needs `ADMIN_EMAILS`.                                                                                                              |
| **Windows laptops**              | **You**, **Windows PC**, **Connect this PC**: paste one line into PowerShell. Michael then sees which apps you use and when (app names only, never window titles). Websites already work through the browser extension in Chrome and Edge. Not yet tried on a real Windows PC.                                                                       |

**Admins, once:** on Railway, service `api`, **Variables**, set `ADMIN_EMAILS` to the founders'
sign in emails, comma separated. Then sign in with one of them and open `/waitlist` or `/traction`
(`docs/setup-manual.md`, step 2c). Everyone else sees "not found".

**If Yo Michael does not answer:** open `?debug=voice` on any screen (for example
https://michael-zeta-sand.vercel.app/?debug=voice) and tap the small island: it shows what he last
heard and why a session ended. `?debug=off` hides it again.

## What to look at

1. **Today:** one score (the share of your planned goal time you actually spent), the minutes lost
   and what took them, and the next move.
2. **Timeline:** your whole day in one place: calendar, phone, Mac, workouts, sleep, places.
3. **Goals:** weekly time budgets for business, health and personal goals.
4. **Chat or Talk:** ask Michael anything about your day, by text or voice. He books, moves and
   removes your own blocks, and every change has Undo.
5. **What I have learnt:** patterns across your sources, such as late phone, then worse sleep,
   then a slower first block, each with "held N of M times" and one fix.

## What Michael does

- **One timeline of your day** from every source below.
- **A score you can trust:** planned goal time against time actually spent, with the maths shown.
- **Patterns he proves on your data:** Claude proposes, the server tests, and a pattern is kept only
  once it has held at least 4 times. The model never invents a number.
- **Acts for you, with undo:** books, moves, renames and removes your own calendar blocks, starts a
  Focus session, closes distracting Mac apps.
- **Focus now:** one tap protected time with a live countdown, iPhone Do Not Disturb, and a watch
  buzz at the end.
- **Nudges the moment it happens:** for example the phone opened 5 times inside a goal block. At
  most 5 a day, on the watch, by push or Telegram.
- **Morning and evening ritual:** up to three outcomes each morning, a one minute log each evening.
- **Memory:** "What I know about you", in plain words, where you can forget any line.
- **Meetings mode:** only when you start it; keeps your commitments, never the audio.
- **Any AI agent can read and write your day** through our MCP server, with one tap approval, and
  every question is logged ("who asked about me today").

## Connectors

| Source                 | What it brings                                   | How you connect              |
| ---------------------- | ------------------------------------------------ | ---------------------------- |
| Google Calendar        | Your plans and blocks; Michael writes back to it | One tap, Google consent      |
| Apple Watch            | Sleep, workouts, heart rate, recovery            | Health Auto Export app       |
| iPhone                 | Which apps you open and when                     | One shortcut, one automation |
| Mac                    | App and website time, Screen Time history        | Small Mac app                |
| Claude (and other AIs) | Read and change your day from claude.ai          | One link (MCP)               |
| Nudges                 | Push notifications on phone and watch            | One tap                      |
| Telegram               | Nudges and actions in Telegram                   | One tap                      |
| Location               | Where your time goes, on the timeline            | One tap                      |

Also: Claude Code sessions and the browser extension.

## Private by design

Each source is opt in. **Off the record** stops all collection in one tap. The database is in the
EU. Michael only removes your own events (with undo until they start), never sends anything in
your name and never touches an event with other people. Deleting your data really deletes it.

## How it is built

Next.js phone first web app (Vercel), Hono API and MCP server (Railway), Claude for coaching and
analysis. All data lives in Supabase Postgres in the EU (Frankfurt); only the API reads or writes it,
and every query is scoped to the signed in person. Monorepo: `apps/web`, `apps/api`, `apps/collector`,
`apps/extension`, `packages/shared`.

Developers: [`docs/developers.md`](docs/developers.md) (run locally, environment, deploy, API and
MCP) and [`docs/api.md`](docs/api.md).
