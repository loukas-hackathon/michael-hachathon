# Michael API contract

This is the contract between `apps/api` and its clients (`apps/web`, MCP clients, webhook senders).
The source of truth for shapes is `packages/shared/src/schemas.ts`. **This file and that one must
change together, in the same PR, and the issue must say so.**

Status column: `live` = implemented in the starter (in-memory store), `stub` = route exists and
returns `501 not_implemented`, `planned` = not routed yet. Update the status when you ship.

## Conventions

- Base URL: `http://localhost:8787` locally, Railway URL in prod.
- All bodies are JSON. All timestamps are ISO 8601 **with offset** (`2026-11-14T09:30:00+02:00`
  or `...Z`). The API stores and returns instants; display timezone is `Europe/Athens`.
- IDs are UUIDs.
- List endpoints wrap results: `{ "goals": [...] }`, `{ "recommendations": [...] }`.
- **Auth:** every request acts for one user, and all data is scoped to that user.
  - Signed-in users (web app): `Authorization: Bearer <Supabase access token>`.
  - MCP clients (the claude.ai connector): an OAuth access token from Michael's own authorisation
    server (see "MCP authorization" below), bound to the user who allowed it. Only `/mcp` takes it.
  - Collectors, webhooks and our own tools: the shared secret `API_KEY`, which acts as the demo
    account (`demo@michael.app`). Per-user ingest tokens come later.
- **Shared secret details:**
  Send `Authorization: Bearer <API_KEY>`. Applies to everything under `/v1/*` and `/mcp`, except
  `/health` and the OAuth callback redirect (`/oauth/google/callback`). Only `/v1/webhooks/*` and `/mcp` also accept
  `?key=<API_KEY>` (for webhook senders and claude.ai connectors that cannot set headers); every
  other route rejects it. To be replaced by real auth (per-source secrets / HMAC, OAuth for MCP)
  if we go multi-user.

### Error shape

Every non-2xx response:

```json
{ "error": { "code": "bad_request", "message": "Validation failed", "details": [] } }
```

| code              | HTTP                                                    |
| ----------------- | ------------------------------------------------------- |
| `bad_request`     | 400 (validation errors put zod issues in `details`)     |
| `unauthorized`    | 401                                                     |
| `forbidden`       | 403 (agent lacks scope or is not approved)              |
| `not_found`       | 404                                                     |
| `conflict`        | 409                                                     |
| `not_implemented` | 501                                                     |
| `unavailable`     | 503 (a dependency is not configured, e.g. no model key) |
| `upstream_error`  | 502 (WHOOP, Google, Claude, Omi failed)                 |
| `internal`        | 500                                                     |

## Types

Enums:

- `Source`: `omi | whoop | health_auto_export | ios_shortcuts | activitywatch | google_calendar | owntracks | manual | agent | macos_usage | iphone_usage | chrome | claude_code | maps`
- `EventType`: `sleep | workout | recovery | biometric | app_usage | focus_session | conversation | memory | calendar_event | location | meal | note | web_visit | search | notification | screen | ai_session | ai_prompt | travel`
- `GoalCategory`: `business | health | personal`, plus the four older values, still accepted and
  readable: `work` (means business), `gym`, `rest`, `food` (mean health). Group with `goalArea`.
- `GoalArea`: `business | health | personal` (what `goalArea(category)` returns)
- `GoalKind`: `time | target | count | checklist` (in `goal.target.kind`; `time` when absent)
- `InstructionKind`: `clear_day | home_by | quiet_hours | custom`
- `RecommendationStatus`: `proposed | accepted | dismissed | done | undone` (`done` = action executed)
- `ActionKind`: `move_calendar_block | create_focus_block | block_mac_app | draft_follow_up | reminder`
- `AnalysisStatus`: `queued | running | succeeded | failed`
- `AnalysisTrigger`: `manual | scheduled | mcp | morning | evening`
- `AgentScope`: `timeline | goals | recommendations | score | write_events`
- `AgentStatus`: `pending | approved | revoked`
- `NudgeChannel`: `watch | push | telegram`; `NudgeStatus`: `queued | sent | failed | suppressed | test`
- `NudgeKind`: `focus_drift | block_soon | wind_down | goal_behind | morning | evening`; `NudgeSkip`: `nothing_to_say | quiet_hours | daily_cap | too_soon | off_the_record`
- `AppCategory`: `work | communication | social | video | news | shopping | travel | ai | music | system | other`
  (one shared categoriser for apps and sites, `packages/shared/src/categories.ts`; unknown = `other`)
- `IntegrationProvider`: `google_calendar | whoop`
- `IntegrationStatus`: `connected | disconnected | error`

```ts
type Event = {
  id: string; // uuid
  source: Source;
  type: EventType;
  start_at: string; // ISO datetime
  end_at: string | null; // null for instant events
  title: string; // human-readable, non-empty
  data: Record<string, unknown>; // source-specific payload
  external_id: string | null; // provider id; (source, external_id) is unique => idempotent ingest
  created_at: string;
};

type EventInput = {
  // what you POST
  source: Source;
  type: EventType;
  start_at: string;
  end_at?: string | null;
  title: string;
  data?: Record<string, unknown>;
  external_id?: string | null;
};

type Goal = {
  id: string;
  category: GoalCategory;
  title: string;
  description: string | null;
  target: Record<string, unknown> | null; // free form; the keys the API understands are GoalTarget
  weekly_budget_minutes: number | null; // e.g. 540 = "9 hours this week"
  active: boolean;
  created_at: string;
  updated_at: string;
};
// The known keys of `goal.target`. Any other key is allowed and kept as it is.
type GoalTarget = {
  kind?: GoalKind; // what the goal measures; absent = "time"
  label?: string; // a free label for a personal goal: "fun", "family", "hobby" (1 to 40 characters)
  calendar_titles?: string[]; // calendar event titles that count towards the goal
  work_categories?: AppCategory[]; // attention categories that count as this goal's work in its blocks
  sleep_hours?: number; // kind "target": hours a night
  screens_off?: string; // kind "target": "HH:MM"
  per_week?: number; // kind "count": times a week
  [key: string]: unknown;
};
type GoalCreate = {
  category: GoalCategory; // any of the seven values
  title: string;
  description?: string | null;
  target?: GoalTarget | null; // known keys are checked (400 on a wrong type), unknown keys are kept
  weekly_budget_minutes?: number | null;
  active?: boolean /* default true */;
};
type GoalUpdate = Partial<GoalCreate>;

type Instruction = {
  id: string;
  text: string; // the user's own words, kept exactly as written
  kind: InstructionKind;
  days?: number[]; // 0 = Sunday .. 6 = Saturday; left out when not set
  time?: string; // "HH:MM", 24 hour clock, local time; left out when not set
  end_time?: string; // "HH:MM"; left out when not set
  active: boolean; // false = paused: it protects nothing
  created_at: string;
  updated_at: string;
};
type InstructionCreate = {
  text: string; // 1 to 500 characters, not blank
  kind?: InstructionKind; // default "custom"
  days?: number[] | null;
  time?: string | null;
  end_time?: string | null;
  active?: boolean; // default true
};
type InstructionUpdate = Partial<InstructionCreate>; // null clears days, time or end_time

type RecommendationAction = {
  kind: ActionKind;
  payload: Record<string, unknown>;
  involves_others: boolean; // true => never executed, advice only
  undo_until: string | null; // undo allowed until then (normally the event start)
};
type Recommendation = {
  id: string;
  analysis_run_id: string | null;
  goal_id: string | null;
  title: string;
  rationale: string;
  action: RecommendationAction | null;
  evidence?: string[]; // what supports it: pattern names ("phone_cadence"), "plan" or "score"; absent on older rows
  status: RecommendationStatus;
  executed_at: string | null;
  undone_at: string | null;
  source?: "analysis" | "chat"; // "chat": asked for in chat or by voice and carried out at once
  created_at: string;
  updated_at: string;
};

type AnalysisRun = {
  id: string;
  status: AnalysisStatus;
  trigger: AnalysisTrigger;
  range_start: string;
  range_end: string;
  model: string; // the model that answered (a fallback model when the first one declined)
  summary: string | null; // Michael's brief for the moment, at most four lines
  question?: string | null; // one short question about a missing fact, usually null
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type Integration = {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  account: string | null; // Google: the address of the account the user picked
  connected_at: string | null;
  last_sync_at: string | null;
  error: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type Health = {
  status: "ok";
  version: string;
  time: string;
  storage: "memory" | "supabase";
  commit: string | null;
};
```

## Endpoints

### Health

| Method | Path      | Auth | Status |
| ------ | --------- | ---- | ------ |
| GET    | `/health` | none | live   |

Response `200`: `Health`.

### Timeline and ingest

| Method | Path               | Status |
| ------ | ------------------ | ------ |
| GET    | `/v1/timeline`     | live   |
| POST   | `/v1/events`       | live   |
| POST   | `/v1/events/batch` | live   |

`GET /v1/timeline?from=<iso>&to=<iso>&source=a,b&type=x,y`

- `from`, `to` optional; default is the 24h ending now. Events overlapping `[from, to]` are returned,
  sorted by `start_at` ascending.
- `source`, `type` optional comma-separated filters.
- `200`: `{ from, to, events: Event[] }`. `400` on bad dates or unknown enum values.

`POST /v1/events` body `EventInput` → `201 { inserted: number, duplicates: number, ignored: number, events: Event[] }`.
`ignored` counts events dropped because their source is switched off or the user is off the record.
A duplicate `(source, external_id)` is skipped and counted in `duplicates` (not an error).

`POST /v1/events/batch` body `{ events: EventInput[] }` (1..1000) → same response as above.

### Source webhooks

All `POST`, auth required, body is the provider's native payload. Each maps to `EventInput[]` and
ingests idempotently. Response `200 IngestResponse`. Status: `stub`, except where a row says `live`.

| Path                              | Sender                                                  | Maps to                         |
| --------------------------------- | ------------------------------------------------------- | ------------------------------- |
| `/v1/webhooks/omi`                | Omi app, "conversation created" (**live**)              | `conversation`                  |
| `/v1/webhooks/health-auto-export` | Health Auto Export iOS app (**live**)                   | `sleep`, `workout`, `biometric` |
| `/v1/webhooks/ios-shortcuts`      | iPhone Shortcuts automations, app open/close (**live**) | `app_usage`                     |
| `/v1/webhooks/activitywatch`      | a forwarder reading ActivityWatch on the Mac (**live**) | `app_usage`, `focus_session`    |
| `/v1/webhooks/claude-code`        | Claude Code `type: "http"` hooks (**live**)             | `ai_prompt`, `notification`     |

The exact provider payload for each is documented in the issue that implements it, then copied here.

