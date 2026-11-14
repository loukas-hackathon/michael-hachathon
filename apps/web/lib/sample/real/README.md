# Real days (Manolis' own data)

Real days from Manolis' Mac, iPhone (via Screen Time sync), Chrome and Claude Code, exported so the
Today and Timeline screens can be designed against real density instead of the mock day. Manolis
agreed to his data being used and committed here. Nothing in this folder came from production: the
script below collects into a throwaway local API with the in-memory store.

## Files

| File                                       | What                                                                                                             |        Size |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------: |
| `2026-11-12.json`                          | Thu 12 Nov. The most recent complete weekday with every source synced (13 Nov's iPhone data is only half there). |      741 KB |
| `2026-10-29.json`                          | Thu 29 Oct. Heaviest phone day of the month (6h 54 on the iPhone) and the most broken focus (53 disruptions).    |      618 KB |
| `2026-11-01.json`                          | Sun 1 Nov. Light weekend day: Mac open for 10 minutes, iPhone 3h 24, no Claude Code.                             |      111 KB |
| `2026-11-14.json`                          | Sat 14 Nov, today up to about 18:35 (hackathon day one). No iPhone yet: Screen Time syncs about a day behind.    |      197 KB |
| `<date>.patterns.json`                     | The pattern report for that one day (see "Patterns" below).                                                      | 15 to 66 KB |
| `week-2026-11-06_2026-11-12.patterns.json` | The same report over 7 days, because phone cadence and late screens need at least 3 days to say anything.        |      104 KB |

Each day file is `{ "date": "YYYY-MM-DD", "label": string, "events": Event[] }`. Every event passed
`Event.parse` from `@michael/shared`. The events are exactly what `GET /v1/timeline` returns for the
Athens day (00:00 to 24:00, `Europe/Athens`), so they include events that started the evening before
and are still running at midnight (a "Screen off" from 21:43 the night before, Chrome tabs left open).
Clip them to the day when you draw. Nothing was dropped for size: every file is under the 1.5 MB cap.

## Event counts

| source type                | 12 Nov | 29 Oct | 1 Nov | 14 Nov |
| -------------------------- | -----: | -----: | ----: | -----: |
| `macos_usage app_usage`    |    349 |    425 |     9 |    169 |
| `macos_usage screen`       |    294 |    183 |     7 |      5 |
| `macos_usage notification` |      6 |      6 |     4 |      9 |
| `iphone_usage app_usage`   |    207 |    194 |   177 |      0 |
| `chrome web_visit`         |    561 |    333 |    21 |    153 |
| `chrome search`            |     18 |      4 |     2 |     10 |
| `claude_code ai_session`   |     19 |     25 |     0 |      4 |
| `claude_code ai_prompt`    |     48 |     67 |     0 |     39 |
| **total**                  |   1502 |   1237 |   220 |    389 |

## Missing sources (say it plainly in the interface too)

- **Google Calendar: none.** There is no calendar reader on the Mac and the OAuth integration is not
  built yet, so there are no `calendar_event`s. Every day here has no meetings on it.
- **Apple Watch sleep and workouts: none.** Health data does not live on the Mac. The Screen Time
  sync carries a handful of Watch app intervals (5 in 30 days, none on these days), not sleep,
  heart rate or workouts. So there is no `sleep`, `recovery` or `workout`, and every sleep based
  pattern (bedtime, the morning after) reports "not enough data".
- **WHOOP, Omi conversations, meals, iOS Shortcuts, ActivityWatch, the Chrome extension:** none.
- **iPhone on 14 Nov:** none yet. Screen Time on the Mac is about 25 hours behind the phone.
- **Goals:** the local API has no real goals, so the reports ran against the mock goals from
  `@michael/shared`. No planned goal blocks exist, so focus is always the "inferred" kind.

## Privacy and masking

The collectors' own filters already ran: Chrome keeps the host and the page title, never the path or
query, and drops excluded hosts whole (304 visits in 30 days); Claude Code prompts are cut to 120
characters and pass through `scrubSecrets`. On top of that the export runs `scrubSecrets` over every
string again, so anything that looks like a key, token or password reads `[secret]` (3, all Google
Drive folder ids inside prompts), and masks every email address as `[email]` and phone number as
`[phone]`, because other people's contact details turn up in mail tab titles and typed prompts.

Names of real people, clients and places are **not** removed: they appear in Gmail tab titles (email
subjects), Claude Code session titles and prompts, and Google searches. If this folder is shown on
stage or in the demo, decide whether to pseudonymise them first.

## Patterns

`<date>.patterns.json` is a `PatternReport` (schema in `packages/shared/src/schemas.ts`), the shape
`GET /v1/patterns?from=&to=` returns: `from`, `to`, `timezone`, `generated_at`, `days`, `inputs`
(event counts used), `headlines` (one sentence per detector that had enough data, most important
first) and one block per detector: `phone_cadence`, `mac_app_cadence`, `focus_disruptions`,
`recovery_cost`, `repeat_offenders`, `drift`, `late_screens`, `context_switching`, `time_by_app`,
`ai_tool_use`. Each block is `{ status: "ok" | "not_enough_data", reason, minimum, summary, evidence,
data }`. `evidence` holds event ids, and those ids match the events in the day file of the same run.

On a single day `phone_cadence`, `mac_app_cadence` and `late_screens` always say "not enough data"
(they need 3 days); use the week file to design those cards.

The in-memory store always carries the mock day (13 and 14 Nov 2026). The script removes it from
the events, and builds every report with `buildPatternReport`, the same pure function the route
calls, fed only real events. For 12 Nov, 29 Oct, 1 Nov and the week the script compared its report
with the route's and they were identical; 14 Nov cannot be compared (the route would count the mock
day, which adds a fake sleep, meeting and phone session).

