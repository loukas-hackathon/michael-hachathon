# UX audit: is it obvious what to do?

Saturday 14 November, 20:00. Three journeys walked with Playwright at 390x844 (iPhone UA, light and
dark): a brand new user with no data (local API, memory store emptied, `USE_MOCKS=false`), a demo
week visitor (local demo account, and production via "See the demo week"), and a returning user who
wants to connect Claude, Calendar, the watch and nudges. Screenshots are named below (prefix `A` new
user, `B` demo week, `C` connecting, `P` production, `D` after the copy fixes in this PR). They are
not committed; ask in the PR if you need them.

The question for every screen: what is the one thing to do here, and does the screen say so?

## Top findings, ranked by impact on "obvious what to do"

| # | Screen | Finding | Evidence | Recommendation | Effort | Where |
| - | ------ | ------- | -------- | -------------- | ------ | ----- |
| 1 | Today, new user | The first screen after onboarding is a dead end. "Nothing yet. Wear the watch tonight" assumes a watch nobody has connected and offers no button. Below it the evening card says "0 min of 0 min held". | `A-new-08` | Get started checklist with one primary action at a time (goals done, then Calendar, then watch, nudges, Claude). Start it partly done (goals ticked) so it never reads 0%. | M | #181 |
| 2 | Onboarding, "Let me see your day" | The filled pink button is Next, so the obvious action is to skip connecting. Apple Watch and Mac "Connect" leave onboarding for `/you`, where neither can be connected from the row you land on. | `A-new-06`, `A-new-12` | Connect is the primary for the first unconnected source; Next becomes "Later" until one is connected. Watch and Mac open their own steps and come back to the flow. | M | #205 |
| 3 | You | Thirteen source switches look like connections but connect nothing; Google Calendar appears twice (a Connect row and a switch); the way to actually connect the watch and Mac ("Devices") sits under Three promises at the very bottom. "Off the record: Collecting from your sources" shows when no source is connected. | `A-new-12`, `B-demo-05` | One Connections list with real status and one action per row; privacy switches move inside each connection; Off the record says "Nothing connected yet" when true. | M | #183 |
| 4 | Devices (watch, Mac) | Connecting means a key, a URL, "Format JSON, every 5 minutes", and "Treat it like a password". That breaks the one tap rule for the two sources the score depends on. Creating a key failed with no way forward when the session was missing. | `A-new-13`, `A-new-01-you_devices` | Deep link or QR that opens Health Auto Export prefilled; a downloadable Mac app that pairs with a six digit code. Keys never shown. | L | #120 |
| 5 | Agents | The empty state ("No agent has asked about you yet") came first and had no action; the actual job, Connect Claude, sat below it. | `A-new-11`, `B-demo-04-dark` | Fixed here: Connect Claude comes first when nothing is connected, with one line on why and how long it takes. | S | this PR |
| 6 | Timeline, new user | A brand new account opens on "Thursday 12 November, 207 phone sessions", the demo account's real day, with the disclaimer at the bottom. It reads as the user's own data. The default day is not today and nothing says why. | `A-new-09` | Own day only (live `GET /v1/timeline`); open on today; if today is empty, say so in one line with the latest day as a button. Sample label at the top, never the bottom. | M | #185, #209 |
| 7 | Production | The live web app is behind main: `/onboarding` and `/you/devices` are 404 and every visitor sees the sample Wednesday. Judges see none of the first run work. | `P-prod-07`, `P-prod-08`, `P-prod-02` | Fix the Vercel deploy first; check `/onboarding` returns 200 after every merge. | S to M | #161 |
| 8 | You, Google Calendar | A failed connect lands on `/you?integration_error=google_calendar` and shows nothing. A successful one shows no confirmation either. | `C-connect-04` | Inline line under the row: "Connected as name@gmail.com. First plans in a minute." or "Google said no. Try again." | S | #183 |
| 9 | Score (Today, Goals) | "82% of your goal time so far" has no "how is this counted" and no learning state. Oura and WHOOP both explain contributors in one tap and grey the score while they learn a baseline. | `P-prod-02`, `B-demo-03` | Tap the number: a sheet with the maths (planned, spent, lost, one line each) and "Day 1 of 3: I am still learning your week" until enough data exists. | M | #206 |
| 10 | Nudges | The only way to turn nudges on is a button half way down You. On iPhone it only works from the Home Screen, which is explained only after the tap. The install hint appears on the sign in screen, before any value. | `A-new-12`, `A-new-01-login` | Ask in context: after the first evening review, "Want me to buzz you at 08:00 for the block?" On iPhone in Safari, show the two install steps first, then the permission button. | M | #207 |
| 11 | Today, demo | Up to six pink elements compete (won back, Wins lines, two Do it buttons, Not now links). The design guide allows one. The primary action of the screen is not obvious. | `B-demo-01`, `B-demo-01-root-dark` | Only the top recommendation gets the filled Do it; the rest are tinted. "Wins" lines go to `--m-label`. | M | #208 |
| 12 | Evening review | "0 min of 0 min held" per goal, and "1200 of 1200 minutes for Deep work left" in raw minutes. | `A-new-08` | Fixed here: "Not booked today", and the rationale in hours ("20h 00 of 20h 00"). | S | this PR |
| 13 | Timeline | Block titles are struck through by the lost time hatching, and say "Chrome, VS Code" rather than what the block was for. | `A-new-09` | Label on a solid chip above the hatch; title by goal or calendar event, apps as the subline. | S to M | #209 |
| 14 | Everywhere | Michael speaks as "Michael" in places ("Michael couldn't load your day", "Michael only shows days") against the voice rule "I for Michael". | `A-new-02-goals` (earlier run) | Fixed here for the error screens, Timeline and Agents. | S | this PR |
| 15 | Goals, new user | Onboarding asks for "Deep work" and "Training"; Goals then groups them under "Business" and "Health" without saying where those came from. | `A-new-10` | Name the areas in onboarding (PR #190 does this). | S | #190 |
| 16 | Chat | Without a model key, Chat says "Chat switches on once the team adds my key." Internal plumbing in the user's path. | `B-demo-06` | "I can't answer right now. Try again in a minute." | S | PR #146 owns chat |

## Naming glossary (proposed)

One word per thing, everywhere in copy, routes and code comments.

| Use | Means | Instead of |
| --- | ----- | ---------- |
| **Connections** | Everything that sends Michael data or that Michael acts through: Google Calendar, Apple Watch, Mac, iPhone, browser, Telegram | Sources, Devices, Integrations |
| **Connect** / **Connected** | The one action and the status | Add, Link, Set up, Pair |
| **AI tools** (screen title stays Agents until #189) | Claude and other assistants that ask about you | Agents, clients, MCP |
| **Ask about you** | What an AI tool does | Query, request, access |
| **Goal time** | Planned time for a goal | Focus time, productive time |
| **Spent / Lost / Ahead** | The three tape states | Held, unconfirmed in headlines |
| **Won back** | Time recovered against the usual day | Saved, gained |
| **Nudges** | Messages on the phone, watch or Telegram | Notifications, alerts, pings |
| **Off the record** | Collection paused | Pause, privacy mode |
| **Morning brief / Evening review** | The two daily moments | Report, summary |
| **Areas** | Business, Health, Personal (goal groups) | Categories |

## Proposed first minute

The aha moment is the first time Michael shows a number about your own time and one fix for it.
Everything before that is cost; everything after is retention. Target: under 60 seconds to the first
own number for a Google user.

1. **0 s, sign in.** One button, "Continue with Google". The demo week stays a quiet link. No install
   hint yet (it is noise before value).
2. **5 s, goals.** Onboarding question one: pick goals. Defaults are sensible, so two taps is enough.
   Work hours, leaks and quiet hours stay, each one screen, each skippable.
3. **30 s, connect Calendar.** The connect step's primary button is "Connect Google Calendar"; Google's
   consent comes back into the flow, not to You.
4. **40 s, first number.** Today shows the week as Michael sees it from the calendar alone: "You have
   4h of deep work booked against a 20h goal. I found 6h free." One Do it: book the first block.
   This is achievable with Calendar alone, without the watch or Mac.
5. **Checklist under it** (partly done, at most five rows): Apple Watch, Mac, nudges, Claude. One
   primary at a time. Dismissible once three are done.
6. **After the first Do it**, ask for nudges in context ("Want a buzz when this block starts?"). On
   iPhone Safari, show the install steps first.
7. **Evening**, the review closes the loop with the maths and tomorrow's first block.

## Research notes

What the evidence says, applied to Michael.

**Activation and checklists.** Define the one action that predicts retention and design the first
run around reaching it. Keep setup checklists to 3 to 5 items, show progress, and start them partly
complete, because a checklist that is already part done is more motivating than one at zero
([Appcues, onboarding UX patterns](https://www.appcues.com/blog/user-onboarding-guide);
[Userpilot, onboarding best practices](https://userpilot.com/blog/user-onboarding-best-practices/);
[Plotline, mobile onboarding checklist](https://www.plotline.so/blog/mobile-app-onboarding-checklist)).
For Michael: goals are done by onboarding, so the checklist starts at one of five.

**Empty states.** An empty state explains why the screen is empty, previews what will appear, and
gives one clear action; without an action it is a dead end. Never show a loading look when nothing
is coming ([Setproduct, empty state UI](https://setproduct.com/blog/empty-state-ui-design);
[Tallyfy, why we obsess over empty states](https://tallyfy.com/engineering-empty-states/)).
`components/empty-state.tsx` already says this in its comment; Today and Agents did not follow it.

**Progressive disclosure.** Defer advanced or rarely used options to a secondary screen
([IxDF, progressive disclosure](https://ixdf.org/encyclopedia/progressive_disclosure.html)). For
Michael: the thirteen source switches and Three promises belong on detail screens, not in the first
scroll of You.

**Permissions and priming.** Apple: ask for private data only when the feature needs it, in a
context that explains why, and a custom screen may come before the system prompt
([Apple HIG, Accessing private data](https://developer.apple.com/design/human-interface-guidelines/privacy);
[Apple HIG, HealthKit](https://developer.apple.com/design/human-interface-guidelines/healthkit);
[Apple HIG, Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)).
iOS shows the system prompt once; a soft "Not now" on a primer keeps it for later
([Babich, asking for permissions](https://babich.biz/blog/mobile-ux-design-the-right-ways-to-ask-users-for-permissions)).

**Web push on iPhone.** Since iOS 16.4, web push works only for a web app added to the Home Screen
with a manifest, and the permission request must come from a tap; a request on page load is ignored
([Pushpad, iOS requirements](https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications);
[MacRumors, iOS 16.4 web push](https://www.macrumors.com/2023/02/16/ios-16-4-web-push-notifications/)).
`app/you/nudges-button.tsx` already asks from the tap; the gap is when and where it is offered.

**Explaining scores.** Oura breaks Readiness into named contributors, each with its own state, and
says it needs up to two weeks to learn your baseline
([Oura, Readiness score](https://support.ouraring.com/hc/en-us/articles/360057791533);
[Oura blog](https://ouraring.com/blog/readiness-score/)). WHOOP greys Recovery out for the first
days while it calibrates ([WHOOP, how recovery works](https://www.whoop.com/thelocker/how-does-whoop-recovery-work-101/)).
RescueTime's score drifts to the middle when activities are uncategorised and tells users to fix
categories for the goal to reflect reality
([RescueTime, understanding your data](https://help.rescuetime.com/article/461-understanding-your-data);
[Focus Work goal](https://help.rescuetime.com/article/292-focus-work-goal)). Pattern for Michael:
the score is tappable, shows its maths, and admits when it is still learning.

**Connecting sources.** Rise asks for Apple Health during a roughly three minute setup and works
without a wearable, filling in from phone use
([Rise, app review](https://www.risescience.com/blog/rise-app-review)). Pattern: never block value
on the hardest connection. Michael can show a first number from the calendar alone.