`POST /v1/webhooks/health-auto-export` takes the app's JSON export as is
(`{ data: { metrics: [...], workouts: [...] } }`, format:
https://help.healthyapps.dev/en/health-auto-export/export-format). Setup:
`docs/sources/health-auto-export.md`. Mapping (`apps/api/src/ingest/health-auto-export.ts`):

| Input                                       | Event       | `title`                          | `data`                                                                                                               | `external_id`                   |
| ------------------------------------------- | ----------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `sleep_analysis`, summarised or segments    | `sleep`     | `Sleep 6h55m`                    | `duration_min`, `deep_min?`, `rem_min?`, `core_min?`, `awake_min?`, `in_bed_min?`, `device?`                         | `hae:sleep:<start, UTC minute>` |
| `workouts[]` (v1 or v2)                     | `workout`   | `Outdoor Run 42m, 6.1 km`        | `name`, `duration_min`, `active_kcal?`, `distance?`, `distance_units?`, `avg_hr?`, `max_hr?`, `location?`, `device?` | `hae:workout:<id or start>`     |
| kept metrics, one event per metric per hour | `biometric` | `Heart rate 77.2 bpm, 61 to 112` | `metric`, `units`, `samples`, then `min`, `avg`, `max` (rates) or `total` (counts)                                   | `hae:<metric>:<UTC hour>`       |

- Kept metrics: `heart_rate`, `resting_heart_rate`, `walking_heart_rate_average`,
  `heart_rate_variability`, `respiratory_rate`, `blood_oxygen_saturation`, `vo2_max` (min/avg/max)
  and `step_count`, `active_energy`, `apple_exercise_time`, `apple_stand_time`, `flights_climbed`,
  `walking_running_distance` (totals). Every other metric is dropped and named in the response
  header `x-michael-skipped-metrics`. Workout routes (GPS) are never stored.
- Ingest is insert once, so only finished data is stored: an hour once it is over, a night once it
  ended 20 minutes ago. The next export picks up the rest. All times are stored in UTC.
- A sample or workout that does not fit is skipped; the rest of the export is still stored. A body
  without `data` is `400`.

`POST /v1/webhooks/omi` takes the Omi "conversation created" (memory creation) webhook body as is
(format: https://docs.omi.me/doc/developer/apps/Integrations). Setup: `docs/sources/omi.md`.
Omi appends `?uid=`; it is ignored. Mapping (`apps/api/src/ingest/omi.ts`): one `conversation`
event, `start_at`/`end_at` = `started_at`/`finished_at`, `title` = `structured.title`, `data`:
`summary` (`structured.overview`), `category`, `action_items` (descriptions), `action_items_done`,
`duration_min`. `external_id` = `omi:<id>`. Only those fields are read: transcript segments, speaker
names, app results and folders are never stored. A `discarded` conversation, a real time transcript
batch (a JSON array) or any other Omi payload answers `200` with nothing inserted.

`POST /v1/webhooks/ios-shortcuts` takes our own tiny body, sent by a Shortcuts personal automation
("App is opened" / "App is closed", then "Get Contents of URL"). Setup: `docs/sources/ios-shortcuts.md`.

```ts
type ShortcutsPayload = {
  app: string; // the Shortcuts "App" value, e.g. "Instagram"
  action: "open" | "close"; // "opened", "closed", any case also accepted
  at?: string; // ISO 8601; missing or unreadable = time of arrival
  bundle_id?: string; // optional, e.g. "com.burbn.instagram"
};
```

- An `open` is held until its `close`; the pair becomes one `app_usage` event (`source:
  ios_shortcuts`, `title` = app, `data`: `app`, `device: "iphone"`, `seconds`, `bundle_id?`,
  `external_id` = `sc:<app lowercased>:<start, UTC second>`). The open alone answers `200` with
  nothing inserted.
- Opening another app closes the held one at that moment. A close with no open, or a session longer
  than two hours, is dropped. Held opens live in the API's memory, so a deploy in the middle of a
  session loses that session.
- While off the record or with the source off, a call answers `ignored: 1` and an open is not held.
- The patterns layer reads `iphone_usage` only for now; these events show on the timeline.

`POST /v1/webhooks/activitywatch` takes ActivityWatch bucket events exactly as
`GET /api/0/buckets/<id>/events` returns them (`{ timestamp, duration, data: { app, title } }`
for `aw-watcher-window`, `data: { status: "afk" | "not-afk" }` for `aw-watcher-afk`), as either
`{ window: AwEvent[], afk?: AwEvent[] }` or the body of `GET /api/0/export` (`{ buckets: {...} }`).
Format: https://docs.activitywatch.net/en/latest/buckets-and-events.html. Mapping
(`apps/api/src/ingest/activitywatch.ts`):

- Away time (`afk`) is cut out, then the same app within 10 seconds is one run: one `app_usage`
  event (`title` = app, `data`: `app`, `device: "mac"`, `seconds`; `external_id` =
  `aw:<app lowercased>:<start, UTC second>`). Window titles are never stored.
- Focus rule: work app runs (editors, terminals, design and writing tools, see `WORK_APPS`) where
  every gap or non work stretch between them is at most 3 minutes, lasting at least 25 minutes from
  the first work run to the last, with work apps at least 70% of that time. Browsers neither break
  nor count. Gives a `focus_session` (`title` `Deep work: Code + Terminal (36m)`, `data`: `apps`
  (minutes per app), `switches`, `minutes`, `work_share`; `external_id` = `aw:focus:<start minute>`).
- Runs and stretches that ended in the last two minutes wait for the next post. Send ranges that
  start where the last post ended, so a run is not cut in two.

`POST /v1/webhooks/claude-code` takes the hook payload Claude Code posts (see "Connect Claude Code"
in the README). Fields read: `hook_event_name`, `session_id`, `prompt_id`, `cwd`, `prompt`,
`notification_type`. Everything else in the payload (tool input, tool output, the assistant's
answer, the notification text) is dropped before anything is stored. Payloads carry no timestamp,
so `start_at` is the time of arrival.

| `hook_event_name`                                               | Stored as                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `UserPromptSubmit`                                              | `ai_prompt`, `external_id` `cc:<session_id>:prompt:<prompt_id>`                 |
| `Notification` with type `permission_prompt` or `idle_prompt`   | `notification` (Claude Code is waiting for the person), `data.kind` is the type |
| `Stop`, `SessionEnd`, other notification types, any other event | accepted, not stored (they need an event type of their own)                     |

- Response: always `204` with an empty body once the key is accepted, also for a payload we do not
  recognise, so a hook never slows or fails a session. Claude Code reads a JSON body as hook output,
  which is why this route does not return `IngestResponse`. The header `x-michael-result` says what
  happened: `stored`, `duplicate`, `ignored` or `error`. A missing or wrong key is still `401`.
- A `UserPromptSubmit` that is not a typed prompt (a background task report, a slash command) is
  `ignored`.
- The transcript reader in `apps/collector` later sends the same prompt under the same
  `external_id` (the transcript's `promptId` is the hook's `prompt_id`), so one prompt is one event.

### Events from the local collectors

`apps/collector` (and later `apps/extension`) run on the user's own Mac and post to
`POST /v1/events/batch`. Every event carries a stable `external_id`, so a backfill can be re-run.
The `data` payload per type:

| Source                        | Type           | `title`                            | `data`                                                                                                                        |
| ----------------------------- | -------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `macos_usage`, `iphone_usage` | `app_usage`    | app name                           | `bundle_id`, `device` (`mac` or `iphone`), `seconds`, `opened_from?` (`home_screen`, `app_switcher`, `notification`, `other`) |
| `macos_usage`                 | `notification` | app name                           | `bundle_id`, `device`                                                                                                         |
| `macos_usage`                 | `screen`       | `Screen on` or `Screen off`        | `state` (`on` or `off`), `device`                                                                                             |
| `chrome`                      | `web_visit`    | page title                         | `host`, `seconds`, `foreground?`, `category?`, `origin`, `profile?`. Never the full address                                   |
| `chrome`                      | `search`       | the search term                    | `engine`, `term`, `origin`, `profile?`                                                                                        |
| `claude_code`                 | `ai_session`   | session title                      | `tool`, `session_id`, `project`, `model?`, `turns`, `waiting_seconds`, `input_tokens`, `cached_input_tokens`, `output_tokens` |
| `claude_code`                 | `ai_prompt`    | first 120 characters of the prompt | `tool`, `session_id`, `project`                                                                                               |
| `claude_code`                 | `notification` | `Claude Code`                      | `tool`, `session_id`, `project`, `kind` (`permission_prompt` or `idle_prompt`). Live hook only                                |

Browsing events (`web_visit`, `search`) carry `origin`: `history` when they come from Chrome's own
history file (`apps/collector`), `extension` when the browser extension saw them live. The same
visit can arrive from both; the patterns layer decides which to trust. From `history`:

- `foreground` is `true` when `seconds` is the time Chrome measured the page in front, and `false`
  when Chrome did not measure it and `seconds` is how long the page stayed open. Capped at two hours.
- `category` is one of `travel`, `shopping`, `social`, `news`, `video`, `messaging`, `mail`, `dev`,
  `ai`, `docs`, `finance`, `search`, from a short built in list of well known sites
  (`apps/collector/src/site-categories.ts`). A site we do not know has no category.
- `profile` is the Chrome profile folder (`Default`, `Profile 1`).
- Visits to excluded hosts (banking, health, adult, password managers, the local network, and the
  user's own list) are never sent, and neither are their titles or search terms
  (`apps/collector/src/site-privacy.ts`).

AI tool events (`ai_session`, `ai_prompt`) from `claude_code`:

- One `ai_session` is one **work stretch** of a Claude Code session: a run of activity with no pause
  longer than 30 minutes. A session left open for days gives several. `external_id` is
  `cc:<session_id>:<start_at>`. A stretch is sent once it is closed (its last record is more than
  30 minutes old), so its numbers are final.
- `title` is the session's own title, else the first 80 characters of the stretch's first prompt.
- `turns` counts prompts typed by the person. `waiting_seconds` is the time Claude Code sat finished
  and waiting: from the end of an assistant turn to the next typed prompt, gaps of 30 minutes or
  more left out.
- `input_tokens` is everything the model read (fresh input, cache writes and cache reads), subagents
  included; `cached_input_tokens` is the cache read part of it. `model` is the most used one.
- `project` is the name of the working folder.
- Prompt titles are cut to 120 characters on one line, with anything that looks like a key or token
  replaced by `[secret]`. Pasted blocks and editor context are left out; a prompt with nothing typed
  is titled `Prompt without typed text`. Tool input, tool output, file contents and assistant text
  are never stored. The rules live in `packages/shared/src/ai-prompts.ts`.

### Goals

| Method | Path            | Body         | Response                | Status |
| ------ | --------------- | ------------ | ----------------------- | ------ |
| GET    | `/v1/goals`     |              | `200 { goals: Goal[] }` | live   |
| GET    | `/v1/goals/:id` |              | `200 Goal`, `404`       | live   |
| POST   | `/v1/goals`     | `GoalCreate` | `201 Goal`              | live   |
| PATCH  | `/v1/goals/:id` | `GoalUpdate` | `200 Goal`, `404`       | live   |
| DELETE | `/v1/goals/:id` |              | `204`, `404`            | live   |

#### Three categories, four kinds

Goals sit in three categories: `business`, `health`, `personal`. The four older values are still
accepted and readable, so nothing stored breaks: `work` means business; `gym`, `rest` and `food`
mean health. `goalArea(category)` in `@michael/shared` returns the one of the three for any of the
seven values; the API groups and reasons with it everywhere (score, patterns, moments, chat).
New goals may use any of the seven; use the three. The older values will be removed in a later
change, once every client has moved and the stored rows have been rewritten.

What a goal measures is its **kind**, in `target.kind` (`target` is a free form record, so this
needs no table change). `goalKind(goal)` reads it:

| Kind        | Measures                                             | In `target`                               |
| ----------- | ---------------------------------------------------- | ----------------------------------------- |
| `time`      | Weekly minutes in planned blocks. The default.       | `calendar_titles`, `work_categories`      |
| `target`    | A value per day: sleep 7.5 hours, screens off 23:00. | `sleep_hours`, `screens_off`, or your own |
| `count`     | Times a week.                                        | `per_week`                                |
| `checklist` | The day's one to three business outcomes.            | (the items are not stored on the goal)    |

**Only `time` goals take part in the time score.** A `target`, `count` or `checklist` goal has no
planned blocks: `GET /v1/score` lists it with `scored: false` so the Goals screen can show it. One
fallback keeps older data right: a goal with no kind, category `rest`, and a sleep or bed key in
its target (or the word sleep in its title) reads as `target`. `isSleepGoal(goal)` says whether a
goal is the sleep goal (health, kind `target`, describes sleep).

`target` is checked softly on `POST` and `PATCH`: the known keys (`GoalTarget` above) must have the
right type, or the answer is `400`; any other key is stored as it is. A personal goal carries a
free `label` (fun, family, hobby); there is no enum for it.

One example per category:

```json
{
  "category": "business",
  "title": "The company",
  "weekly_budget_minutes": 480,
  "target": {
    "kind": "time",
    "calendar_titles": ["Cold Outreach / Sales", "Call Leads"],
    "work_categories": ["communication"]
  }
}
```

```json
{
  "category": "health",
  "title": "Sleep",
  "target": { "kind": "target", "sleep_hours": 7.5, "screens_off": "23:00" }
}
```

```json
{
  "category": "personal",
  "title": "Fun",
  "weekly_budget_minutes": 120,
  "target": { "kind": "time", "label": "fun", "calendar_titles": ["Night out"] }
}
```

A count goal: `{ "category": "health", "title": "Yoga", "target": { "kind": "count", "per_week": 2 } }`.

#### Categories that count as a goal's work

Communication is a distraction in most blocks, but inside a sales block mail and messages are the
work. A goal says so in `target.work_categories`, a list of `AppCategory` values:

```json
{ "target": { "calendar_titles": ["Call Leads"], "work_categories": ["communication"] } }
```

Inside that goal's blocks, time in those categories is **spent and verified, not lost**. Other
goals' blocks are unchanged. One function decides what attention means inside a block
(`apps/api/src/score/purpose.ts`), and both the score and the patterns' calendar mode read it, so
the two numbers agree:

| Attention in the block                          | Business goal     | Health or personal goal |
| ----------------------------------------------- | ----------------- | ----------------------- |
| A category the goal lists in `work_categories`  | spent, verified   | spent, verified         |
| `work`, `ai`                                    | spent, verified   | **lost**                |
| `communication`, `social`, `video`, `news`, ... | lost              | lost                    |
| `music`, `system`, `other`                      | spent, unverified | spent, unverified       |

Work apps inside a training block are lost: a sales call during the gym session is not training.
The same goes for a personal block. A goal that really does use such a category (a follow along
video in a yoga block) lists it in `work_categories`.

#### Which calendar events count towards a goal

People do not name calendar events after their goals: "Gym", "Swimming 1,500m" and "Run" can all
mean one training goal. So a goal lists the calendar titles that count towards it, in `target`
(a free form record, so this needs no schema or database change):

```json
{ "category": "health", "title": "70.3", "target": { "calendar_titles": ["Gym", "Swimming", "Run"] } }
```

A calendar event belongs to the goal when its title **equals an entry or starts with it**, ignoring
case, accents and extra spaces. An entry ends at a word boundary: `Run` matches `Run` and
`Run: 8 km`, not `Runway review`. Entries that are not text are skipped.

One matcher decides this for the score and for the patterns' calendar mode
(`apps/api/src/score/match.ts`). Rules, first hit wins, over the user's active goals of kind `time`:

1. `data.goal_id` on the event names a goal.
2. `target.calendar_titles` of a goal (the longest matching entry wins).
3. `data.goal_category` (or `data.category`) names a goal category: the first goal of that category.
4. The title starts with a goal's own title.
5. The title starts with one of the older category words (`Gym: legs`, `Work: pitch`), or contains
   `deep work` or `focus` (work).

Rules 3 to 5 are the older provisional ones, kept as fallbacks. In rules 3 and 5 a category means
the first goal with exactly that category, or else the first goal in the same one of the three:
`work` finds a business goal, `gym` a health goal (`rest` and `food` only find a goal that still
carries that older name). `business`, `health` and `personal` are not title words, so
"Personal training" does not land on a personal goal. **An event with other people in it
is never the user's own block:** `data.attendees` is the number of other people, and any value
above 0 makes the event a meeting, whatever its title or `goal_id` says. Each block in
`GET /v1/score` carries `matched_by`, the rule that tied it to its goal.

### Standing instructions

Some things are not goals: they are the user's ground rules, such as "keep Sundays clear" or "home
every day by 21:00". The user gives a few at setup and can change, pause or remove them later.
**Michael never plans or moves anything into the time an active instruction protects**, and flags
what already sits there.

| Method | Path                   | Body                | Response                              | Status |
| ------ | ---------------------- | ------------------- | ------------------------------------- | ------ |
| GET    | `/v1/instructions`     |                     | `200 { instructions: Instruction[] }` | live   |
| POST   | `/v1/instructions`     | `InstructionCreate` | `201 Instruction`, `400`              | live   |
| PATCH  | `/v1/instructions/:id` | `InstructionUpdate` | `200 Instruction`, `400`, `404`       | live   |
| DELETE | `/v1/instructions/:id` |                     | `204`, `404`                          | live   |

Per user, behind the normal auth, oldest first. The list has its own table and its own endpoints
rather than a place inside the profile (`GET/PUT /v1/profile`): the profile is one document saved
whole, and an instruction is a row the user adds, edits, pauses and removes by id. The night
window for nudges stays in the profile (`quiet_hours`); an instruction of kind `quiet_hours` is
about planning, not about nudges.

| Kind          | Protects, in the user's local time                                          | Needs                 |
| ------------- | --------------------------------------------------------------------------- | --------------------- |
| `clear_day`   | The whole day, midnight to midnight, on each of `days`                      | `days`                |
| `home_by`     | From `time` until the day ends, on `days` (every day when `days` is absent) | `time`                |
| `quiet_hours` | From `time` to `end_time`, on `days` (every day when absent)                | `time` and `end_time` |
| `custom`      | Nothing: it is text for the coach to read                                   |                       |

- `text` is always the user's own words and is never rewritten. `kind` defaults to `custom`, so a
  client may send only the words.
- `days`: 0 = Sunday to 6 = Saturday. `time` and `end_time`: `"HH:MM"`, 24 hour clock.
- When `end_time` is not after `time`, quiet hours run past midnight (22:00 to 07:00) and belong to
  the day they start on. `home_by` stops at midnight: the small hours belong to the next day.
- A kind must have what it needs, on create and after a change (`400` otherwise). `null` in a
  `PATCH` clears `days`, `time` or `end_time`. Pause with `{ "active": false }`.
- `days`, `time` and `end_time` are left out of the answer when they are not set.

```json
{ "text": "Keep Sundays clear", "kind": "clear_day", "days": [0] }
```

Which instructions a span of time falls under is one pure function,
`protectedBy(instructions, start, end, timezone)` in `apps/api/src/instructions/protected.ts`. It
returns the active instructions with any part of the span inside their protected time. Ends are
exclusive (a block that stops at Sunday 00:00 has not touched Sunday), days are local days in the
timezone given (default Europe/Athens), and the days the clocks change are handled. It is there for
the analysis and the actions to call before they plan or move anything. The score does not count
with it: each block in `GET /v1/score` only carries `instructions_broken`, the ids of the active
instructions its time falls under, so the app can flag a work block planned on a clear Sunday. The
chat with Michael and the analysis brief are given the active instructions, as the user wrote
them, with the rest of their context; a paused one is left out.

`mockInstructions` in `packages/shared/src/mocks.ts` holds one example ("Keep Sundays clear").

### Analysis

| Method | Path                  | Body                                               | Response                                                                                                                                                                                 | Status |
| ------ | --------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| POST   | `/v1/analysis/run`    | `{ from?, to?, trigger? }`, or no body (see below) | `201 { run: AnalysisRun, recommendations: Recommendation[] }`; `400` bad range; `502 upstream_error` if the model fails or its answer is unusable; `503 unavailable` without a model key | live   |
| GET    | `/v1/analysis/latest` |                                                    | `200 { run, recommendations }`, `404` if none                                                                                                                                            | live   |

`POST /v1/analysis/run` is how Michael speaks. One run reads the caller's data, writes an
**analysis brief**, asks Claude once, checks the answer and stores an `AnalysisRun` (`summary` is
Michael's short brief for the moment, `question` his one question when a fact is missing) with up
to 3 `Recommendation`s, all `proposed`. The first recommendation is the lead: the one the Today
card shows. `evidence` names what proves it: patterns (`PatternReport` keys), `"plan"` (the goals
and their blocks) or `"score"`.

- **Body.** `from`, `to`: ISO with offset; default is today so far in `Europe/Athens`. A range that
  ended in the past is read as it stood at its end, so a day can be run again later. At most 31
  days. `trigger`: `manual` (default) `| scheduled | mcp | morning | evening`; it decides what the
  summary talks about (morning: the plan; evening: the day against the plan).
- **Failure.** If the model declines, times out or answers something that is not the agreed JSON,
  the run is stored with `status: "failed"` and `error`, and the response is `502 upstream_error`
  with `details.run_id`. Without `ANTHROPIC_API_KEY` the route answers `503 unavailable` before
  reading any data, and nothing else in the API is affected.
- **The model.** `claude-opus-5-5` (`ANTHROPIC_MODEL`), adaptive thinking, effort `medium`,
  structured output (a JSON schema, checked again with zod), server side fallbacks if the request
  is declined, and the coach instructions as a cached system prompt
  (`apps/api/src/analysis/coach.ts`: one stable string, nothing per user in it).
- **What never depends on the model** (`analysis/output.ts`): `goal_id` is one of the user's goals
  or null; at most 3 recommendations; `evidence` only names patterns that had data; an `action` is
  kept only when it is in the future, inside the user's own time and clear of every event with
  other people, otherwise the action is dropped and the advice stays. A `move_calendar_block` can
  only name one of the user's own goal blocks that has not started. Stored payloads are the ones
  `POST /v1/recommendations/:id/execute` takes. Actions are stored, not carried out: executing
  stays a separate call.
- **Copy.** The hard copy rules are checked in code (no dashes as punctuation, no emoji, no
  exclamation marks, none of the banned words). Actions are offers until the person taps, so a
  summary or rationale that says something was already done ("I've set", "I moved", "already
  moved") is a violation too. On a violation, or a dropped action, the model is asked once more and
  told exactly what was wrong; if the second answer is no better the run is stored anyway and the
  violations are logged.

**Privacy: what is sent to the model.** Only the brief, built by one pure function
(`analysis/brief.ts`, held in place by `brief.test.ts`). It holds summaries, never raw events:

| In the brief                                                                                                                              | Never in the brief                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Now, timezone, trigger, the local range                                                                                                   | Event ids, external ids, raw events                                           |
| Goals: id, title, category (as data), weekly budget, description, this week's planned, spent, lost and unverified minutes (the score)     | Search terms, page titles, full addresses                                     |
| Standing instructions, in the user's own words (`instructions`: the active ones from `/v1/instructions`)                                  | A site's host, unless it is on the shared public list                         |
| The plan for today and tomorrow (and yesterday in the morning): the user's own goal blocks with title, start, end and the score's numbers | The title of any calendar entry that is not the user's own goal block         |
| Events with other people: "busy from A to B" only. The user's own entries with no goal: time only                                         | Names, attendees, locations or anything else about an event with other people |
| Patterns for the last 7 days and for the range: each detector's sentence and a trimmed set of numbers, or the reason it has too little    | Conversations, memories, notes, meals, message text, AI prompts (never read)  |
| Data notes: how old the phone and Mac data is, the share of browser time not measured, sources with no data                               | Anything from another user: every read is scoped to the caller                |
| The last 5 recommendations: day, title, status, and whether an analysis made it                                                           |                                                                               |
| `actions_are`: `offers` (nothing is carried out until the person taps) or `applied`. Runs pass `offers`                                   |                                                                               |
| `already_asked`: the last 5 questions Michael asked, with their day, so he never asks one twice                                           |                                                                               |

`pnpm --filter @michael/api analysis:brief --from <iso> --to <iso> --trigger evening --api http://localhost:8787`
prints the system prompt and the user message exactly as a run would send them, from a local API,
without calling any model.

### Patterns

| Method | Path                               | Response            | Status |
| ------ | ---------------------------------- | ------------------- | ------ |
| GET    | `/v1/patterns?from=<iso>&to=<iso>` | `200 PatternReport` | live   |

`from`, `to` optional; default is the 7 days ending now. `400` on bad dates, `to` not after `from`,
or a range over 92 days. Computed on request by pure functions in `apps/api/src/patterns` (plain
rules, no model): the same events always give the same report. Days and hours are local
(`Europe/Athens`), correct across the daylight saving change.

This is what the analysis (`POST /v1/analysis/run`) reads instead of raw events: `headlines` holds
the one line summary of every detector that had enough data, most important first.

```ts
type PatternReport = {
  from: string;
  to: string;
  timezone: string; // "Europe/Athens"
  generated_at: string;
  days: { day: string; complete: boolean }[]; // local days; complete = not cut short by the range
  inputs: {
    // how many events the report was built from
    mac_app_usage: number;
    iphone_app_usage: number;
    web_visits: number;
    web_visits_superseded: number; // history visits ignored because the extension covered them
    web_visits_unmeasured: number; // history visits ignored because Chrome did not measure them in front
    searches: number;
    goal_blocks: number;
    sleeps: number;
    ai_sessions: number;
  };
  headlines: string[];
  phone_cadence: Detector<PhoneCadence>;
  mac_app_cadence: Detector<MacAppCadence>;
  focus_disruptions: Detector<FocusDisruptions>;
  recovery_cost: Detector<RecoveryCost>;
  repeat_offenders: Detector<RepeatOffenders>;
  drift: Detector<Drift>;
  late_screens: Detector<LateScreens>;
  context_switching: Detector<ContextSwitching>;
  time_by_app: Detector<TimeByApp>;
  ai_tool_use: Detector<AiToolUse>;
};

// Every detector answers in the same envelope.
type Detector<T> = {
  status: "ok" | "not_enough_data";
  reason: string | null; // "not enough data: needs at least 3 days of phone usage, found 1"
  minimum: string; // the smallest sample this detector speaks from
  summary: string | null; // one plain sentence with the numbers
  evidence: string[]; // up to 20 event ids, so the app can show the proof
  data: T | null; // null with too little data: a number is never made up
};

type PatternSubject = { kind: "app" | "site"; key: string; name: string; category: AppCategory };
// key = bundle id for an app, host for a site (never a full address)
```

Units: `*_minutes` are minutes with one decimal, `*_seconds` whole seconds, `*_share` is 0..1.
"Per day" figures are averaged over complete local days that have data (a day the range cuts
short only counts when there is no complete day). The `data` shapes are the zod schemas of the
same names in `packages/shared/src/schemas.ts`; the main fields:

```ts
type PhoneCadence = {
  days_with_data: number;
  sessions: number;
  screen_only_sessions: number; // lock screen or home screen only: counted apart, not in `sessions`
  sessions_per_day: number;
  checks_share: number; // sessions under 30 seconds
  median_session_seconds: number;
  gaps: number; // waking gaps used
  median_gap_minutes: number;
  typical_gap_minutes: { p25: number; p75: number };
  window: {
    // the working window, 09:00 to 18:00
    start_hour: number;
    end_hour: number;
    sessions_per_day: number;
    average_interval_minutes: number | null; // window length / sessions per day
    gaps: number;
    median_gap_minutes: number | null; // null under 20 gaps
  };
  opened: { notification: number; own_hand: number; unknown: number; notification_share: number | null };
  first_apps: { app: PatternSubject; sessions: number; share: number }[]; // top 5
  by_hour: { hour: number; sessions: number; sessions_per_day: number; median_gap_minutes: number | null }[]; // 24 rows
  daily: { day; complete; sessions; checks; minutes; median_gap_minutes: number | null }[]; // minutes = session time
};

type MacAppCadence = {
  days_with_data: number;
  apps: {
    app: PatternSubject;
    activations: number;
    days: number;
    activations_per_day: number;
    minutes_of_mac_use_per_activation: number | null;
    median_gap_active_minutes: number | null; // null under 5 gaps
    checks_share: number;
    median_visit_seconds: number;
    after_notification_share: number | null; // null when the Mac logged no notification from the app
  }[];
};

type Disruption = {
  mode: "calendar" | "inferred";
  day: string;
  start_at: string; // the distractor comes up
  end_at: string; // back in a work app (or the end of the off purpose visit)
  device: "mac" | "iphone";
  trigger: PatternSubject;
  opened_by_notification: boolean | null;
  left: PatternSubject | null; // the work app that was in front before
  minutes_lost: number; // time in the distracting apps and sites
  minutes_until_back: number | null; // from start_at until `left` is in front again
  ended_stretch: boolean;
  block_event_id: string | null;
  goal_id: string | null;
  event_ids: string[];
};

type FocusDisruptions = {
  mode: "calendar" | "inferred" | "mixed";
  days_with_data: number;
  uncategorised_share: number; // screen time with no category: the detector cannot see focus there
  blocks: number;
  stretches: number;
  focus_minutes: number;
  disruptions: number;
  disruptions_per_day: number;
  minutes_lost: number;
  minutes_lost_per_day: number;
  longest_uninterrupted_minutes: number;
  median_daily_longest_uninterrupted_minutes: number;
  daily: {
    day;
    complete;
    focus_minutes;
    stretches;
    disruptions;
    ended_stretches;
    minutes_lost;
    longest_uninterrupted_minutes;
  }[];
  items: Disruption[]; // newest first, at most 100
};

type RecoveryCost = {
  measured: number;
  not_returned: number;
  median_minutes_lost: number;
  median_minutes_until_back: number;
  multiplier: number | null;
  total_minutes_until_back: number; // union of the away spans: nested disruptions count once
  minutes_until_back_per_day: number;
  daily: { day; measured; total_minutes_until_back; median_minutes_until_back: number | null }[];
};

type RepeatOffenders = {
  days_with_focus: number;
  offenders: { subject: PatternSubject; devices; disruptions; minutes_lost; days; ended_stretches }[]; // top 10
};

type Drift = {
  minutes: number;
  by_category: { category: AppCategory; minutes; visits; days }[];
  daily: { day; minutes }[];
  items: {
    day;
    start_at;
    site: PatternSubject;
    minutes;
    during: "focus_stretch" | "work_block";
    search_event_id: string | null;
    event_id;
  }[];
};

type LateScreens = {
  cutoff: string; // "23:00"
  cutoff_source: "default" | "usual_bedtime";
  usual_bedtime: string | null;
  nights_observed: number;
  late_nights: number; // 5 minutes or more after the cut off
  median_late_minutes: number | null;
  nights: {
    night;
    minutes;
    mac_minutes;
    iphone_minutes;
    top: PatternSubject | null;
    top_minutes;
    last_seen_at;
    next_recovery_pct;
    next_sleep_minutes;
  }[];
  recovery_comparison: { late_nights; late_avg_recovery_pct; other_nights; other_avg_recovery_pct } | null;
};

type ContextSwitching = {
  days_with_data: number;
  active_minutes: number;
  switches: number;
  switches_per_active_hour: number;
  fragment_share: number; // share of active time in stays under 2 minutes
  median_stay_seconds: number;
  daily: {
    day;
    complete;
    active_minutes;
    switches;
    switches_per_active_hour: number | null;
    fragment_share: number | null;
  }[];
};

type TimeTotals = {
  active_seconds: number; // = mac_seconds + iphone_seconds = sum(by_category) = sum(apps) + other_apps_seconds
  mac_seconds: number;
  iphone_seconds: number;
  overlap_seconds: number; // Mac time under phone use, counted once as phone time
  by_category: { category: AppCategory; seconds: number }[];
  apps: { subject: PatternSubject; device; seconds }[]; // top 10 per day, top 15 in totals
  other_apps_seconds: number;
};
type TimeByApp = {
  days_with_data: number;
  active_minutes_per_day: number;
  totals: TimeTotals;
  daily: (TimeTotals & { day: string; complete: boolean })[];
};

type AiToolUse = {
  days_with_data: number;
  sessions: number;
  sessions_per_day: number;
  session_minutes: number; // each session in full
  wall_minutes: number; // sessions side by side counted once
  waiting_minutes: number | null;
  waiting_share: number | null; // waiting / session time, over sessions that report waiting
  by_tool: { tool; sessions; session_minutes; waiting_share }[];
  daily: { day; sessions; session_minutes; wall_minutes }[];
};
```

#### One timeline first

Before any detector runs, the events become one line of attention (`patterns/timeline.ts`). These
rules live there and nowhere else:

- **Sources used:** `app_usage` from `macos_usage` and `iphone_usage` (needs `bundle_id` and an
  end; `device: "watch"` is left out), `web_visit`, `search`, `screen`, `notification`, `sleep`, `recovery`, `calendar_event`,
  `ai_session`. `app_usage` from `ios_shortcuts` and `focus_session` are not used, so the same
  minute is not counted from two sources.
- **Mac:** one thing in front at a time. If two intervals overlap, the one that started later wins.
  Time with the screen off (`screen` events with state `off` and an end) is removed.
- **Web visits** refine the browser: while a browser is in front, the visit's host and category
  replace it. A visit never overrides another app in front. A browser with no visit data stays
  `other`.
- **Origin precedence:** for every clock hour in which the extension reported a visit
  (`data.origin = "extension"`), history visits that start in that hour are ignored; where the two
  still overlap the extension wins. A visit with no `origin` is history.
- **Unmeasured history visits are not used.** When Chrome did not measure a page in front
  (`data.foreground = false`), its length only says how long the tab stayed open. An open tab
  would claim browser time it never had, so these visits are left out (counted in
  `inputs.web_visits_unmeasured`) and that browser time stays `other`.
- **The Mac's log decides what was in front.** Wherever it is alive (within 6 hours of any Mac app
  interval), a web visit counts only while a browser is in front: it refines browser time and
  never adds Mac time of its own. Where the Mac log has nothing (before its 4 week horizon), a
  visit stands by itself. Among history visits the page opened last wins. History gives a page's
  total time in front but not when a tab was switched back to, so a visit is placed right after
  it was opened: with history alone the split of browser time between sites is an estimate (the
  total is exact). The extension makes the split exact.
- **A visit's category** comes from the shared host list. If the host is not on it, the label the
  collector sent in `data.category` is used: `messaging` and `mail` read as `communication`, `dev`
  and `docs` as `work`, `finance` and `search` as `other`; the rest keep their name.
- **Phone over Mac:** when iPhone and Mac use overlap, the phone has the attention. The time is
  counted once, as phone time.
- Times are rounded to whole seconds, usage is clipped to the range, and anything that crosses
  local midnight is split by day.

Roles used by the focus rules: **work** = `work`, `ai`; **distractor** = `communication`, `social`,
`video`, `news`, `shopping`, `travel`; **neutral** = `music`, `system`, `other`. Inside a planned
goal block the goal has a say: see Goals, "Categories that count as a goal's work".

#### Definitions and minimum samples

- `phone_cadence`: A **session** is one stretch of phone use in which an app was opened (not Apple's "pickup": a glance at the lock screen leaves no record, so we see about two thirds of Apple's count): consecutive iPhone app intervals less than 30
  seconds apart (our estimate; Apple does not export pick ups). A **check** is a session under 30
  seconds. A **gap** runs from the end of one session to the start of the next; it is left out when
  it overlaps a recorded sleep or is longer than 3 hours (sleep or away). The first app skips the
  system (home screen). A session in which no app was opened (lock screen or home screen only) may
  be the phone waking for a notification, so it is counted apart and kept out of the rhythm. Opened: `notification` against `home_screen` or `app_switcher` (own hand);
  `other` or missing is unknown, and `notification_share` is null under 20 sessions with a known
  reason. Hour buckets use the session start (gaps: the gap start). **Speaks
  from:** 3 days of iPhone usage and 20 waking gaps. An hour needs 5 gaps, a day 5, the working
  window 20.
- `mac_app_cadence`: A **visit** is one time an app is brought to the front: consecutive intervals
  of the same app less than 30 seconds apart with nothing else in between. Intervals under 3 seconds
  are passing through and are dropped first. The gap between two visits is measured in **minutes of
  Mac use** (a closed lid adds nothing). `after_notification_share`: visits that start within 60
  seconds after a Mac notification from the same app. Returns the top 5 distracting apps and the top
  5 others. **Speaks from:** 3 days of Mac usage. An app needs 10 visits on 2 or more days; a median
  gap needs 5 gaps.
- `focus_disruptions`: **Without a calendar (inferred):** a focus stretch starts when a work app
  comes to the front and lasts while the user keeps coming back to work apps. It ends when they are
  away from work apps for more than 10 minutes, or when nothing is in front for more than 2 minutes
  (screen off, lid closed, away). It counts when it spans 15 minutes or more and work apps hold at
  least half of it. A trip away from work that touches a distractor is a disruption; a distractor
  that comes up within 60 seconds after the last work app, with no return inside 10 minutes, is the
  disruption that ended the stretch (`ended_stretch`, minutes capped at 10). **With a calendar:**
  inside each `calendar_event` that belongs to a goal (see below), every off purpose visit is a
  disruption. Off purpose is the same rule the score calls lost (Goals, "Categories that count as a
  goal's work"): distractors the goal does not list in `target.work_categories`, and work apps
  inside a block of a health or personal goal. A category the goal lists counts as time on purpose
  in a business block, and browsing in it is not drift there. Planned blocks
  own their time: stretches are inferred only outside them. Intervals under 3 seconds are ignored.
  The longest uninterrupted stretch is the longest work run with no disruption and no idle break in
  it. **Speaks from:** One focus stretch or one goal block with device data.
- `recovery_cost`: For each disruption inside a stretch or block: `minutes_until_back` runs from the
  moment the distractor came up until the work app that was left is in front again. The daily total
  is the union of those spans. **Speaks from:** 5 disruptions with a return. A day's own median
  needs 3.
- `repeat_offenders`: Disruptions grouped by app or site, across devices and days. **Speaks from:**
  An app or site that disrupted on 2 or more days.
- `drift`: Web visits in `travel`, `shopping`, `video`, `social` or `news` during a focus stretch or
  a planned work block. `search_event_id` is the last search in the 2 minutes before the visit. The
  search term is never copied into the report. **Speaks from:** Any web visits and one focus stretch
  or work block. Zero minutes is a valid answer.
- `late_screens`: Device use after the cut off, per night. Cut off: 23:00, or one hour before the
  usual bedtime (median start of recorded sleeps of 3 hours or more) when sleep data exists. A night
  runs 6 hours from the cut off and belongs to the day of its evening. A night is late from 5
  minutes of use. `next_recovery_pct` and `next_sleep_minutes` come from the following morning.
  **Speaks from:** 3 nights inside the range on days with device data. Usual bedtime: 3 sleeps.
  Recovery comparison: 3 late (30 minutes or more) and 3 other nights.
- `context_switching`: A **stay** is unbroken time in one app (same app less than 5 seconds apart;
  all sites count as the browser). A **switch** is a move to a different app with no idle break in
  between. A **fragment** is a stay under 2 minutes. **Speaks from:** 60 minutes of device time. A
  day's own rate needs 30.
- `time_by_app`: Seconds per app, site and category per local day, from the single line of
  attention, so the parts add up exactly to the active time. **Speaks from:** Any usage.
- `ai_tool_use`: `ai_session` events that start in the range. Session time counts each session in
  full; clock time counts sessions side by side once. Waiting is capped at the session's own length.
  **Speaks from:** One session. The waiting share needs sessions that report `waiting_seconds`.

Which goal a calendar block belongs to is decided by the one matcher described under Goals
("Which calendar events count towards a goal"): `data.goal_id`, then the goal's
`target.calendar_titles`, then the older fallbacks. Events with other people in them
(`data.attendees` above 0) are meetings and are never focus blocks. Only goals of kind `time` have
blocks: a sleep target, a count or a checklist never owns a calendar event.

Summaries follow the voice basics (numbers first, British spelling, 24 hour time, no dashes). They
name apps; a site is named only if its host is on the shared public list, otherwise it is "a
travel site" or "an uncategorised site". Structured `data` carries the host for the user's own view.

### Chat

| Method | Path                | Body                                  | Response                                                                                                                                                                                                                                                                   | Status |
| ------ | ------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/v1/chat?limit=50` |                                       | `200 { messages: ChatMessage[] }` (oldest first, limit 1..100)                                                                                                                                                                                                             | live   |
| POST   | `/v1/chat`          | `{ message: string }` (1..2000 chars) | `201 ChatResponse` `{ message, reply, actions: Recommendation[] }`; `503 unavailable` without `ANTHROPIC_API_KEY`; `502 upstream_error` if Claude fails                                                                                                                    | live   |
| POST   | `/v1/chat/stream`   | `{ message: string }` (1..2000 chars) | `200 text/event-stream`: `event: delta` `{ text }` per piece, `event: action` `Recommendation` per thing done or undone, then `event: done` `ChatResponse`, or `event: error` `ApiError`. Validation and `503 unavailable` come back as plain JSON before the stream opens | live   |

`/v1/chat` stays for callers that want the whole answer (MCP, voice); `/v1/chat/stream` gives the
first words fast and stores the same pair when it finishes.

The API keeps the history per user (`chat_messages`); the client sends only the new line. Michael
answers with Claude (`ANTHROPIC_MODEL`, default `claude-opus-5-5`) from a summary built in the API:
the week's score with the same figures as `GET /v1/score` (built in process by `scoreFor`, not over
HTTP: score, spent of elapsed, lost, ahead, time won back, and per goal spent of budget and what is
left; today's score and biggest losses inside goal blocks),
the active goals with weekly budgets, today's calendar, workout, sleep, meal and focus entries,
today's screen time totals, 7 day totals per type and the pattern headlines for today and the last
7 days, plus the last 20 lines of chat. Raw app, web and AI events are never sent, only totals, and
conversations and memories stay out. Nothing is stored when the call fails.

**Chat acts on the user's own time (#46).** Claude gets four tools, run server side inside the
request (no HTTP self calls): `find_calendar_blocks { from, to }` (ids and whether a block may be
moved), `create_focus_block { title, start_at, end_at, goal_id? }`, `move_calendar_block { event_id,
start_at, end_at?, new_title? }` and `undo_action { recommendation_id }`. Each action becomes a
recommendation with `source: "chat"` that is carried out at once by the same code as
`POST /v1/recommendations/:id/execute` (and `/undo`), so every guard rail holds: events with other
people and anything already started are refused (the model hears the 409 and advises instead;
the refused recommendation is stored as `dismissed`), Michael never deletes the user's events, and
undo works until the block starts. `ChatResponse.actions` lists what was done (`status: "done"`,
deadline in `action.undo_until`) or undone in this answer, and the reply always ends with
"Undo until HH:MM." for each thing done. The context gives Claude ids only for the user's own blocks
that have not started, goal ids, and the things that can still be undone.

### Moments (Morning and Evening)

| Method | Path                           | Response     | Status |
| ------ | ------------------------------ | ------------ | ------ |
| GET    | `/v1/moments/morning?at=<iso>` | `200 Moment` | live   |
| GET    | `/v1/moments/evening?at=<iso>` | `200 Moment` | live   |

`at` is optional (default now) and shows the moment as of another instant. `400` for another kind
or a bad `at`. Days, weeks (Monday first) and hours are Europe/Athens.

```ts
type MomentKind = "morning" | "evening";
type MomentGoal = {
  goal_id: string;
  title: string;
  category: GoalCategory;
  budget_minutes: number | null;
  spent_week_minutes: number; // Monday 00:00 until now
  planned_today_minutes: number; // goal blocks today; rest: a seventh of the weekly budget
  spent_today_minutes: number;
  lost_today_minutes: number; // interruptions inside this goal's blocks
  planned_ahead_minutes: number; // from now to the end of the week
  unplanned_minutes: number | null; // budget - spent - planned ahead; null without a budget and for rest
};
type MomentStretch = {
  start_at: string;
  end_at: string;
  title: string; // the block's calendar title, or "Unbooked time"
  goal_id: string | null;
  block_event_id: string | null;
  expected_lost_minutes: number;
  history_days: number;
  usual_trigger: string | null; // app name or site label
};
type MomentMove = {
  title: string; // "Book 60 minutes of deep work at 08:00"
  rationale: string; // the maths
  action_kind: ActionKind | null;
  start_at: string | null;
  end_at: string | null;
  goal_id: string | null;
};
type Moment = {
  kind: MomentKind;
  day: string; // YYYY-MM-DD
  timezone: string;
  generated_at: string;
  headline: string;
  phrased_by: "template" | "model";
  goals: MomentGoal[];
  totals: {
    planned_minutes: number; // goal blocks today, rest excluded
    spent_minutes: number;
    lost_minutes: number; // interruptions in focus time today
    baseline_lost_minutes: number | null; // daily average on the last 7 days with device data
    won_back_minutes: number; // evening: baseline - lost, at least 0; morning: 0
  };
  at_risk: MomentStretch | null; // morning only
  suggestions: MomentMove[]; // morning: at most 2; evening: []
  lesson: string | null; // evening only
  first_move: MomentMove | null; // evening only
};
```

How the numbers are made (`apps/api/src/moments/compute.ts`, pure, with tests):

- **Planned** is goal blocks (the same matching as Patterns: `data.goal_id`, `data.goal_category`,
  or a category word or "deep work"/"focus" in the title; meetings with any other attendee never count).
- **Spent**: the sleep goal (`isSleepGoal`) is sleep, counted on the day it ends; a health goal of
  kind `time` is workouts when the watch reported any; everything else is elapsed block time less
  the minutes lost inside it (the same rule as the score, so the two agree).
- **Lost** comes from the focus analysis behind `focus_disruptions`. **Won back** (evening) is the
  daily average lost on the last 7 days with device data less what was lost today.
- **At risk** (morning): for each block still ahead today, the minutes usually lost in those hours
  (per hour of day, averaged over the history days) scaled to the block; the largest wins. With no
  block, the costliest remaining hour between 08:00 and 21:00. Null without history.
- **Moves**: silence the usual trigger during the stretch at risk (a phone trigger becomes "phone in
  another room"), and book the goal with the most unplanned budget in the first free slot from 08:00
  to 21:00 (its length is the gap spread over the days left, 30 to 90 minutes in quarters).
  Evening: tomorrow's first goal block, or that booking for tomorrow.

Only `headline` may be phrased by Claude (`ANTHROPIC_MODEL`, when `ANTHROPIC_API_KEY` is set). The model sees the computed
facts only, and its line is used only if it keeps the voice rules and every number in it appears in
the facts; otherwise `phrased_by` is `template`. Lines are cached per user, kind, day and facts.

### Voice

| Method | Path              | Body                               | Response                                                                                                   | Status |
| ------ | ----------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/v1/voice`       |                                    | `200 { elevenlabs: boolean }`: whether the API can speak with ElevenLabs                                   | live   |
| POST   | `/v1/voice/speak` | `{ text: string }` (1..1000 chars) | `200 audio/mpeg`; `503 unavailable` without `ELEVENLABS_API_KEY`; `502 upstream_error` if ElevenLabs fails | live   |

Push to talk in the app: the browser turns speech into text (Web Speech API, en-GB), the text goes
to `POST /v1/chat`, and the reply is read aloud. `POST /v1/voice/speak` proxies ElevenLabs text to
speech (`ELEVENLABS_VOICE_ID`, default "George", a calm British male; `ELEVENLABS_MODEL`, default
`eleven_flash_v2_5`) so the key stays on the server. Without a key, or when it fails, the app uses
the browser's own speech synthesis, preferring a low en-GB male voice. Audio is never stored:
only text goes in, and the mp3 is streamed straight back and played once.

### Recommendations

| Method | Path                                  | Body                               | Response                                    | Status |
| ------ | ------------------------------------- | ---------------------------------- | ------------------------------------------- | ------ |
| GET    | `/v1/recommendations?status=proposed` |                                    | `200 { recommendations: Recommendation[] }` | live   |
| PATCH  | `/v1/recommendations/:id`             | `{ status: RecommendationStatus }` | `200 Recommendation`, `404`                 | live   |

Changing status never executes `action`; use the routes below.

| Method | Path                              | Response                                                                  | Status |
| ------ | --------------------------------- | ------------------------------------------------------------------------- | ------ |
| POST   | `/v1/recommendations/:id/execute` | `200 Recommendation` (`status: done`, `executed_at` set). `409` see below | live   |
| POST   | `/v1/recommendations/:id/undo`    | `200 Recommendation` (`status: undone`, `undone_at` set). `409` see below | live   |

Kinds carried out: `move_calendar_block` and `create_focus_block`; other kinds answer `501`.

```ts
// move_calendar_block: one of the user's own solo blocks (a timeline event id). A new start keeps
// the length unless end_at is given; new_title renames. At least one of the three.
type MoveCalendarBlockPayload = { event_id: string; start_at?: string; end_at?: string; new_title?: string };
// create_focus_block: a new block, tagged as Michael's (title defaults to "Focus block").
type CreateFocusBlockPayload = { start_at: string; end_at: string; title?: string };
```

Rules: act only on the user's own calendar blocks and Mac; never touch events with other people;
never delete the user's events; never send in the user's name.

- With Google Calendar connected the change happens in the calendar (a created block carries the
  private extended property `michael=1`) and the timeline mirror follows at once. Without it, the
  change happens on the timeline only (a created block is a `calendar_event` with `source: "agent"`).
- `409 conflict` when: the action is `null`; the recommendation is already `done` or `dismissed`;
  `involves_others` is true; the block has `data.with_others` or 2 or more attendees, or Google
  itself now shows someone else on it (checked live before every write); the block or the new
  time has already started; it is an all day event.
- Undo: a moved block goes back to its original time and title; a created block is deleted, and
  only if Google still marks it as Michael's. Allowed until the earliest of `undo_until`, the
  block's original start and its new start; afterwards `409`. Undo of anything not `done` is `409`.
- What was changed is kept on the recommendation (`execution`, internal, never returned).

### Integrations (OAuth)

| Method | Path                                       | Auth                        | Response                                                       | Status |
| ------ | ------------------------------------------ | --------------------------- | -------------------------------------------------------------- | ------ |
| GET    | `/v1/integrations`                         | Bearer                      | `200 { integrations: Integration[] }` (every provider, always) | live   |
| POST   | `/v1/integrations/google_calendar/connect` | Bearer                      | `200 { url }`: Google's consent screen; the browser goes there | live   |
| GET    | `/oauth/google/callback`                   | none (validated by `state`) | `302` to `${WEB_URL}/you?connected=google_calendar`            | live   |
| POST   | `/v1/integrations/google_calendar/sync`    | Bearer                      | `200 CalendarSyncResult`; `409` if not connected               | live   |
| DELETE | `/v1/integrations/google_calendar`         | Bearer                      | `200 Integration` (`disconnected`); revokes at Google          | live   |

`whoop` answers `501` until it is wired up. Tokens live in the `integrations` table and are never
returned by the API.

**Connect flow (one tap for the user).** The web app's `/integrations/google/connect` calls
`POST /v1/integrations/google_calendar/connect` with the user's token and redirects the browser to
`url`. That is Google's consent screen with `scope=openid email https://www.googleapis.com/auth/calendar.events`,
`access_type=offline`, `prompt=select_account consent` (the user picks which Google account, which
can differ from the one they signed in with) and `include_granted_scopes=true`. `state` is signed
with a key derived from `API_KEY`, names the user and expires after 15 minutes, so it stops CSRF and
binds the callback to the user who started it. Google returns to `${PUBLIC_API_URL}/oauth/google/callback`;
the API swaps the code for tokens, stores the refresh token and the account address (from the ID
token), runs the first sync and redirects to `/you?connected=google_calendar`. Failures redirect to
`/you?integration_error=google_calendar&reason=expired|declined|token`. Access tokens are refreshed
when they have under a minute left; a revoked grant sets `status: "error"`.

**Sync.** Pulls the primary calendar, now minus 7 days to now plus 7 days, recurring events expanded,
into `calendar_event` events with `source: "google_calendar"` and `external_id` = Google's event id.
Idempotent: unchanged events are left alone, changed ones (title, time) are updated in place, and
mirrored events that were deleted or cancelled in Google within the window are removed from the
timeline (the calendar itself is never touched). Cancelled and declined events are skipped. Runs
after connecting, on `POST .../sync`, and every `CALENDAR_SYNC_MINUTES` (default 15) for every
connected user. Off the record, or with the `google_calendar` source switched off, sync reads nothing
and answers zero counts.

```ts
type CalendarSyncResult = {
  from: string;
  to: string;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  last_sync_at: string;
};
// `data` of a google_calendar event
type CalendarEventData = {
  calendar: "primary";
  status: string;
  all_day: boolean; // all day events start and end at local midnight in the calendar's zone
  attendees: number; // people on the invite, the user included, rooms left out
  with_others: boolean; // anyone else invited, or someone else organised it: Michael never touches it
  organizer_self: boolean;
  michael: boolean; // a block Michael created
  transparency: string; // "transparent" = shows as free
  recurring: boolean;
  location: string | null;
  html_link: string | null;
  updated: string | null;
};
```

### Privacy

```ts
type SourceSetting = { source: Source; enabled: boolean; updated_at: string };
type PrivacyState = { off_the_record: boolean; since: string | null; sources: SourceSetting[] };
```

| Method | Path                          | Body                          | Response            | Status |
| ------ | ----------------------------- | ----------------------------- | ------------------- | ------ |
| GET    | `/v1/privacy`                 |                               | `200 PrivacyState`  | live   |
| PUT    | `/v1/privacy/off-the-record`  | `{ off_the_record: boolean }` | `200 PrivacyState`  | live   |
| PATCH  | `/v1/privacy/sources/:source` | `{ enabled: boolean }`        | `200 SourceSetting` | live   |

Sources are opt-in (disabled by default). Connecting a source is the opt-in: its first event
received records it as enabled. While off the record, or for a source the user switched off, ingest
drops events and counts them in `ignored` (every path: `/v1/events`, `/v1/events/batch`, webhooks,
MCP). `manual` events, typed by the user, are always kept. `since` is when collection stopped, or
`null`. Never set sources show `updated_at` as `1970-01-01T00:00:00.000Z`. The check lives in
`apps/api/src/privacy.ts` and runs inside `Store.insertEvents`.

### Your data: deletion and retention

```ts
type DataDeleteResult = {
  scope: "everything" | "timeline";
  deleted: Record<string, number>; // rows really deleted, per table
  total: number;
  google_revoked: boolean; // Google was told to forget Michael's calendar access
  account_deleted: boolean; // the Supabase Auth user is gone too ("everything" only)
};
type EventSummary = {
  day: string; // UTC day of the events' start, YYYY-MM-DD
  source: Source;
  type: EventType;
  category: string; // app or site category when the event had one, else ""
  events: number;
  seconds: number;
};
const RETENTION_DAYS = 90;
```

| Method | Path                            | Response               | Status |
| ------ | ------------------------------- | ---------------------- | ------ |
| DELETE | `/v1/me/data`                   | `200 DataDeleteResult` | live   |
| DELETE | `/v1/me/data?source=&from=&to=` | `200 DataDeleteResult` | live   |
| DELETE | `/v1/events/:id`                | `204`, `404`           | live   |

Deletion really deletes: rows are removed from the database, not hidden. `DELETE /v1/me/data` with
no parameters removes every row of the account: events, event summaries, goals, recommendations,
analysis runs, nudges, chat messages, standing instructions, the Telegram chat, integrations (Google is revoked first), push subscriptions,
device keys, agents with their query log, OAuth grants and tokens, places, the geocode cache, source
switches, the off the record state and the profile. Then the Supabase Auth user itself is deleted,
so the next sign in starts a new, empty account. With any of `source`, `from`, `to` (ISO date times,
`from` < `to`) only the matching timeline events (`start_at` in `[from, to)`) and the summaries of
the days they cover are removed (`scope: "timeline"`).

Only a signed-in session may call it: device keys, agents and the demo API key get `403 forbidden`,
and so does the demo account (reseed it with `POST /v1/demo/reseed`). The table list is
`USER_TABLES` in `apps/api/src/supabase-store.ts`; a test fails when a migration adds a table that
the list misses.

Retention: once a day (`apps/api/src/retention.ts`, run by the scheduler) events that started
before the UTC day 90 days ago are rolled into `event_summaries` (one row per UTC day, source, type
and category; counts and seconds, no titles, no data) and the raw rows are deleted, in batches of
500. Seconds are `end_at - start_at`, else `data.seconds`, else 0. Category is `data.category`, else
the app category of `data.bundle_id`, else the site category of `data.host`, else `""`.

### Device keys (personal tokens)

```ts
type PersonalToken = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};
type PersonalTokenCreated = { token: PersonalToken; secret: string /* "mk_...", shown once */ };
```

| Method | Path             | Body       | Response                                             | Status |
| ------ | ---------------- | ---------- | ---------------------------------------------------- | ------ |
| GET    | `/v1/tokens`     |            | `200 { tokens: PersonalToken[] }` (never the secret) | live   |
| POST   | `/v1/tokens`     | `{ name }` | `201 PersonalTokenCreated`                           | live   |
| DELETE | `/v1/tokens/:id` |            | `204` (stops working within 30 s), `404`             | live   |

Only a signed-in session (Supabase token) may call these: device keys, OAuth tokens and the demo
API key get `403 forbidden`. A device key acts for its owner on ingest, webhooks and `/mcp`
(`Authorization: Bearer mk_...` or `?key=mk_...` where query keys are allowed). One key per device
(Mac collector, Health Auto Export). Only the sha256 is stored. The web app makes them under
You > Devices. Claude connects with MCP OAuth instead (no key).

### Profile

The onboarding answers: quiet hours, the usual week and the user's weak spots. Goals themselves go
through `/v1/goals`.

```ts
type ClockTime = string; // "HH:MM", 24 hour, Europe/Athens wall clock
type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type WeakSpot =
  | "phone_in_bed"
  | "late_nights"
  | "context_switching"
  | "skipped_lunch"
  | "doomscrolling"
  | "back_to_back_meetings"
  | "inbox_all_day"
  | "late_caffeine";
type TimeWindow = { start: ClockTime; end: ClockTime }; // may cross midnight
type Profile = {
  quiet_hours: TimeWindow; // no nudges inside; default 22:00 to 07:00
  work_hours: TimeWindow; // default 09:00 to 18:00
  work_days: Weekday[]; // default mon to fri
  gym_days: Weekday[]; // default []
  weak_spots: WeakSpot[]; // default []
  onboarded_at: string | null; // set when onboarding is finished or skipped
  updated_at: string | null; // null until first saved
};
type ProfileUpdate = Partial<Omit<Profile, "updated_at">>; // arrays are replaced, not merged
```

| Method | Path          | Body            | Response                       | Status |
| ------ | ------------- | --------------- | ------------------------------ | ------ |
| GET    | `/v1/profile` |                 | `200 Profile` (defaults first) | live   |
| PUT    | `/v1/profile` | `ProfileUpdate` | `200 Profile`                  | live   |

The web app sends a new user (no goals and `onboarded_at: null`) from Today to `/onboarding`.
Stored as one jsonb document per user (`user_profiles`); a missing or invalid field reads as its
default.

### Places and travel

Time in traffic is time lost. The API learns drive times between the user's places with Google
Maps (one server side key, `GOOGLE_MAPS_API_KEY`; the user never sees a key) and proposes leaving
later, or moving the user's own block past the rush.

```ts
type Place = {
  key: string; // slug: "home" | "work" | "gym" | "university" | ...
  label: string; // "Home", or what the user called it
  address: string | null;
  lat: number | null; // null until geocoded
  lng: number | null;
  updated_at: string;
};
type PlaceInput = {
  key: string;
  label?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
};
// address, or both lat and lng
type PlacesResponse = { places: Place[]; maps_available: boolean; travel_enabled: boolean };

type TravelOption = { depart_at: string; arrive_at: string; minutes: number };
// `data` of an event { source: "maps", type: "travel" }; the event spans the planned drive.
type TravelData = {
  calendar_event_id: string;
  from: { label: string; place_key: string | null };
  to: { label: string; place_key: string | null };
  mode: "drive";
  minutes: number; // the planned drive
  free_flow_minutes: number; // empty roads; minutes minus this is traffic
  distance_km: number;
  naive_depart_at: string; // leaving as soon as the user is free
  naive_minutes: number;
  won_minutes: number; // naive_minutes minus minutes
  options: TravelOption[]; // every departure sampled
};
type TravelPlanResult = {
  status: "ok" | "maps_unavailable" | "travel_off";
  from: string;
  to: string;
  travel: Event[]; // newly stored travel events
  recommendations: Recommendation[]; // newly proposed
  skipped: { calendar_event_id: string; reason: string }[];
};
```

| Method | Path              | Body                                | Response               | Status |
| ------ | ----------------- | ----------------------------------- | ---------------------- | ------ |
| GET    | `/v1/places`      |                                     | `200 PlacesResponse`   | live   |
| PUT    | `/v1/places`      | `{ places: PlaceInput[] }` (max 20) | `200 PlacesResponse`   | live   |
| POST   | `/v1/travel/plan` | optional `{ from?, to? }` (ISO)     | `200 TravelPlanResult` | live   |

- `PUT /v1/places` replaces the whole list. Addresses are geocoded on save when the server has a
  key (cached per user for 30 days, as Google's terms allow); otherwise coordinates stay `null`.
  The first save switches source `maps` on: that is the user's opt in. The privacy switch
  (`PATCH /v1/privacy/sources/maps`) turns it off again, and off the record stops it too.
- `POST /v1/travel/plan` defaults to today (Europe/Athens). For each calendar event with a
  physical location (Meet, Zoom and links are skipped) it finds the place before it: the previous
  event that day with a location, else `home`. A location matches a saved place by label or key
  word ("Local gym" is `gym`), else it is geocoded. It samples departures from when the user is
  free, every 15 minutes (at most 6 Routes calls), stores the fastest drive that still arrives 5
  minutes early as a travel event (idempotent per calendar event), and proposes:
  - **leave later** when it saves 10 minutes or more: `reminder` action at the new departure
    (`"Leave at 18:00 instead of 17:00, win 30 minutes"`);
  - otherwise, for the user's own block (no attendees) stuck in 15 minutes or more of traffic,
    **move the block** after the rush when it saves 15 minutes or more and fits before the next
    event: `move_calendar_block` with `{ event_id, start_at, end_at, from_start_at }` (`MoveCalendarBlockPayload`),
    `undo_until` = the original start. Meetings with other people are never moved.
    Recommendations carry the goal the block serves (`apps/api/src/score/match.ts`).
- Without `GOOGLE_MAPS_API_KEY` the status is `maps_unavailable` and nothing is computed; without
  the opt in it is `travel_off`. Code: `apps/api/src/integrations/maps.ts` (Geocoding, Routes
  `computeRoutes` with `TRAFFIC_AWARE` and `departureTime`) and `integrations/travel.ts`.

### Michael for agents

```ts
type AgentClient = {
  id: string;
  name: string;
  status: AgentStatus;
  scopes: AgentScope[];
  created_at: string;
  last_seen_at: string | null;
};
type AgentQuery = {
  id: string;
  agent_id: string;
  tool: string;
  summary: string;
  allowed: boolean;
  created_at: string;
};
```

| Method | Path                           | Body                                                    | Response                                                     | Status |
| ------ | ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| GET    | `/v1/agents`                   |                                                         | `200 { agents: AgentClient[] }`, newest first                | live   |
| PATCH  | `/v1/agents/:id`               | `{ status?, scopes? }` (approve, revoke, change scopes) | `200 AgentClient`, `404`                                     | live   |
| GET    | `/v1/agents/queries?from=&to=` |                                                         | `200 { queries: AgentQuery[] }` ("who asked about me today") | live   |

- An agent is an MCP client the user connected with OAuth (see "MCP authorization"). Tapping
  Allow on the consent page is the one tap approval: it creates the agent as `approved` with the
  scopes it asked for, or updates the user's agent of the same name (reconnecting Claude keeps one
  record). The API key is our own tooling, not an agent: it is neither checked nor logged.
- Scopes are read live from the agent on every MCP request, so a `PATCH` applies at once.
  `status: "revoked"` also revokes the agent's tokens (`401` from then on; reconnect to use it again).
- Every MCP tool call by an agent is logged as an `AgentQuery`, allowed or not. `summary` is one
  plain line ("Read your day from Sat 09:00 to Sat 17:00", `Added "Ran 5 km" to your day`), never
  the payload. A call outside the agent's scopes, or by an agent that is not `approved`, returns a
  tool result with `isError: true` ("Not allowed. ...") and is logged with `allowed: false`.
- Scope per tool: `get_timeline`, `get_patterns` = `timeline`; `get_goals`, `add_goal`,
  `update_goal` = `goals`; `list_recommendations`, `update_recommendation`, `get_nudges` =
  `recommendations`; `get_score`, `get_moments` = `score`; `add_event`, `execute_recommendation`,
  `undo_recommendation`, `create_focus_block`, `plan_travel` = `write_events`. A tool not in that
  list needs `timeline` if it is read only, else `write_events` (`apps/api/src/mcp-guard.ts`).
- `queries`: `from` defaults to local midnight today (Europe/Athens), `to` to now; newest first,
  at most 500.

### Nudges

```ts
type Nudge = {
  id: string;
  recommendation_id: string | null;
  goal_id: string | null; // the goal it serves
  kind: NudgeKind;
  key: string; // dedupe key: never twice on one local day
  day: string; // local day, "YYYY-MM-DD"
  channel: NudgeChannel;
  text: string; // under 15 words
  reason: string; // the maths, e.g. "70.3 training: 1h of 10h done; the pace by now is 3h 34m."
  status: NudgeStatus;
  created_at: string;
  sent_at: string | null;
};
type NudgeCheckResult = {
  checked_at: string;
  nudge: Nudge | null; // created by this check (queued, sent, failed or suppressed)
  skipped: NudgeSkip | null; // why nothing went out
  sent_today: number; // nudges today that count towards the cap (all but suppressed and test)
};
```

| Method | Path                   | Response                                                                | Status |
| ------ | ---------------------- | ----------------------------------------------------------------------- | ------ |
| GET    | `/v1/nudges?from=&to=` | `200 { nudges: Nudge[] }` (default: today, Europe/Athens, oldest first) | live   |
| POST   | `/v1/nudges/check`     | `200 NudgeCheckResult` (runs the engine once, no body)                  | live   |
| POST   | `/v1/nudges/test`      | `200 NudgeTestResult` (push one nudge to the caller's devices now)      | live   |

Nudge engine (`apps/api/src/nudges/engine.ts`, pure, thresholds in `LIMITS`). Each check picks the
most urgent candidate of these rules (in this order):

| Kind          | When                                                                                                                         | Example                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `focus_drift` | inside a work goal block, 3+ of the last 10 min on distractor apps or sites                                                  | "6 min on Instagram in your focus block. Back to it until 12:00."     |
| `block_soon`  | a goal block starts in 2 to 15 min                                                                                           | "Gym at 18:00. Wrap up in 12 min."                                    |
| `morning`     | after the night's sleep (3h+) ends today, else from 08:00; until 12:00                                                       | the Morning moment's headline, e.g. "Today holds 2h 00 of goal time." |
| `evening`     | an hour before the usual bedtime (median of 3+ of the last 8 nights), else 21:00; never later than 45 min before quiet hours | the Evening moment's headline                                         |
| `wind_down`   | 30 min before the night, 3+ of the last 10 min on screens, a rest goal exists                                                | "Screens off by 22:00. Sleep is on the plan."                         |
| `goal_behind` | before 19:00, a weekly budget behind its linear pace by 60+ min and 15%+                                                     | "Gym 2h 34m behind this week. Book 90 min today."                     |

`morning` and `evening` carry the Morning and Evening moments (`GET /v1/moments/:kind`, template
headline, no model): the headline when it is under 15 words, else its first sentence, else a shorter
line from the same numbers; `reason` holds the maths and when it was sent. Their key is the kind, so
each goes out at most once a day, and they count toward the 5. The push opens Today (`url: "/"`).
The night's quiet hours come from the profile (`quiet_hours`, default 22:00 to 07:00).

Goal time spent this week = the goal's calendar blocks so far plus its own events (`work`:
`focus_session`, `gym`: `workout`, `rest`: `sleep`, `food`: `meal`), counted once. Rules: at most 5
per day; none in quiet hours (22:00 to 07:00, dinner 20:00 to 21:00, work goal blocks except
`focus_drift`); one key once per local day (`goal_behind` once per day in all); at least 20 min
between nudges. Once 5 went out, the best candidate is stored as `suppressed` (once per key). Off
the record stops all nudges. Delivery is pluggable (`apps/api/src/nudges/channels.ts`): with VAPID
keys set, nudges go out as Web Push to every device the user turned nudges on for (`sent` when one
accepted, `failed` when all refused, `queued` when there is no device). With `TELEGRAM_BOT_TOKEN`
set they also go to the user's Telegram chat, when one is connected (see "Telegram" below). With
both, every nudge goes to both (`sent` when either took it); the stored `channel` is `push`. Without
either they are only logged and stay `queued`. Channels only deliver: the cap, quiet hours and
dedupe are the engine's.

Scheduler (`apps/api/src/scheduler.ts`): inside the API process, every `SCHEDULER_INTERVAL_MINUTES`
(default 5) the check runs once for each user with events received in the last 24 hours, each run
scoped as that user. On by default when `NODE_ENV=production`, `SCHEDULER_ENABLED` overrides.

`POST /v1/nudges/test` sends the best current candidate (or a sample line) to the caller's devices
and Telegram chat (counted as one device in `devices` and `delivered`) at once, ignoring the cap, quiet hours and dedupe. It is for the stage moment: it stores the nudge
with status `test` (a fresh key each press), so `GET /v1/nudges` and the stage view (`/stage`) show
the same line as the watch buzzes. `test` nudges never count towards the 5 a day, the 20 minute gap
or the daily dedupe (`countsTowardsCap` in `@michael/shared`).

```ts
type NudgeTestResult = { text: string; reason: string; delivered: number; devices: number; nudge: Nudge };
type PushSubscriptionInput = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};
type PushConfig = { enabled: boolean; public_key: string | null; devices: number };
```

### Web push

iOS 16.4+ delivers Web Push to Michael installed on the Home Screen, and mirrors it to the Apple
Watch. The app's service worker is `apps/web/public/sw.js`.

| Method | Path                     | Body                                 | Response                                | Status |
| ------ | ------------------------ | ------------------------------------ | --------------------------------------- | ------ |
| GET    | `/v1/push`               |                                      | `200 PushConfig`                        | live   |
| POST   | `/v1/push/subscriptions` | `PushSubscriptionInput` (`toJSON()`) | `201 PushConfig` (saved for the caller) | live   |
| DELETE | `/v1/push/subscriptions` | `{ endpoint }`                       | `200 PushConfig`                        | live   |

### Telegram

A backup channel for nudges (`apps/api/src/nudges/telegram.ts`). Telegram mirrors its
notifications to the Apple Watch, so a nudge still buzzes when Web Push does not. Setup for the
team: `docs/sources/telegram.md`.

| Method | Path                    | Body                | Response                                                                | Status |
| ------ | ----------------------- | ------------------- | ----------------------------------------------------------------------- | ------ |
| GET    | `/v1/telegram`          |                     | `200 TelegramStatus`                                                    | live   |
| POST   | `/v1/telegram/link`     |                     | `200 { url }` (`https://t.me/<bot>?start=<token>`); `503` without a bot | live   |
| DELETE | `/v1/telegram`          |                     | `200 TelegramStatus` (unbinds the caller's chat)                        | live   |
| POST   | `/v1/webhooks/telegram` | a Telegram `Update` | `200`, with the bot's reply as a `sendMessage` method body              | live   |

```ts
type TelegramStatus = {
  enabled: boolean; // false until the API has TELEGRAM_BOT_TOKEN
  connected: boolean;
  username: string | null; // the chat's Telegram @username
  connected_at: string | null;
};
type TelegramLinkResponse = { url: string };
```

- One tap: "Connect Telegram" on You opens the link (web route `/integrations/telegram/connect`),
  Telegram opens the bot, the user taps Start, and the bot gets `/start <token>`. The token holds
  the user id, a 15 minute expiry and an HMAC (key derived from `API_KEY`), 61 characters to fit
  t.me's 64. Each token binds once. The bot answers "Connected. I'll keep it short."
- The webhook needs no user auth; it checks `X-Telegram-Bot-Api-Secret-Token` against
  `TELEGRAM_WEBHOOK_SECRET` (default: derived from the bot token) and answers `401` otherwise,
  `404` when there is no bot. Only private chats. `/stop` unbinds the chat. A chat belongs to
  whoever bound it last (`telegram_chats`, one row per user).
- Delivery: `sendMessage` with the nudge text. `sent` when Telegram took it, `failed` when it
  refused; a `403` (the user blocked the bot) also unbinds the chat.
- On start, with a token, the API calls `setWebhook` to `${PUBLIC_API_URL}/v1/webhooks/telegram`
  (https only; a repeat is a no-op). The bot username comes from `TELEGRAM_BOT_USERNAME`, else
  from `getMe`.

### Score

| Method | Path                                  | Response    | Status |
| ------ | ------------------------------------- | ----------- | ------ |
| GET    | `/v1/score?date=YYYY-MM-DD&now=<iso>` | `200 Score` | live   |

The headline number: the share of planned goal time that was spent on the goals, with "time won
back" beneath it. One call returns the week that holds `date` (Monday to Sunday, Europe/Athens,
days cut at local midnight, correct across the clock change) and that day in detail, which is what
the Today screen draws.

- `date` optional, a local day; default is today in Athens. `week` is accepted as its old name.
- `now` optional, an instant: score the day as it stood then (replaying a past day at 15:20).
  Default is the current time. `400` on a date that is not a real day or a bad instant.
- Computed on request by pure functions in `apps/api/src/score` (plain rules, no model) from the
  calendar, `workout` events and the single line of attention the patterns build
  (`patterns/timeline.ts`, see "One timeline first"). The same events always give the same score.

```ts
type ScoreTotals = {
  planned_minutes: number; // the user's own calendar blocks that belong to a goal
  elapsed_minutes: number; // the part of planned that has passed (a block in progress counts up to now)
  spent_minutes: number; // elapsed - lost
  lost_minutes: number; // time in distracting apps and sites inside elapsed blocks
  ahead_minutes: number; // planned - elapsed
  unverified_minutes: number; // the part of spent the data does not positively show
  score_pct: number | null; // round(spent / elapsed * 100); null when nothing has elapsed
};

type Score = ScoreTotals & {
  // the week: the WeeklyScore fields, except that score_pct may be null
  week_start: string; // Monday 00:00 in Athens, as an instant
  time_won_back_minutes: number; // the sum of the days
  goals: ScoreGoal[];
  timezone: string; // "Europe/Athens"
  generated_at: string; // the instant it was scored at
  date: string; // the local day asked for
  areas: ScoreArea[]; // the week per category; they add up to the week
  days: ScoreDay[]; // Monday to Sunday
  day: ScoreDayDetail; // `date` in detail
  // The last instant each device reported anything. Lost time after it is not known yet (phone
  // data can arrive hours late), so a fresh score can still drop.
  data_until: { mac: string | null; iphone: string | null };
};

// One of the three categories. Always three entries, in the order business, health, personal.
type ScoreArea = ScoreTotals & {
  area: GoalArea;
  goal_ids: string[]; // every active goal in the category, scored or not
};

type ScoreGoal = ScoreTotals & {
  goal_id: string;
  title: string;
  category: GoalCategory;
  area: GoalArea; // goalArea(category)
  kind: GoalKind; // goalKind(goal)
  scored: boolean; // true only for kind "time"; a target (sleep), count or checklist is listed, outside the score
  budget_minutes: number; // weekly_budget_minutes, 0 when the goal has none
  daily: { date: string; planned_minutes: number; spent_minutes: number }[]; // Monday to Sunday
};

type ScoreDay = ScoreTotals & { date: string; time_won_back_minutes: number };

type ScoreDayDetail = ScoreDay & {
  now: string; // the boundary between past and ahead on the tape
  time_won_back: {
    minutes: number;
    usual_loss_rate: number | null; // 0..1; null without enough history
    history_days: number; // days with goal blocks among the previous 28
    reason: string | null; // why the value is 0 when there is not enough history
  };
  blocks: ScoreBlock[]; // in order of start
  areas: ScoreArea[]; // the day per category; they add up to the day
};

type ScoreBlock = ScoreTotals & {
  event_id: string; // the calendar event; a block that crosses midnight appears on both days
  goal_id: string;
  goal_title: string;
  title: string; // the calendar event's own title
  matched_by: "goal_id" | "calendar_titles" | "goal_category" | "goal_title" | "category_word";
  start_at: string;
  end_at: string;
  ticks: ("spent" | "lost" | "ahead" | "unverified")[]; // one per 5 minutes, from start_at
  lost: {
    start_at: string;
    end_at: string;
    minutes: number; // one decimal
    what: string; // an app name, a well known public site, or "a travel site": never an address
    kind: "app" | "site";
    category: AppCategory;
    device: "mac" | "iphone";
  }[];
  // Ids of the active standing instructions the block's time falls under (a block planned on a
  // clear Sunday). Empty when it breaks none. It never changes the block's minutes.
  instructions_broken: string[];
};
```

The zod schemas of the same names are in `packages/shared/src/schemas.ts`; `mockScore` in
`mocks.ts` is a full example (a made up Wednesday at 15:20). `WeeklyScore` and `GoalScore` stay
exported: they are the week's part of `Score` with a `score_pct` that is never null.

#### The attribution rule

Stated here and at the top of `apps/api/src/score/score.ts`; the two change together.

- **Goals:** three categories, business, health and personal (the older `work` reads as business,
  `gym`, `rest` and `food` as health). Only goals of kind `time` take part. A `target` (sleep), a
  `count` or a `checklist` has no planned minutes: it is listed with `scored: false` and has no
  blocks.
- **Planned:** the user's own calendar blocks that belong to a goal (see Goals, "Which calendar
  events count towards a goal"). An event with other people in it is never a block. Where two
  blocks overlap, the earlier one keeps the time. A block that crosses local midnight is cut
  there, and each day gets its part.
- **Ahead:** planned time that has not started yet. **Elapsed:** planned time that has passed; a
  block in progress counts up to `now`.
- **Lost:** time inside an elapsed block that was off purpose for the block's goal, on any device
  (Goals, "Categories that count as a goal's work"; one function, which the patterns read too):
  - a distracting category (`communication`, `social`, `video`, `news`, `shopping`, `travel`),
    unless the goal lists it in `target.work_categories`;
  - a work category (`work`, `ai`) inside a block of a health or personal goal that does not list
    it. A sales call during the gym session is not training.

  It is read from the single line of attention, where the phone and the Mac are already one line,
  so a minute is never lost twice.

- **Spent:** elapsed minus lost.
- **Verified:** the part of spent for which the data positively shows the goal. Any goal: attention
  in a category it lists in `target.work_categories`. A business goal: attention in a work category
  (`work`, `ai`) inside the block. A health goal: a `workout` event overlapping the block, minus
  the lost time inside it. Nothing else can prove a goal.
- **Unverified:** spent minus verified: no device data there, or only neutral apps (music, the
  system, anything uncategorised). Reported apart as `unverified_minutes` and as `unverified`
  ticks; never present it as proven.
- **A block with no data at all and no workout counts as spent, all of it unverified.** Time in
  the gym or studying on paper leaves no trace on a screen, and a coach who calls a real session
  "missed" loses trust. The price: a skipped session also scores as spent until a watch or a check
  in says otherwise. `unverified_minutes` shows how much of the score rests on that.
- **Sleep is outside the score.** It is a goal of kind `target` (an older goal of category `rest`
  with a `sleep` or `bed` key in its target, or the word in its title, reads as one). It is listed
  in `goals` with its budget and `scored: false`. It has no blocks and takes no part in any total;
  its minutes are 0 and mean nothing. The same holds for every `target`, `count` and `checklist`
  goal.
- **Areas:** `areas` (the week) and `day.areas` (the day) hold the same totals for each of the three
  categories, always in the order business, health, personal, with the ids of every active goal in
  the category. They add up to the week and to the day. A category with nothing elapsed has
  `score_pct: null`, so a strong business week with no personal time does not read as a win.
- **Standing instructions never change a minute of the score.** Each block only carries
  `instructions_broken`: the active instructions its time falls under (see Standing instructions).
- **`score_pct`** = spent / elapsed, rounded. `null` when nothing has elapsed (before the first
  block, or on a day with no plan): not 0 and not 100.
- **Time won back**, in one sentence: less time lost inside your planned blocks than on your usual
  day. The usual loss rate is lost / elapsed over the goal blocks of the previous 28 days. It needs
  3 of those days to have goal blocks; with fewer the value is 0 and `reason` says so. Won back on
  a day = `max(0, usual rate x the day's elapsed - the day's lost)`. The week is the sum of its
  days. It only rises while the person is beating their usual self.
- **Minutes** are whole minutes, rounded per block (a block's part of one day) and added up from
  there. So every total is the sum of the parts beneath it: the day is the sum of its blocks, the
  week the sum of its days and of its goals, and `spent + lost = elapsed`,
  `elapsed + ahead = planned` hold everywhere.
- **Ticks:** one per 5 minutes of a block, from its start (the last is shorter when the block is
  not a multiple of 5). `ahead` when the tick starts at or after `now`; `lost` when at least half
  of it was lost; otherwise `spent` when at least as much of the rest is verified as not, else
  `unverified`. Ticks are the drawing: totals come from the exact intervals, not from counting
  ticks.
- **Lost stretches:** off purpose intervals less than 30 seconds apart are one stretch, named after
  whatever held most of it. An app goes by its name; a site by its host only when the host is on
  the shared public list, otherwise by its category ("a travel site"). `minutes` is the time lost
  inside the stretch.

### Demo account

| Method | Path              | Response             | Status |
| ------ | ----------------- | -------------------- | ------ |
| POST   | `/v1/demo/reseed` | `200 DemoSeedResult` | live   |

```ts
type DemoSeedResult = {
  days: string[]; // Athens dates covered, oldest first; the last is today
  events: { inserted: number; removed: number; kept: number };
  goals_written: number;
};
```

The demo account (`API_KEY`) carries a generated week (`apps/api/src/demo`): the seven Athens days
ending now, plus its calendar planned to Sunday. The Mac, iPhone, Chrome and Claude Code lanes
replay Manolis' anonymised real days (`apps/web/lib/sample/real`); Apple Watch, Google Calendar,
Omi conversations and meals are generated around them. Every generated event has an `external_id`
starting `demo:`; only those rows are ever added or removed, so nothing else in the account is
touched; days that leave the window are removed. The API refreshes the week on demo requests at
most every 5 minutes (the first refresh after a deploy resets the goals to the Build Hub plan,
later ones keep edits; `DEMO_WEEK=off` turns it off). `POST /v1/demo/reseed` also resets the goals.
Any other account gets `403 forbidden`. Off the record, nothing changes. Per source switches are
not applied: on the demo account they keep real collectors out (#114). From a terminal:
`pnpm --filter @michael/api seed:demo` (or `--dry` to print the week without a database).

Generated events use exactly the titles and `data` of the real ingest paths (Health Auto Export
sleep, workouts and hourly `heart_rate`, `step_count`, `heart_rate_variability`,
`resting_heart_rate`; Omi conversations; the collector's lanes); a test compares them with the
webhook mappers. Calendar events carry `attendees` (the number of other people, 0 for the user's
own blocks), `calendar`, `location?`, `status`, `all_day`. Meals are `manual` `meal` events with
`estimated_kcal`, `protein_g`; typed notes are `manual` `note` events with `category`.

## MCP server

Streamable HTTP at `POST /mcp` (stateless, JSON responses). Auth: `Authorization: Bearer <token>`,
where the token is an OAuth access token (below) or `API_KEY` (`?key=<API_KEY>` also works).
A request without valid credentials gets `401` with
`WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp"`.

### MCP authorization (claude.ai connector)

Follows the MCP authorization spec (2025-11-25). The user pastes `<base>/mcp` into claude.ai and
taps Allow; no keys. `<base>` is the API's public URL as the client reached it.

| Method | Path                                        | What                                                                                         |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/.well-known/oauth-protected-resource/mcp` | RFC 9728: `resource` = `<base>/mcp`, `authorization_servers` = `[<base>]` (also at the root) |
| GET    | `/.well-known/oauth-authorization-server`   | RFC 8414 metadata: S256 PKCE, public clients (`none`), code and refresh grants               |
| POST   | `/oauth/register`                           | RFC 7591 dynamic client registration. Redirect URIs must be https or loopback                |
| GET    | `/oauth/authorize`                          | Checks the request, then redirects to the web consent page `<web>/connect?request=<id>`      |
| POST   | `/oauth/token`                              | Form encoded. `authorization_code` (PKCE) or `refresh_token` (rotated on every use)          |

Scopes are the `AgentScope` values; no `scope` asked means all of them. Access tokens last 24
hours, refresh tokens 90 days; both are stored hashed. Loopback redirects match on any port
(Claude Code). OAuth errors use the OAuth shape `{ error, error_description }`, not ours.

The consent page (signed in user, normal auth) uses:

| Method | Path                       | Body                 | Response                                                 |
| ------ | -------------------------- | -------------------- | -------------------------------------------------------- |
| GET    | `/v1/connect/requests/:id` |                      | `200 ConnectRequest`, `404` when expired or answered     |
| POST   | `/v1/connect/requests/:id` | `{ allow: boolean }` | `200 { redirect_to }` (back to the client), `404`, `409` |

```ts
type ConnectRequest = {
  id: string;
  client_name: string; // from registration, e.g. "Claude"
  redirect_host: string; // shown to the user, e.g. "claude.ai"
  scopes: AgentScope[];
  expires_at: string;
};
```

On allow, `redirect_to` carries a one time `code` (5 minutes), `state` and `iss`; on refusal,
`error=access_denied`. The token then acts for the user who allowed it.

### Tools

Every tool answers with short, human readable text first (24 hour Europe/Athens time, the numbers
that matter and the ids for the next call) and the same facts as `structuredContent`. Times the
model writes (`TimeInput`) are `YYYY-MM-DDTHH:MM` in Europe/Athens wall time, or ISO 8601 with an
offset. A refused or failed call returns `isError: true` with one plain sentence saying why
(`HttpError` messages, validation issues listed). Scope per tool: see "Michael for agents".

| Tool                     | Scope             | Input                                                                                   | `structuredContent`                                       |
| ------------------------ | ----------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `get_timeline`           | `timeline`        | `{ date?: LocalDay, from?: TimeInput, to?: TimeInput, source?, type? }` (default: 24 h) | `{ from, to, count, truncated, events: Event[] }` (≤ 500) |
| `get_goals`              | `goals`           | `{ active_only?: boolean }` (default true)                                              | `{ goals: Goal[] }`                                       |
| `get_instructions`       | `goals`           | `{ active_only?: boolean }` (default true)                                              | `{ instructions: Instruction[] }` (standing instructions) |
| `get_score`              | `score`           | `{ date?: LocalDay }` (default today)                                                   | `Score` without `day.blocks[].ticks`                      |
| `get_patterns`           | `timeline`        | `{ from?: TimeInput, to?: TimeInput }` (default: the last 7 days)                       | `PatternReport`                                           |
| `list_recommendations`   | `recommendations` | `{ status?: RecommendationStatus }`                                                     | `{ recommendations: Recommendation[] }`                   |
| `get_nudges`             | `recommendations` | `{ date?: LocalDay }` (default today)                                                   | `{ day, nudges: Nudge[] }`                                |
| `get_moments`            | `score`           | `{ kind?: MomentKind }` (default morning before 15:00 local, evening after)             | `Moment`                                                  |
| `add_event`              | `write_events`    | `EventInput`                                                                            | `{ inserted, duplicates, ignored, events: Event[] }`      |
| `add_goal`               | `goals`           | `{ category, title, description?, weekly_budget_minutes?, target? }`                    | `{ goal: Goal }`                                          |
| `update_goal`            | `goals`           | `{ id, category?, title?, description?, weekly_budget_minutes?, target?, active? }`     | `{ goal: Goal }`, error when not found                    |
| `update_recommendation`  | `recommendations` | `{ id, status: "accepted" \| "dismissed" }`                                             | `{ recommendation }`; a `done` one is refused (undo it)   |
| `execute_recommendation` | `write_events`    | `{ id }`                                                                                | `{ recommendation, undo_until }`                          |
| `undo_recommendation`    | `write_events`    | `{ id }`                                                                                | `{ recommendation }`                                      |
| `create_focus_block`     | `write_events`    | `{ start: TimeInput, end: TimeInput, title?, goal_id? }`                                | `{ recommendation, undo_until }`                          |
| `plan_travel`            | `write_events`    | `{ from?, to? }` (default today)                                                        | `TravelPlanResult` (see Places and travel)                |

- `execute_recommendation` / `undo_recommendation` call the same functions as
  `POST /v1/recommendations/:id/execute` and `/undo` (`apps/api/src/actions/calendar.ts`), with the
  same rules: own time only, never an event with other people, never deletes the user's events,
  undo until the block starts.
- `create_focus_block` books straight away: it saves a recommendation (`source: "chat"`, `status: "done"`, rationale
  "Booked at your request through <agent name>") and carries it out like any other, so the block
  shows in Michael and `undo_recommendation` takes it back. Refused in the past, under 5 minutes,
  over 6 hours, or when it overlaps an event with other people.
- No tool deletes anything, sends anything in the user's name, or touches an event with other
  people. Goals are paused with `update_goal { active: false }`, never deleted.
- `get_recommendations` was renamed `list_recommendations`.

Status: all `live` (Supabase in production, in-memory locally without Supabase keys).
