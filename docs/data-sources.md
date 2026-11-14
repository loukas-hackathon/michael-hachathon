# Data sources

Michael is only as good as what he can see. This file lists every source we looked at, grouped by
life pillar, with two routes for each: how we get the data **this weekend** (third party apps and
local files are fine) and what **our own collector** needs later, when we replace the borrowed
parts.

Researched Saturday 14 November 2026. Status column:

- **Tested**: we ran it on a real Mac (macOS 26.6) with an iPhone and Apple Watch paired.
- **Docs**: confirmed in the vendor's own documentation or source code.
- **Reported**: third party sources only. Check before building on it.

Rules that apply to every source (see `AGENTS.md`, Privacy rules):

- Each source is opt in, with its own switch. Health, browsing and conversation data need a clear yes.
- Collect the detail, but send the model summaries and categories where a summary is enough. For
  browsing that means category and search intent, not raw addresses.
- Other people's words are never stored. For messages and mail we keep metadata only (who, when,
  how long until the reply).
- Every collector posts `EventInput` to `POST /v1/events/batch` with a stable `external_id`, so
  re-running a backfill never duplicates events.

## The pillars

1. Attention: what was on the phone and the Mac, minute by minute
2. Browsing and search
3. AI tools
4. Body, training, sleep and recovery
5. Plan and work: calendar, tasks, meetings, study
6. Conversations and communication
7. Food
8. Money
9. Places and travel
10. Leisure and media
11. Mood and energy (no source exists: a short check in over Telegram is the only way)

## 1. Attention

| Source                              | What it gives                                                                                                                  | This weekend                                                                                                                                                                                                                                                                                                                                         | Our own collector later                                                                                                                                                                 | Status                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Mac app usage, Apple's own store    | Every app in focus with start and end, about 4 weeks of history. Also notifications delivered on the Mac and screen on and off | Read `~/Library/Application Support/Knowledge/knowledgeC.db` (streams `/app/usage`, `/notification/usage`, `/display/isBacklit`). Copy the file first, then query the copy. Needs Full Disk Access for the reading process                                                                                                                           | A signed menu bar app that uses the public workspace notifications for app switches, so we stop depending on a private file                                                             | Tested                      |
| iPhone app usage, synced to the Mac | Every app that gained or lost focus on the iPhone, with the reason (home screen, app switcher, notification), about 30 days    | Read `~/Library/Biome/streams/restricted/App.InFocus/remote/<device id>/` on the Mac. Files are SEGB v2; parsers: `ActivityWatch/aw-import-screentime`, `cclgroupltd/ccl-segb`. Needs "Share Across Devices" on in Screen Time. **Lag: the iPhone data was about 23 hours behind when tested**, so this is for history and patterns, not live nudges | An iOS app. Apple's Screen Time API keeps usage inside a sandboxed report view that cannot send data out, so a real fix needs Apple's entitlement and still gives thresholds, not a log | Tested                      |
| iPhone, live                        | A timestamp each time a chosen app opens or closes, plus Focus on and off, charger, alarm stopped, sleep and wake              | iPhone Shortcuts personal automations with "Get Contents of URL" posting to `/v1/webhooks/ios-shortcuts`. Two automations per app, set up by hand. No trigger exists for unlock or pickup                                                                                                                                                            | Same limit as above. Shortcuts stays the live route on iPhone                                                                                                                           | Docs                        |
| iPhone pickups                      | How often the phone is picked up                                                                                               | Not exportable. Derive phone sessions from gaps in the synced app focus stream. This is a floor, not Apple's pickup count: on a real week Apple counted 114 pickups a day where we saw 77 sessions with an app, because a glance at the lock screen leaves no record                                                                                 | None on iPhone. Exact on Android                                                                                                                                                        | Tested (derivation is ours) |
| iPhone notifications                | Which notification pulled the user away                                                                                        | Not available: notifications do not sync to the Mac and no iOS API exposes them. The focus stream's "notification" reason shows that an app was opened from a notification                                                                                                                                                                           | None on iPhone. Exact on Android                                                                                                                                                        | Tested                      |
| Mac window titles and idle          | Window title, browser tab, idle after 3 minutes                                                                                | ActivityWatch (open source, local API on `localhost:5600`) plus a small forwarder. Only needed if app level data from Apple's store is not enough                                                                                                                                                                                                    | Our menu bar app with the Accessibility permission                                                                                                                                      | Docs                        |
| Mac screen content                  | Everything on screen as searchable text                                                                                        | Screenpipe (local API on port 3030). Heavy on CPU and memory, and its licence forbids commercial use without a paid licence. Skip unless a demo needs it                                                                                                                                                                                             | Out of scope                                                                                                                                                                            | Docs                        |
| Android app usage                   | A full event log: every app to foreground and background, screen on and off, unlocks                                           | `UsageStatsManager.queryEvents` with the Usage Access toggle. The system keeps only a few days, so the collector must store its own copy                                                                                                                                                                                                             | Our own APK: about 6 to 8 hours. Fastest no code route today: MacroDroid or Tasker posting to our webhook                                                                               | Docs                        |
| Android notifications               | Every notification from every app with post time and whether it was tapped or swiped                                           | `NotificationListenerService` with the Notification Access toggle                                                                                                                                                                                                                                                                                    | Same APK                                                                                                                                                                                | Docs                        |