## What a designer should know

- **Density.** A workday is 1,200 to 1,500 events. The iPhone opens 12 times per active hour on a
  workday, peaking at 25 in one hour; the busiest weekend hour had 42. The week report: an app
  opened on the phone every 11 minutes between 09:00 and 18:00, 86 sessions a day, median gap 3.5
  minutes, 31% of sessions under 30 seconds, 37% start with Instagram.
- **Sessions are tiny.** Median iPhone session 25 to 36 seconds (12 seconds on the Sunday, 45%
  under 10 seconds). Median Mac app session 26 seconds. A timeline needs aggregation (runs of the same
  app, hour buckets), not one row per event.
- **Focus is short.** Longest uninterrupted stretch: 8.7 minutes on 12 Nov, 15 minutes on 29 Oct,
  58 minutes today. 29 Oct: 53 disruptions, 76 minutes in the apps that caused them; the biggest
  were Gmail and Instagram pulling him off VS Code for 10 minutes each. Over the week WhatsApp is the
  repeat offender (16 breaks on 4 of 4 days), then Instagram.
- **Overlap is normal.** Mac and iPhone are often in use at the same time (12 Nov: Mac 6h 10,
  iPhone 5h 33, 2h 31 of it overlapping). Claude Code sessions run side by side: 29 Oct shows 12h 05
  by the clock but 19h 15 of session time.
- **Chrome visits are not attention.** Only about a quarter of `web_visit`s have
  `data.foreground: true`; the rest are background tabs, capped at 2 hours, often overlapping. Use
  `data.seconds` and `foreground`, not `end_at - start_at`.
- **Screen events** come in pairs (`Screen on` / `Screen off`, each with `end_at`), up to 294 a
  day; they mark when the Mac was in use, not something to list.
- **Titles.** App sessions are titled with the app name ("Instagram", "VS Code", "Phone call").
  Web visit titles are page titles: Greek and English mixed, often the site's own suffix ("... -
  Google Docs", "Inbox (9) - [email] - RealFlow. Mail"), up to 120 characters. Prompts are what he
  typed or dictated, cut at 120 characters, often mid word; a few read "Prompt without typed
  text". Searches can be long Google Maps strings with coordinates. Median title length is 10
  characters, so most rows are short, but plan for 120.
- **Time zone.** Timestamps are UTC (`Z`) from the collectors; display in `Europe/Athens`.

## Regenerate

On Manolis' Mac (the collector needs Full Disk Access for Mac and iPhone usage), from the repo root:

```sh
pnpm install
pnpm -C apps/api exec tsx ../web/scripts/export-real-days.mjs
# other days:
pnpm -C apps/api exec tsx ../web/scripts/export-real-days.mjs --days "2026-11-13=Friday,2026-11-14=Today" --week 2026-11-08..2026-11-14
```

It starts the API on port 8790 with the in-memory store (and stops if it is not), runs the collector
once with a throwaway cursor file, writes the files here and prints a JSON summary (counts, sizes,
headlines, whether each report matched the route). All options are documented at the top of
`apps/web/scripts/export-real-days.mjs`. Event ids are random per run, so regenerate every file of a
day together.