Android gives the two things iPhone hides: exact unlocks and the notification that caused an app
open. The demo runs on Apple devices; Android is the stronger platform for the product later.

## 2. Browsing and search

| Source                 | What it gives                                                                                                                          | This weekend                                                                                                                                                                                                                                                                            | Our own collector later                                   | Status   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------- |
| Chrome history file    | Every visit with time, title, time on page, foreground time, Chrome's own page category, and the search terms typed. Months of history | Copy `~/Library/Application Support/Google/Chrome/<profile>/History` and query the copy (Chrome locks the live file). Tables `visits`, `urls`, `keyword_search_terms`, `content_annotations`, `context_annotations`. Time is microseconds since 1601. No special permission on macOS 26 | Our browser extension                                     | Tested   |
| Chrome extension       | Live tab switches, active tab time, idle and locked state                                                                              | An unpacked Manifest V3 extension (no store review) posting to our API. Same folder loads in Arc, Brave and Edge                                                                                                                                                                        | Publish it in the Chrome Web Store                        | Docs     |
| Safari history         | Per visit time and title, no time on page                                                                                              | `~/Library/Safari/History.db`, needs Full Disk Access. Only worth it for a Safari user                                                                                                                                                                                                  | A Safari extension needs an Xcode wrapper app and signing | Tested   |
| Other browsers         | Same data                                                                                                                              | Arc, Brave, Edge use Chrome's format at a different path. Firefox uses `places.sqlite`                                                                                                                                                                                                  | Covered by the extension                                  | Reported |
| Google account history | Search, YouTube, Maps and Chrome history from every device                                                                             | Google Takeout, by hand (minutes to days). The Data Portability API works in Greece but its scopes are restricted, exports take hours to days and repeat at most once every 24 hours                                                                                                    | Data Portability API after Google verification            | Docs     |
| Categories             | Travel, shopping, social, news                                                                                                         | A short built in list of well known sites, then a model on domain plus title plus search term, cached per domain. Chrome's own category column holds opaque topic ids with no names on the Mac, so it is not used                                                                       | Same                                                      | Tested   |

Not possible: YouTube watch history through the YouTube API, a live API for Google My Activity,
iPhone Safari history without the Mac, Chrome sync data through any public API.

## 3. AI tools

| Source                                     | What it gives                                                                                                       | This weekend                                                                                                                                                                          | Our own collector later                                          | Status   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| Claude Code hooks                          | Live: each prompt, each tool call with duration, end of turn, "waiting for the user", session start and end         | `hooks` in `~/.claude/settings.json` with `type: "http"` posting to our API. Payloads carry no timestamp, so the server stamps arrival time. A failed post does not block the session | Ship it as a plugin                                              | Tested   |
| Claude Code transcripts                    | History: every session with per message timestamps, token counts, model, project and title. 30 days kept by default | Parse `~/.claude/projects/<project>/<session>.jsonl`. The format is internal and can change. Sessions from the VS Code extension and the desktop app land in the same folder          | Same, as the self healing backfill behind the hooks              | Tested   |
| Claude chat (web, desktop, phone)          | Topics and intent of normal chats, as written by the model                                                          | Add Michael's MCP server as a custom connector and instruct Claude to log a one line summary with `add_event`. The model decides when to call it, so this is best effort              | Same. There is no conversation history API for personal accounts | Docs     |
| Claude chat export                         | Full history, once                                                                                                  | Settings, Privacy, Export data. A link arrives by email                                                                                                                               | Same                                                             | Docs     |
| ChatGPT                                    | Full history, once                                                                                                  | Data export (zip with JSON). MCP in developer mode asks for confirmation on every write, so silent logging is not possible. No history API for personal accounts                      | Same                                                             | Reported |
| Gemini app                                 | Prompts and responses                                                                                               | Google Takeout, "Gemini Apps" activity. No API                                                                                                                                        | Same                                                             | Docs     |
| Cursor, Codex CLI, Gemini CLI, Copilot CLI | The same events as Claude Code                                                                                      | Each has a near identical hook system that hands JSON to a script. One shared script with a small field map per tool                                                                  | Same                                                             | Docs     |
| WakaTime                                   | Coding time by project, with AI and human line counts                                                               | Its plugins plus the API                                                                                                                                                              | Not needed once hooks exist                                      | Docs     |

## 4. Body, training, sleep and recovery

| Source                                        | What it gives                                             | This weekend                                                                                                                                                                                                                                                      | Our own collector later                                                          | Status   |
| --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Apple Watch and Apple Health                  | Sleep stages, HRV, resting heart rate, workouts, steps    | Health Auto Export (iOS app) posts JSON to `/v1/webhooks/health-auto-export` with custom headers. The schedule is a wish, not a guarantee, and the phone must be unlocked when it reads. Trigger an export by hand before the demo. Premium is paid, with a trial | An iOS app with HealthKit. There is no server API and the Mac cannot read Health | Docs     |
| WHOOP                                         | Recovery, sleep, workouts, strain                         | OAuth API v2 with webhooks for sleep, recovery and workouts. Needs a WHOOP membership                                                                                                                                                                             | Same                                                                             | Docs     |
| Strava                                        | Activities with laps and streams                          | OAuth with webhooks. A paid Strava subscription is now needed to create an API app, and new apps start with one athlete. Whether Strava's terms allow AI use of the data is contested                                                                             | Same, after their review                                                         | Docs     |
| Intervals.icu                                 | Activities, planned workouts, fitness load                | Personal API key. Activities that arrived through Strava are not exposed                                                                                                                                                                                          | Same                                                                             | Reported |
| Garmin, Oura, Polar, Withings                 | Activities, readiness, sleep, weight                      | Each has an API. Oura reportedly forbids feeding its data to AI models. Garmin's personal tier is pull only                                                                                                                                                       | Same                                                                             | Reported |
| Fitbit                                        | Nothing usable                                            | The old API was switched off around 30 October 2026 and the replacement Google Health API has restricted scopes                                                                                                                                                   | Wait                                                                             | Reported |
| Android Health Connect                        | Steps, sleep stages, heart rate, HRV, workouts, nutrition | Inside our Android app, one permission per data type                                                                                                                                                                                                              | Same                                                                             | Docs     |
| Aggregators (Terra, Junction, Open Wearables) | Many wearables behind one API                             | Not needed for one demo user. Open Wearables is free and self hosted                                                                                                                                                                                              | Consider when we support many devices                                            | Docs     |

## 5. Plan and work

| Source                                 | What it gives                                | This weekend                                                                                                           | Our own collector later         | Status   |
| -------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------- |
| Google Calendar                        | The planned day: events, attendees, changes  | OAuth plus sync, with push channels later. In testing mode tokens expire after 7 days                                  | Same, after Google verification | Docs     |
| Fathom                                 | Meeting transcripts, summaries, action items | API key and webhooks. Other participants' speech must not be stored                                                    | Same                            | Docs     |
| Gmail                                  | Receipts, bookings, reply times              | OAuth in testing mode, then a model parses the mail. The scopes are restricted: production needs a security assessment | Same, after the assessment      | Docs     |
| Notion, Linear, GitHub, Todoist, Slack | Tasks done, commits, messages                | Personal tokens and webhooks                                                                                           | Same                            | Reported |
| University calendar (Open eClass)      | Deadlines                                    | Not confirmed that a feed exists. Fallback: put lectures in Google Calendar                                            | Same                            | Reported |

## 6. Conversations and communication

| Source   | What it gives                      | This weekend                                                                                                              | Our own collector later | Status                                 |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------- |
| Omi      | Transcripts, memories, day summary | Webhooks from the Omi app's developer mode to `/v1/webhooks/omi`. Needs the device. Meetings mode only, raw audio deleted | Our own recorder        | Docs                                   |
| iMessage | Who and when, from the Mac         | `~/Library/Messages/chat.db`, needs Full Disk Access. Metadata only                                                       | None on iPhone          | Tested (file exists; content not read) |
| WhatsApp | Messages                           | No personal API. A manual chat export per chat. Automating WhatsApp Web breaks its terms and risks a ban                  | None                    | Reported                               |
| Telegram | Messages sent to Michael's bot     | The Bot API. This is Michael's own input channel (photos of meals, check ins), not a way to read personal chats           | Same                    | Reported                               |

## 7. Food

| Source                                   | What it gives                         | This weekend                                                   | Our own collector later | Status   |
| ---------------------------------------- | ------------------------------------- | -------------------------------------------------------------- | ----------------------- | -------- |
| Photo of the meal                        | Meal, rough calories and macros, time | Send a photo to Michael's Telegram bot, read by a vision model | In our app              | Docs     |
| Delivery receipts (efood, Wolt)          | What, when, how much                  | Parsed from Gmail                                              | Same                    | Reported |
| MyFitnessPal, Cronometer, Lose It, Yazio | Nothing usable                        | No open API (MyFitnessPal is closed to new developers)         | None                    | Docs     |

## 8. Money

| Source                       | What it gives                                                        | This weekend                                                                                                      | Our own collector later                             | Status |
| ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| Enable Banking               | Bank transactions. Greek banks listed: NBG, Piraeus, Alpha, Eurobank | Its restricted mode covers your own linked accounts without a contract                                            | A contract with a licensed provider for other users | Docs   |
| GoCardless Bank Account Data | Nothing                                                              | New signups are disabled                                                                                          | None                                                | Docs   |
| Apple Pay                    | Nothing in Greece                                                    | FinanceKit covers only the United States and United Kingdom. The Shortcuts Transaction trigger is the alternative | None                                                | Docs   |
| Receipts by email            | Purchases, subscriptions                                             | Parsed from Gmail                                                                                                 | Same                                                | Docs   |

## 9. Places and travel

| Source                              | What it gives                        | This weekend                                                 | Our own collector later | Status |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------ | ----------------------- | ------ |
| OwnTracks or Overland (iPhone apps) | Location and arrivals and departures | The app posts straight to our webhook. No OAuth, no approval | In our app              | Docs   |
| iPhone Shortcuts Arrive and Leave   | Gym, office, home, university        | One automation per place                                     | Same                    | Docs   |
| Flights, hotels, rides              | Bookings and times                   | Parsed from Gmail. Flight searches show in Chrome history    | Same                    | Docs   |
| Google Maps Timeline                | Visits and routes                    | Stored on the phone only. Manual export                      | None                    | Docs   |

## 10. Leisure and media

| Source                     | What it gives                      | This weekend                                                                                         | Our own collector later | Status   |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- | -------- |
| Spotify                    | The last 50 tracks with play times | OAuth and polling. Needs Premium on the developer account. Terms forbid training a model on the data | Same                    | Docs     |
| YouTube                    | Watch history, start times only    | Google Takeout                                                                                       | Data Portability API    | Reported |
| Netflix, TikTok, Instagram | Viewing lists                      | Manual data downloads. None includes time spent; that comes from pillar 1                            | None                    | Reported |

## What we build first

Ranked by signal for the work. All four run on the user's Mac with no new hardware and no account
approval, and together they give weeks of history on the first day.

1. **Mac and iPhone app usage from Apple's own stores.** Backfill plus polling. The base for phone
   check cadence and focus disruptions.
2. **Chrome history.** Search intent, time on page and category. Catches "flights during a work block".
3. **Claude Code sessions.** Transcripts for history, hooks for live. Shows how work with AI really goes.
4. **Calendar** (already issue #12 and #13). The plan that everything else is measured against.

Then: Apple Watch through Health Auto Export (#8), iPhone Shortcuts for the live moment (#9), Omi (#7).

## Patterns to detect

Collection is not the product. These are computed from the timeline with plain rules first, and the
model explains them:

- **Phone check cadence:** median gap between phone sessions, by hour of day ("every 20 minutes").
- **Focus disruptions:** inside a planned block, each switch to an app or site outside the goal, with
  minutes lost and what opened it.
- **Repeat offenders:** the same app or site breaking blocks on several days.
- **Drift:** browsing category that does not match the block it happened in.
- **Recovery cost:** time to return to the task after each interruption.
- **Late screens:** phone or Mac use after the usual bedtime, against next day recovery.
- **Waiting on tools:** time an AI session sat waiting for the user, and long sessions with little output.

Built in `apps/api/src/patterns` and served by `GET /v1/patterns`. The exact definition and the
minimum sample of every detector are in `docs/api.md`, section Patterns.
