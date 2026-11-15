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
  - Demo visitors (the web app's "See the demo week", server to server only): `API_KEY` plus
    `X-Michael-Demo-Visitor: <uuid>`, one random id per visitor. Same demo account, but read
    mostly: chat is stored and read per visitor (a visitor never sees another's, nor the
    account's own), and only these writes are allowed: `POST /v1/chat`, `/v1/chat/stream`,
    `POST /v1/chat/threads`, `PATCH|DELETE /v1/chat/threads/:id` (their own threads),
    `/v1/recommendations/:id/execute|undo`, `PATCH /v1/recommendations/:id`, `POST /v1/analysis/run`,
    `/v1/travel/plan`, `/v1/focus-guards/suggest`, `/v1/voice/speak`, `/v1/records/:id/announced`, `POST|DELETE /v1/push/subscriptions` and `POST /v1/nudges/test`.
    Anything else that writes (privacy, goals, instructions, places, profile, integrations,
    Telegram, agents, connecting an agent, keys, data deletion, ingest, `/mcp`) answers
    `403 forbidden` with the message "This is the demo week. Sign in with Google to make it yours."
    and `details: { demo: true }`. A malformed visitor id is `401`. MCP OAuth tokens bound to the
    demo account and the bare `API_KEY` keep full access.
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
- `ActionKind`: `move_calendar_block | move_calendar_blocks | create_focus_block | block_mac_app | draft_follow_up | reminder | change_goal | plan_change | remove_calendar_block`
- `AnalysisStatus`: `queued | running | succeeded | failed`
- `AnalysisTrigger`: `manual | scheduled | mcp | morning | evening`
- `AgentScope`: `timeline | goals | recommendations | score | write_events`
- `AgentStatus`: `pending | approved | revoked`
- `NudgeChannel`: `watch | push | telegram`; `NudgeStatus`: `queued | sent | failed | suppressed | test`
- `NudgeKind`: `focus_drift | block_soon | wind_down | goal_behind | morning | evening`; `NudgeSkip`: `nothing_to_say | quiet_hours | daily_cap | too_soon | off_the_record`
- `AppCategory`: `work | communication | social | video | news | shopping | travel | ai | music | system | other`
  (one shared categoriser for apps and sites, `packages/shared/src/categories.ts`; unknown = `other`).
  `categoriseEvent` is the entry point for an event (host, then bundle id, then a well known app
  name) and `categoryRole` says what a category does to a goal (`work`: work, ai; `distractor`:
  communication, social, video, news, shopping, travel; `neutral`: the rest). The patterns, the
  score, the retention roll up, the web timeline colours, ActivityWatch focus, the collector and
  (as a generated copy) the browser extension all use them.
- `ConnectorId`: `google-calendar | apple-watch | mac | iphone | claude | nudges | telegram | travel`;
  `ConnectorStatus`: `live | soon`. `CONNECTOR_STATUS` (shared, not served by the API) says which
  connections are proven end to end on production; the apps show the rest as Coming soon (#295).
- `IntegrationProvider`: `google_calendar | whoop`
- `IntegrationStatus`: `connected | disconnected | error`
- `DraftStatus`: `proposed | done | dismissed`; `DraftChannel`: `email | chat`; `DraftAuthor`: `model | template | analysis`

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
  exceptions?: string[]; // calendar titles allowed inside the protected time; left out when none
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
  exceptions?: string[] | null; // up to 50 titles, each 1 to 200 characters, not blank
  active?: boolean; // default true
};
type InstructionUpdate = Partial<InstructionCreate>; // null clears days, time, end_time or exceptions

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
  source?: "analysis" | "chat" | "user"; // "chat": asked for in chat or by voice and carried out at once; "user": an edit on the Timeline (#271), kept for Undo and never listed
  specialist?: "work" | "training" | "rest" | "food" | null; // runs in mode specialists only
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
  action_ids: string[]; // on Michael's answers: recommendations done or undone while writing it
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
- The patterns layer uses these sessions for the hours the Biome backfill (`iphone_usage`) has not
  covered yet, and steps aside once it has (see "One timeline first").

`POST /v1/webhooks/activitywatch` takes ActivityWatch bucket events exactly as
`GET /api/0/buckets/<id>/events` returns them (`{ timestamp, duration, data: { app, title } }`
for `aw-watcher-window`, `data: { status: "afk" | "not-afk" }` for `aw-watcher-afk`), as either
`{ window: AwEvent[], afk?: AwEvent[] }` or the body of `GET /api/0/export` (`{ buckets: {...} }`).
Format: https://docs.activitywatch.net/en/latest/buckets-and-events.html. Mapping
(`apps/api/src/ingest/activitywatch.ts`):

- Away time (`afk`) is cut out, then the same app within 10 seconds is one run: one `app_usage`
  event (`title` = app, `data`: `app`, `device: "mac"`, `seconds`; `external_id` =
  `aw:<app lowercased>:<start, UTC second>`). Window titles are never stored.
- Focus rule: work app runs (an app whose name the shared categoriser reads as a `work` or `ai`
  app, `bundleIdForAppName` in `packages/shared/src/categories.ts`) where
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
| `chrome`                      | `search`       | the search term                    | `engine`, `term`, `origin`, `profile?`, `maps?` (Google Maps, below)                                                          |
| `claude_code`                 | `ai_session`   | session title                      | `tool`, `session_id`, `project`, `model?`, `turns`, `waiting_seconds`, `input_tokens`, `cached_input_tokens`, `output_tokens` |
| `claude_code`                 | `ai_prompt`    | first 120 characters of the prompt | `tool`, `session_id`, `project`                                                                                               |
| `claude_code`                 | `notification` | `Claude Code`                      | `tool`, `session_id`, `project`, `kind` (`permission_prompt` or `idle_prompt`). Live hook only                                |

Browsing events (`web_visit`, `search`) carry `origin`: `history` when they come from Chrome's own
history file (`apps/collector`), `extension` when the browser extension saw them live. The same
visit can arrive from both; the patterns layer decides which to trust. From `history`:

- `foreground` is `true` when `seconds` is the time Chrome measured the page in front, and `false`
  when Chrome did not measure it and `seconds` is how long the page stayed open. Capped at two hours.
- `category` is an `AppCategory` (`work`, `ai`, `communication`, `social`, `video`, `news`,
  `shopping`, `travel`, `music`), from the one list of well known sites in
  `packages/shared/src/categories.ts` (the extension uses a generated copy). A site we do not know,
  and a search engine, has no category. Older events may carry the earlier labels (`messaging`,
  `mail`, `dev`, `docs`, `finance`, `search`); `categoriseVisit` reads them as the same categories.
- `profile` is the Chrome profile folder (`Default`, `Profile 1`).
- Visits to excluded hosts (banking, health, adult, password managers, the local network, and the
  user's own list) are never sent, and neither are their titles or search terms
  (`apps/collector/src/site-privacy.ts`).

Google Maps is the one site whose address is read past the host (`apps/collector/src/maps-url.ts`).
A search (`/maps/search/`, `?q=`, `?query=`), an opened place (`/maps/place/`) or directions
(`/maps/dir/`, `?origin=&destination=`, `?saddr=&daddr=`) becomes a `search` event with `engine:
"google_maps"` and a clean `term` ("gyms near me", "Acropolis Museum", "Pagrati to Kifisia",
"Directions to Kifisia", "Dropped pin"). The map position (`/@lat,lng,zoom`) and `data=` blob never
reach the term. Bare map views and short links (`maps.app.goo.gl`) are not searches. Page titles
that are a position become `Google Maps`.

```ts
type MapsStop = { name: string | null; lat: number | null; lng: number | null };
// data.maps of a chrome search event
type MapsQuery = {
  kind: "search" | "place" | "directions";
  place: MapsStop | null; // search and place
  from: MapsStop | null; // directions
  to: MapsStop | null;
};
```

Coordinates come only from the address: a place's own `!3d!4d` pair (else the map centre), a stop
or search that is a bare position. A search for words never has coordinates. Location is opt in:
the API stores every `lat`/`lng` as `null` unless source `maps` is switched on, and drops a `maps`
field that does not match the contract (`redactLocation` in `apps/api/src/privacy.ts`).

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

| Method | Path                               | Body                              | Response                      | Status |
| ------ | ---------------------------------- | --------------------------------- | ----------------------------- | ------ |
| GET    | `/v1/goals`                        |                                   | `200 { goals: Goal[] }`       | live   |
| GET    | `/v1/goals/:id`                    |                                   | `200 Goal`, `404`             | live   |
| POST   | `/v1/goals`                        | `GoalCreate`                      | `201 Goal`                    | live   |
| PATCH  | `/v1/goals/:id`                    | `GoalUpdate`                      | `200 Goal`, `404`             | live   |
| DELETE | `/v1/goals/:id`                    |                                   | `204`, `404`                  | live   |
| GET    | `/v1/goals/suggestions`            |                                   | `200 GoalSuggestionsResponse` | live   |
| POST   | `/v1/goals/suggestions/:id/accept` | `GoalSuggestionAccept` (optional) | `201 Goal`, `404`             | live   |
| POST   | `/v1/goals/:id/book`               | `GoalBook` (optional)             | `201 Recommendation`, `409`   | live   |

#### Book time for a goal (#309)

The Goals tab's one action. `type GoalBook = { minutes?: number }` (15 to 360, default 60). Michael
takes the first free slot of that length from now (at least 5 minutes ahead, on the quarter hour)
to Sunday night, inside the waking day (the sleep goal sets it), clear of every calendar entry that
holds time and of time an active standing instruction protects for the goal's block title. The
block is titled with the goal's first `calendar_titles` entry (else its title), so the score counts
it, and is booked at once as a `create_focus_block` recommendation (`status: "done"`, rationale
"Booked at your request through Goals."), the same path as the MCP `create_focus_block` tool.
Undo with `POST /v1/recommendations/:id/undo` until it starts. `404` for an unknown or paused goal,
`409` "No free 90 minutes left this week" when nothing fits. Pure slot logic: `goalSlot` in
`apps/api/src/goals/book.ts`.

#### Goals from the calendar (#134)

People already live by goals they never wrote down. `GET /v1/goals/suggestions` reads the user's own
calendar blocks (no other people, not all day, not booked by Michael) from four weeks back to a week
ahead, groups the ones that recur and proposes each as a goal. Pure logic in
`apps/api/src/goals/suggest.ts`.

```ts
type GoalSuggestion = {
  id: string; // stable: "training", "study", "deep_work", "business", "meals", or "title:<slug>"
  title: string; // "Training", "University", "Deep work", "Business", or the calendar title
  category: GoalCategory; // always business, health or personal (#131), the same as area
  area: GoalArea;
  weekly_budget_minutes: number; // average a week, rounded to 30 minutes
  target: { kind: "time"; calendar_titles: string[] }; // the titles that count, biggest first
  evidence: string; // "Gym, Swimming and Run, Mon, Tue and Fri, 4h 30 a week."
  sessions_per_week: number;
  days: Weekday[];
};
type GoalSuggestionsResponse = { from: string; to: string; suggestions: GoalSuggestion[] };
type GoalSuggestionAccept = { title?: string; weekly_budget_minutes?: number; calendar_titles?: string[] };
```

- **Titles:** the part that stays the same each week, as the user wrote it: `Lecture: Statistics`
  counts as `Lecture`, `Cold Outreach / Sales` as `Cold Outreach`, `Swimming 1,500m` as `Swimming`.
  The score matches calendar titles as prefixes, so every variant counts.
- **Grouping:** known words pool into one goal: sport into Training, lectures and study into
  University or Study, focus into Deep work, outreach, sales, marketing and preparation into
  Business, meals into Proper meals. Any other title stays a goal of its own, business when most
  of it falls on weekdays 08:00 to 18:00, personal otherwise. Sleep, commutes and travel are never
  suggested.
- **Recurring:** a group on at least two days, or one Google marks as repeating. One-offs are noise.
  Weekly hours are averaged over the weeks of calendar seen; a block counts at most once a week per
  weekday it falls on. At most 6 suggestions, biggest first, none under 30 minutes a week.
- **Already covered:** an event an active goal already counts (the matcher below) is left out, and
  so is a suggestion with an active goal's name. Accepting one makes it disappear.
- **Accepting:** `POST /v1/goals` with `category`, `title`, `weekly_budget_minutes` and `target` as
  given, or `POST /v1/goals/suggestions/:id/accept` with optional edits. The goal's description says
  where it came from. `404` when the calendar no longer suggests that id.
- **Where it shows:** the Google Calendar callback syncs four weeks back on first connect and adds
  `goal_suggestions=<n>` to the redirect when there are any (from onboarding, the page runs that
  sync itself with `?past_days=28`); onboarding's first step, the Goals tab
  and the calendar row on You list them with one tap to keep. MCP: `propose_goals` (scope `goals`).

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
| `count`     | Times a week (counted from the timeline, see Score). | `per_week`, `calendar_titles`             |
| `checklist` | The day's one to three business outcomes.            | (the items live in `/v1/checklist`)       |

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
A checklist goal: `{ "category": "business", "title": "Today's outcomes", "target": { "kind": "checklist" } }`.

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

### Checklist (#238)

The day's one to three outcomes of a goal of kind `checklist`, in the user's own words. Table
`checklist_items` (RLS like every table: only the API reads and writes). Rules in
`apps/api/src/checklist/items.ts`.

| Method | Path                      | Body                                                           | Response                                 | Status |
| ------ | ------------------------- | -------------------------------------------------------------- | ---------------------------------------- | ------ |
| GET    | `/v1/checklist?date=`     |                                                                | `200 ChecklistResponse`                  | live   |
| POST   | `/v1/checklist`           | `{ goal_id, date?, text, linked_goal_id?, estimate_minutes? }` | `201 ChecklistItem`, `400`, `404`, `409` | live   |
| PATCH  | `/v1/checklist/:id`       | `{ text?, status? }`                                           | `200 ChecklistItem`, `400`, `404`, `409` | live   |
| DELETE | `/v1/checklist/:id`       |                                                                | `204`, `404`                             | live   |
| POST   | `/v1/checklist/:id/carry` |                                                                | `201 { moved, item }`, `404`, `409`      | live   |

```ts
type ChecklistItem = {
  id: string;
  goal_id: string; // a goal of kind checklist
  date: string; // local day, YYYY-MM-DD, Europe/Athens
  text: string; // the user's words, 1..200
  position: number; // 0..2, the slot among the day's open items of the goal
  status: "open" | "done" | "partly" | "dropped" | "moved";
  settled_at: string | null;
  settled_by: "user" | "check_in" | null;
  carried_from: string | null; // id of the item of the day before that this one continues
  linked_goal_id: string | null; // #318: the goal the outcome serves, any kind and area
  estimate_minutes: number | null; // #318: the user's guess, 5..720
  logged_minutes: number | null; // #318: time logged for it in the evening
  created_at: string;
  updated_at: string;
};
type ChecklistResponse = {
  date: string;
  items: ChecklistItem[]; // every item of the day, any status, by goal and position
  suggestions: ChecklistItem[]; // yesterday's items still open, nothing else in this version
};
```

- `date` defaults to today in Athens; `400` on a day that does not exist. `text` is trimmed.
- `POST`: `404` for an unknown goal, `400` for a goal that is not of kind `checklist`, `409` when
  the goal already has three open items that day. The item takes the lowest free `position`.
- `PATCH`: `status` is `open`, `done`, `partly` or `dropped` (`partly` counts as set, not done). Settling sets `settled_at` and
  `settled_by: "user"`; reopening clears both and takes a free slot (`409` when three are open).
  `moved` is never set by hand (`400`): carry instead. A moved item cannot change status (`409`).
- `carry`: only an open item (`409` otherwise, or when the next day already has three open). The
  old item becomes `moved`; a new one on the next day continues it with `carried_from`.
- Michael never ticks an item himself. The evening check in (#187) settles items through the same
  store method with `settled_by: "check_in"`.
- Deleting the goal deletes its items. Another user's items are never visible (`404`).
- The first open item of today gets one offered focus block, at most once a day (see
  Recommendations, Offers for checklist and count goals).
- `linked_goal_id` (#318) names any of the user's goals (`404` otherwise); deleting that goal sets
  it to null. A carried item keeps its link and estimate.

### Daily ritual (#318)

Every morning the user writes what they want to get done; every evening they log what they did.
The outcomes are checklist items of one checklist goal ("Today's outcomes", category personal,
made silently on the first morning when the user has no checklist goal), each optionally for any
goal. Table `day_rituals` keeps which half was saved or skipped per day, and the evening's line.
Rules in `apps/api/src/ritual/ritual.ts`.

| Method | Path                    | Body                                                           | Response                                          | Status |
| ------ | ----------------------- | -------------------------------------------------------------- | ------------------------------------------------- | ------ |
| GET    | `/v1/ritual?phase=`     |                                                                | `200 RitualToday`                                 | live   |
| POST   | `/v1/ritual/morning`    | `{ outcomes: [{ text, goal_id?, estimate_minutes? }] }` (1..3) | `201 RitualToday`, `400`, `404` goal, `409` full  | live   |
| POST   | `/v1/ritual/evening`    | `{ results: [{ item_id, result, carry?, minutes? }] }`         | `201 RitualEveningResponse`, `404`, `409`         | live   |
| POST   | `/v1/ritual/:kind/skip` |                                                                | `200 RitualToday` ("Not today"), `400` other kind | live   |

```ts
type RitualState = "not_yet" | "due" | "done" | "skipped";
type RitualToday = {
  day: string; // local YYYY-MM-DD
  phase: "morning" | "evening" | null; // which half shows now; null before waking
  morning: RitualState;
  evening: RitualState; // not_yet on a day without outcomes
  goal_id: string | null; // the checklist goal holding the outcomes
  items: ChecklistItem[]; // today's outcomes, moved ones left out
  suggestions: { text; goal_id; estimate_minutes; reason; source: "calendar" | "behind" }[]; // morning, at most 2
  goals: { id; title; area }[]; // active goals as quick chips (checklist goals left out)
  summary: string | null; // the evening line once saved
  tomorrow: string | null; // evening: "University at 09:00"
};
type RitualEveningResponse = {
  summary: string; // "2 of 3 done. 40 min logged for Training. One carried to tomorrow. Tomorrow starts with University at 09:00."
  carried: ChecklistItem[]; // the new items on tomorrow
  logged: { goal_id: string; minutes: number }[];
  ritual: RitualToday;
};
```

- **When:** the morning from waking (end of last night's sleep, else 08:00, the Morning moment's
  rule) or once the morning nudge went out; the evening from an hour before the usual bedtime
  (else 21:00, never later than 45 minutes before quiet hours, the Evening moment's rule) or once
  the evening nudge went out. `?phase=` shows that half now (previews, the stage, e2e). The app
  shows the half named by `phase` while its state is `due`, and the evening line once `done`.
- **Morning done** once saved, skipped, or when the user wrote an outcome for today any other way;
  an outcome carried from yesterday still asks the morning, listed as already set. Saving keeps
  outcomes already on today, skips duplicates (same words), refuses a fourth (`409`) and checks
  every `goal_id` before writing anything. The first outcome gets the usual offered hour.
- **Suggestions** (at most two): time goals behind their weekly pace (the `goal_behind` rule, any
  hour): "University is 4h behind this week. One block today?", or "Keep the 10:00 block." when
  today has one; then today's own goal blocks still ahead ("On your calendar at 10:00, for
  University."). Never a goal an outcome already serves.
- **Evening:** `result` done, partly or not. `carry: true` (partly or not) makes a new item on
  tomorrow with `carried_from`; a "not" that is carried becomes `moved`, a "partly" stays
  `partly`. Room on tomorrow is checked before anything is written (`409`). `minutes` (done or
  partly) is kept as `logged_minutes` and handed to the done time log (`apps/api/src/ritual/log.ts`,
  the seam to `POST /v1/log`, #317); until that lands the minutes are named in the line but do not
  count in the score yet. The line counts every outcome of the day, settled earlier or now.
- **Calm:** no streaks, no guilt copy; "Not today" hides that half for the day. No new nudge: the
  Morning and Evening nudges (#169) ask the ritual's question while its half is to do ("What do you
  want to get done today? Up to three." / "2 outcomes today. What did you get done?") and open
  Today, inside the 5 a day cap and quiet hours.
- **Everywhere:** chat tools `set_day_outcomes` and `log_day` (the chat context lists today's
  outcomes with their ids), MCP tools of the same names (scope `goals`).
- **Demo week:** today's plan is filled (one carried from yesterday) and the two evenings before
  are logged, written once per day (`apps/api/src/demo/ritual.ts`).

### Standing instructions

Some things are not goals: they are the user's ground rules, such as "keep Sundays clear" or "home
every day by 21:00". The user gives a few at setup and can change, pause or remove them later.
**Michael never plans or moves anything into the time an active instruction protects**, and flags
what already sits there. An instruction is a rule he obeys everywhere, not only a flag on the score:
no path may create, move or propose a block there, and nothing may be carried out there (see "The
guard" below).

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
| `home_by`     | From `time` until 05:00 the next morning, on `days` (every day when absent) | `time`                |
| `quiet_hours` | From `time` to `end_time`, on `days` (every day when absent)                | `time` and `end_time` |
| `custom`      | Nothing: it is text for the coach to read                                   |                       |

- `text` is always the user's own words and is never rewritten. `kind` defaults to `custom`, so a
  client may send only the words.
- `days`: 0 = Sunday to 6 = Saturday. `time` and `end_time`: `"HH:MM"`, 24 hour clock.
- When `end_time` is not after `time`, quiet hours run past midnight (22:00 to 07:00) and belong to
  the day they start on. `home_by` runs on until 05:00: a block at 00:30 counts as after 21:00 of
  the day before. A `time` before 05:00 ("home by 01:00") is that night's small hours.
- `exceptions`: calendar titles allowed inside the protected time, such as the Sunday recovery
  session on "Keep Sundays clear". Matched exactly like a goal's `calendar_titles` (equal or starting
  with the entry at a word boundary, ignoring case and accents; one matcher, `score/match.ts`). A
  block that matches one is not listed in `instructions_broken` and may be planned. Set with `POST`
  or `PATCH`; `null` clears them.
- A kind must have what it needs, on create and after a change (`400` otherwise). `null` in a
  `PATCH` clears `days`, `time` or `end_time`. Pause with `{ "active": false }`.
- `days`, `time` and `end_time` are left out of the answer when they are not set.

```json
{ "text": "Keep Sundays clear", "kind": "clear_day", "days": [0], "exceptions": ["Rhefuel"] }
```

Which instructions a span of time falls under is one pure function,
`protectedBy(instructions, start, end, timezone)` in `apps/api/src/instructions/protected.ts`. It
returns the active instructions with any part of the span inside their protected time. Ends are
exclusive (a block that stops at Sunday 00:00 has not touched Sunday), days are local days in the
timezone given (default Europe/Athens), and the days the clocks change are handled. `forbiddenBy`
in the same file is the same with a block's title: it leaves out the instructions whose
`exceptions` name the block. The score does not count with it: each block in `GET /v1/score` only
carries `instructions_broken`, the ids of the active instructions its time falls under (less those
whose exceptions name it), so the app can flag a work block planned on a clear Sunday. The chat with
Michael and the analysis brief are given the active instructions, as the user wrote them, with their
exceptions in words ("Keep Sundays clear (except: Rhefuel)"); a paused one is left out.

#### The guard

One pure function decides, `checkAction(action, instructions, timezone)` in
`apps/api/src/instructions/guard.ts`: an action (its kind, the span it lands on, the block's title)
is allowed, or refused with the instruction that forbids it and one line in Michael's voice derived
from it: "Sundays are kept clear." (clear_day), "You're home by 21:00." (home_by), "That's in your
quiet hours." (quiet_hours). A `custom` instruction never refuses anything.

| Action                                      | Refused when                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `create_focus_block`, `move_calendar_block` | Where the block lands is protected and its title is not one of the exceptions |
| `reminder`                                  | It falls inside `quiet_hours`                                                 |
| `block_mac_app`                             | Never: it protects the time                                                   |
| `draft_follow_up`                           | Never: it is not planning                                                     |

Only where a block lands counts, so moving a block out of protected time is always allowed. Where
it is enforced:

- **When a recommendation is stored** (one choke point: both stores call `guardRecommendation` in
  `createRecommendation` and `saveAnalysis`). Covers the analysis, the travel rules, the chat tools
  and an agent's `create_focus_block`. A refused action is dropped and the recommendation stays as
  advice, its words untouched; the refusal is logged (`instruction_guard_refused`). A
  recommendation asked for in chat (`source: "chat"`) is carried out at once, so it is refused
  instead: `409 conflict` with the reason, and nothing is stored or booked.
- **When a recommendation is carried out**: `POST /v1/recommendations/:id/execute` checks again
  against the instructions as they are now and answers `409 conflict` with the reason, in case an
  instruction was added after the recommendation was made.
- **The Morning and Evening moments** (and the nudge built from them) leave out a move whose action
  is refused.

`mockInstructions` in `packages/shared/src/mocks.ts` holds one example ("Keep Sundays clear", with
the exception "Rhefuel").

### Analysis

| Method | Path                  | Body                                                                            | Response                                                                                                                                                                                 | Status |
| ------ | --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| POST   | `/v1/analysis/run`    | `?mode=single\|specialists`; `{ from?, to?, trigger? }`, or no body (see below) | `201 { run: AnalysisRun, recommendations: Recommendation[] }`; `400` bad range; `502 upstream_error` if the model fails or its answer is unusable; `503 unavailable` without a model key | live   |
| GET    | `/v1/analysis/latest` |                                                                                 | `200 { run, recommendations }`, `404` if none                                                                                                                                            | live   |

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

**Mode `specialists`** (`?mode=specialists`, issue #20; the default stays `single`). Same body,
same response, same storage; each recommendation also carries `specialist`. Code in
`apps/api/src/analysis/specialists.ts`.

1. The brief is built once, as above. Four specialists (`work`: business and study goals and focus;
   `training`; `rest`: sleep, late screens, time off; `food`) each get only their slice: their goals,
   their goals' blocks, busy time, the patterns of their domain, the data notes. A specialist with
   nothing to read (no goals, or no blocks, scored goals or patterns) is not asked.
2. They run in parallel at effort `low` and return up to 4 findings each (structured output, zod):
   `finding`, `maths`, `evidence_numbers`, `goal_id`, `confidence` (0 to 1), `evidence`, `action`
   (an existing kind). Code drops a finding with a number that is not in its slice, nulls a goal
   that is not the specialist's, and drops an action that fails the usual action rules.
3. Code merges them: duplicates go (same sentence, or the same goal asking for the same change at
   the same time), and two actions from different specialists that want the same time are settled:
   the higher confidence wins; within 0.1, rest beats training beats work beats food. The loser
   keeps its finding, not its action. The best 6 go on.
4. A coordinator (the coach instructions plus a short section on specialists, effort `medium`)
   gets the full brief and the merged findings and writes the usual answer, naming the finding
   behind each recommendation. Same checks as the single pass (at most 3, enforce, copy rules, one
   retry), plus the **number guard** (`analysis/numbers.ts`): every number and time in the copy must
   be in the brief or the findings, or be a minutes to hours conversion of one, or a time the
   answer's own action proposes. An invented number in a recommendation drops it; in the summary
   or question after the retry, the run falls back.

**Fallback and cost.** If any specialist or the coordinator fails, the same brief goes through the
single pass, so the person always gets a brief (logged as `analysis_specialists_fallback`).
Findings are cached in memory per user per day by a hash of the model, prompt and slice: a second
tap with no new data asks no specialist again. A typical run is 2 to 4 specialist calls at low
effort plus one coordinator call.

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
| `checklist_today`: today's open checklist items in the user's words, with their goal and whether carried (#238)                           |                                                                               |
| A count goal's pace in its `this_week` (`done`, `target`, `left`, `days_left`, `behind_pace`); a checklist goal's tally (#238)            | Note text: check in answers give only the goal and the instant                |

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
the one line summary of every detector that had enough data and found something worth leading
with, most important first. A detector can answer and still stay out of `headlines` when its
finding is trivial or its sample small (`RULES.headline` in `apps/api/src/patterns/context.ts`):
under 5 minutes of drift, lost time or AI tool time; fewer than 5 disruptions or under 60 minutes
of focus; recovery measured on fewer than 10 disruptions; no late night; under 60 minutes of screen
time; fewer than 3 AI sessions. Its `summary` and `data` stay for the detail. When nothing clears
the bar `headlines` is empty and the chat and the connector say "Not enough data yet".

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
    iphone_app_usage: number; // Apple's logs, plus ActivityWatch and Shortcuts where they have nothing
    app_usage_superseded: number; // ActivityWatch and Shortcuts intervals ignored because Apple's log covered the hour
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
  reason: string | null; // "Not enough data yet: needs at least 3 days of phone usage, found 1"
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
  end; `device: "watch"` is left out), and from `activitywatch` (Mac) and `ios_shortcuts` (iPhone),
  which name the app instead (`data.app` or the title: a well known name reads as its bundle id,
  any other name stays as it is with category `other`); `web_visit`, `search`, `screen`,
  `notification`, `sleep`, `recovery`, `calendar_event`, `ai_session`. `focus_session` is not used.
- **App usage precedence:** Apple's own logs are the record. Per device, for every clock hour in
  which `macos_usage` (Mac) or `iphone_usage` (iPhone, the Biome backfill that lands up to a day
  late) has an interval, `activitywatch` or `ios_shortcuts` intervals that start in that hour are
  ignored (`inputs.app_usage_superseded`); any overlap left at an hour's edge goes to the record.
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
  usual bedtime (median start of recorded nights, naps left out) when sleep data exists. A night
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

| Method | Path                                           | Body                                                                               | Response                                                                                                                                                                                                                                                                                       | Status |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/v1/chat?thread_id=&limit=50`                 |                                                                                    | `200 { messages: ChatMessage[], actions: Recommendation[], thread: ChatThread \| null }` (one thread's lines, oldest first, limit 1..100; without `thread_id` the latest thread; `actions` are the ones named in `action_ids`, as they stand now); `404` for a thread that is not the caller's | live   |
| POST   | `/v1/chat`                                     | `{ message: string, spoken?: boolean, thread_id?: uuid \| "new" }` (1..2000 chars) | `201 ChatResponse` `{ message, reply, actions: Recommendation[], thread: ChatThread }`; `404` unknown thread; `503 unavailable` without `ANTHROPIC_API_KEY`; `502 upstream_error` if Claude fails                                                                                              | live   |
| POST   | `/v1/chat/stream`                              | same as `POST /v1/chat`                                                            | `200 text/event-stream`: `event: delta` `{ text }` per piece, `event: action` `Recommendation` per thing done or undone, then `event: done` `ChatResponse`, or `event: error` `ApiError`. Validation, `404` and `503 unavailable` come back as plain JSON before the stream opens              | live   |
| GET    | `/v1/chat/threads?archived=false&q=&limit=100` |                                                                                    | `200 ChatThreadList` `{ threads: ChatThread[] }`, pinned first, then latest line first. `q` (1..100 chars) matches titles and line text                                                                                                                                                        | live   |
| POST   | `/v1/chat/threads`                             | `{ title? }` (or no body)                                                          | `201 ChatThread`, empty, titled "New chat" unless named                                                                                                                                                                                                                                        | live   |
| PATCH  | `/v1/chat/threads/:id`                         | `{ title?, pinned?, archived? }` (at least one)                                    | `200 ChatThread`; `404` when not the caller's                                                                                                                                                                                                                                                  | live   |
| DELETE | `/v1/chat/threads/:id`                         |                                                                                    | `200 { id, messages }`: the thread and every line in it, really deleted; `404` when not the caller's                                                                                                                                                                                           | live   |

`spoken: true` means the answer will be read aloud (the app's conversation mode): Michael keeps it
to one or two short sentences with no lists or markdown, and says numbers as a person would.

`/v1/chat` stays for callers that want the whole answer (MCP, voice); `/v1/chat/stream` gives the
first words fast and stores the same pair when it finishes. The stored answer keeps the ids of what
it did (`action_ids`), so a client can show the same Undo chips under it after a reload.

**Threads (#308).** Conversations are separate, as in Messages: `ChatThread { id, title, pinned,
archived, preview, last_message_at, created_at, updated_at }` (`preview` is the last line, cut to
140 characters). `thread_id` omitted writes in the latest thread (a new one when there is none);
`"new"` starts one, made only once the answer is stored, so a failed call leaves no empty thread.
The first line names a thread: the model writes 2 to 5 words in Michael's voice in parallel with
the answer (only the user's own line is sent), and the first words of the line are the fallback;
a name the user gave is never overwritten. Michael sees the lines of the current thread only; he
knows the others through memories, check ins and the titles of the 5 latest other threads
("Other conversations (titles only)"), never their lines. Lines from before threads sit in one
"Earlier" thread per user (and per demo visitor). Demo visitors get threads of their own, like
their lines. `DELETE /v1/me/data` counts `chat_threads` too.

The API keeps the history per user and thread (`chat_threads`, `chat_messages`); the client sends only the new line. Michael
answers with Claude (`ANTHROPIC_MODEL`, default `claude-opus-5-5`) from a summary built in the API:
the week's score with the same figures as `GET /v1/score` (built in process by `scoreFor`, not over
HTTP: score, spent of elapsed, lost, ahead, time won back, and per goal spent of budget and what is
left; today's score and biggest losses inside goal blocks),
the active goals with weekly budgets, today's calendar, workout, sleep, meal and focus entries,
today's screen time totals, 7 day totals per type and the pattern headlines for today and the last
7 days, plus the last 20 lines of chat. Raw app, web and AI events are never sent, only totals, and
conversations and memories stay out. Nothing is stored when the call fails.

**Chat acts on the user's own time (#46).** Claude gets five tools, run server side inside the
request (no HTTP self calls): `find_calendar_blocks { from, to }` (ids and whether a block may be
moved), `create_focus_block { title, start_at, end_at, goal_id? }`, `move_calendar_block { event_id,
start_at, end_at?, new_title? }`, `block_mac_app { apps: string[], start_at, end_at, goal_id? }`
(see Focus guards) and `undo_action { recommendation_id }`. Each action becomes a
recommendation with `source: "chat"` that is carried out at once by the same code as
`POST /v1/recommendations/:id/execute` (and `/undo`), so every guard rail holds: events with other
people and anything already started are refused (the model hears the 409 and advises instead;
the refused recommendation is stored as `dismissed`), Michael never deletes the user's events, and
undo works until the block starts. `ChatResponse.actions` lists what was done (`status: "done"`,
deadline in `action.undo_until`) or undone in this answer, and the reply always ends with
"Undo until HH:MM." for each thing done. The context gives Claude ids only for the user's own blocks
that have not started, goal ids, and the things that can still be undone.

**Chat proposes goal and plan changes (#188).** Two more tools turn what the user said ("I have
exams from 1 December", "my knee hurts") into one proposal: `propose_goal_change { changes:
[{ goal_id, weekly_budget_minutes?, active? }], until?, title, reason }` and `propose_plan_change
{ steps: [{ kind: "move_calendar_block", event_id, start_at?, end_at?, new_title? } | { kind:
"create_focus_block", start_at, end_at, title? }], goal_id?, title, reason }`. Nothing changes: each
stores a recommendation (`source: "chat"`, `status: "proposed"`, kind `change_goal` or
`plan_change`, payloads under Recommendations) and returns it in `ChatResponse.actions` (and the
stream's `action` event). The app shows Accept, which calls `POST /v1/recommendations/:id/execute`,
and Not now, which sets `status: "dismissed"`; an accepted change is undone with `/undo`. Rules: one
proposal per answer; a plan step on an event with other people or one that has started is
refused before anything is stored; a proposal the user dismissed in the last 7 days for the same
goals or blocks is refused, so Michael does not repeat it that week. The recommendation is the
record of who changed the goal (chat) and why (`rationale`).

**Check in in chat (#187).** The context lists the user's check in answers from the last 7 days
("What you told me", quoted, never invented) and today's open questions with their ids, and a tool
`answer_check_in { check_in_id, value }` keeps an answer the user types in the chat (same rules as
`POST /v1/check-in/:id/answer`; the result gives the follow up to ask, word for word).

**Daily ritual in chat (#318).** The context lists "Today's outcomes" with their ids and which half
is due. `set_day_outcomes { outcomes: [{ text, goal_id?, estimate_minutes? }] }` keeps "my goals
today are X, Y" and `log_day { results: [{ item_id, result, carry?, minutes? }] }` logs "I finished
X, did 30 min of Y" (same rules as `POST /v1/ritual/morning` and `/evening`); Michael repeats the
evening line the tool returns, word for word.

### Check in (#187)

Michael asks a few questions about the day, drawn from the timeline, and keeps the answers as
structured notes (`check_ins`, one row per question) that feed the chat context, the analysis brief
(`told_me`) and MCP.

| Method | Path                      | Body                                         | Response                                                                        | Status |
| ------ | ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| GET    | `/v1/check-in`            |                                              | `200 CheckInToday` `{ day, open, moment, questions: CheckIn[] }`                | live   |
| POST   | `/v1/check-in/:id/answer` | `{ value: "yes" \| "no" \| 1..5 \| string }` | `201 CheckInAnswerResponse` `{ check_in, follow_up }`; `409` if answered; `404` | live   |
| DELETE | `/v1/check-in/:id`        |                                              | `204`; the question, its answer and its follow ups are really deleted; `404`    | live   |

```ts
type CheckIn = {
  id: string;
  day: string; // local YYYY-MM-DD
  kind: "missed_block" | "unaccounted" | "training" | "meeting" | "short_night" | "follow_up";
  question: string; // "14:00 to 15:10 is unaccounted for on your Mac. Were you in a meeting?"
  answer_type: "yes_no" | "scale" | "text";
  moment: "missed_block" | "evening"; // the round it was asked in
  event_id: string | null;
  goal_id: string | null;
  start_at: string | null;
  end_at: string | null;
  follow_up_of: string | null;
  answer: "yes" | "no" | number | string | null; // the user's own words
  label: string | null; // what it settles: "meeting", "trained", "skipped", "played_a_part", "low", "high", "other"
  asked_at: string;
  answered_at: string | null;
};
```

- **Questions come from the day**, most useful first, at most 5: an own calendar block for a
  health goal (or titled like a sport) that ended with no workout within an hour ("Run, 18:30 to
  19:30. No workout recorded. Did you train?"); up to two stretches of 45 minutes or more between
  09:00 and 19:00, inside the Mac day, with no Mac activity and nothing on the timeline ("14:00 to
  15:10 is unaccounted for on your Mac. Were you in a meeting?"); a training block with a workout
  ("Gym, 07:30 to 08:30. How did it go? 1 to 5."); up to two meetings with other people that ended
  ("Investor call, 16:00. Did it go the way you wanted?"); a night under 6 hours ("You slept 5h 10.
  Energy today? 1 to 5."). Only what has ended. Copy follows the voice sheet.
- **At most two rounds a day**, opened by `GET /v1/check-in` (the app's Chat tab, MCP): right
  after a missed training block (that question only), and from 20:00 the Evening round (the rest).
  Once a round has been asked it is not asked again, and a question's key (`missed:<event id>`)
  keeps it from being stored twice.
- **Follow ups only when the answer calls for one**: a "no" on a meeting or a missed block, or 1 or
  2 for a session, after a short night offers the night as the cause ("You slept 5h 10. Did that play
  a part?"); an unaccounted stretch that was not a meeting asks "14:00 to 15:10. What was it? A few
  words." Never a why.
- Each question is answered once (`409` after). A yes or no may be typed as words too; any
  question takes the user's own words. Answers about sleep, energy and training are health data:
  deletable one by one, and in "delete everything".

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
  area?: "business" | "health" | "personal"; // goalArea(category)
  kind?: "time" | "target" | "count" | "checklist"; // goalKind(goal)
  sleep?: boolean; // the sleep goal: hide it from time lines
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

| Method | Path              | Body                               | Response                                                                                                       | Status |
| ------ | ----------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/v1/voice`       |                                    | `200 VoiceStatus` `{ elevenlabs: boolean, voice: "chosen" \| "fallback" \| "device", reason: string \| null }` | live   |
| POST   | `/v1/voice/speak` | `{ text: string }` (1..1000 chars) | `200 audio/mpeg`; `503 unavailable` without `ELEVENLABS_API_KEY`; `502 upstream_error` if ElevenLabs fails     | live   |

Push to talk in the app: the browser turns speech into text (Web Speech API, en-GB), the text goes
to `POST /v1/chat`, and the reply is read aloud. `POST /v1/voice/speak` proxies ElevenLabs text to
speech (`ELEVENLABS_VOICE_ID`, default "George", a calm British male; `ELEVENLABS_MODEL`, default
`eleven_flash_v2_5`) so the key stays on the server. Without a key, or when it fails, the app uses
the browser's own speech synthesis, preferring a low en-GB male voice. Audio is never stored:
only text goes in, and the mp3 is streamed straight back and played once.

If ElevenLabs refuses the chosen voice with `401` or `402` (a Voice Library voice on the free plan
answers `402 paid_plan_required`), the API retries once with the built-in fallback voice
(`ELEVENLABS_FALLBACK_VOICE_ID`, default "George") and keeps using it for an hour before trying the
chosen voice again. `GET /v1/voice` then reports `voice: "fallback"` with the reason ("paid plan
required"). If both are refused the route answers `502` and the app speaks with the device voice;
the words are always on screen as captions. Logs carry the status only, never the key or the text.

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

Kinds carried out: `move_calendar_block`, `move_calendar_blocks`, `create_focus_block`,
`block_mac_app`, the two chat proposals `change_goal` and `plan_change` (#188, below), and
`draft_follow_up` (its `payload.text` is stored as a follow up draft, see "Follow up drafts";
nothing is sent and nothing on the calendar changes, so its undo is `409`); other kinds answer
`501`.

```ts
// move_calendar_block: one of the user's own solo blocks (a timeline event id). A new start keeps
// the length unless end_at is given; new_title renames. At least one of the three.
type MoveCalendarBlockPayload = { event_id: string; start_at?: string; end_at?: string; new_title?: string };
// create_focus_block: a new block, tagged as Michael's (title defaults to "Focus block").
type CreateFocusBlockPayload = { start_at: string; end_at: string; title?: string };
// block_mac_app: close distracting Mac apps from start_at to end_at (a focus guard, see below).
// At least one of app, apps, bundle_ids; names or bundle ids from the allowlist only.
type BlockMacAppPayload = {
  app?: string; // "WhatsApp"
  apps?: string[]; // up to 10
  bundle_ids?: string[];
  start_at: string;
  end_at: string; // after start_at, at most 12 hours after the guard starts
  goal_id?: string;
  block_event_id?: string; // the planned block it sits in (analysis sets it)
  back_to?: string; // "Back to <this>." in the notification; default the goal or block title
};
// move_calendar_blocks: several moves carried out together (the whole day around traffic). All or
// nothing: when one move is refused, the ones already made go back first. One undo puts every
// block back. Extra fields (the travel maths, see Places and travel) ride along for the app.
type MoveCalendarBlocksPayload = { moves: MoveCalendarBlockPayload[] }; // 1 to 10
// change_goal (#188, proposed in chat only): patch up to 5 goals at once. `until` makes it
// temporary: the old values come back then (scheduler and GET /v1/goals), and undo stays open
// until then; without it undo stays open for 7 days.
type ChangeGoalPayload = {
  changes: {
    goal_id: string;
    weekly_budget_minutes?: number | null;
    target?: GoalTarget | null;
    active?: boolean;
  }[];
  until?: string | null;
  reason: string; // "Exams from 1 December."
};
// plan_change (#188, proposed in chat only): up to 10 steps on the user's own calendar, carried out
// together. Each step keeps the guard rails of its kind (and the standing instructions); if one
// is refused, the steps already done are taken back. Undo reverts every step, until the first starts.
type PlanChangePayload = {
  steps: (
    | {
        kind: "move_calendar_block";
        event_id: string;
        start_at?: string;
        end_at?: string;
        new_title?: string;
      }
    | { kind: "create_focus_block"; start_at: string; end_at: string; title?: string }
  )[];
  reason: string; // "Knee hurts."
};
```

Recovery offers (#167, `apps/api/src/recovery`, a rule, not the model). When a goal block of
today's score ends (within the last 2 hours) with `spent_minutes` under half of `planned_minutes`,
Michael stores one `create_focus_block` recommendation through `createRecommendation` (so the guard
applies): 25 minutes in the first free slot today that starts 15+ minutes from now on a 5 minute
grid, ends by 22:00, overlaps no calendar event and lies outside the profile's quiet hours and any
time a standing instruction protects. The title is the line, an offer: the cause, then
"Take 25 minutes at 16:00. Still counts." Causes, first hit wins: an event with other people
overlaps the block ("Meetings ate the block."); most lost minutes were on the phone ("Instagram
took it.", or "The phone took it." when no app is named); 15+ minutes on screens with 30+ switches
per active hour or half the time in stays under 2 minutes ("Too many switches."); under 6 hours of
sleep in the night that ended that day, when sleep was recorded ("Short night."); else "The block
slipped." The payload carries `title` (the goal's title first, "70.3: 25 minutes", so the score
counts the block towards the goal), `goal_id`, `recovery_for` (the block's event id) and
`recovery_cause`. At most one offer per block and one per goal per day; never for a block with
other people; no slot today means no offer. It runs inside the nudge check (every 5 minutes per
active user) and goes out as a `recovery_block` nudge with `recommendation_id` set, under the
same cap, quiet hours and dedupe as every nudge.

Rules: act only on the user's own calendar blocks and Mac; never touch events with other people;
never delete the user's events; never send in the user's name.

- With Google Calendar connected the change happens in the calendar (a created block carries the
  private extended property `michael=1`) and the timeline mirror follows at once. Without it, the
  change happens on the timeline only (a created block is a `calendar_event` with `source: "agent"`).
- `409 conflict` when: the action is `null`; the recommendation is already `done` or `dismissed`;
  `involves_others` is true; the action falls in time an active standing instruction protects (the
  message is the reason, e.g. "Sundays are kept clear."; see Standing instructions, The guard); the block has `data.with_others` or 2 or more attendees, or Google
  itself now shows someone else on it (checked live before every write); the block or the new
  time has already started; it is an all day event.
- Undo: a moved block goes back to its original time and title; a created block is deleted, and
  only if Google still marks it as Michael's. Allowed until the earliest of `undo_until`, the
  block's original start and its new start; afterwards `409`. Undo of anything not `done` is `409`.
- What was changed is kept on the recommendation (`execution`, internal, never returned).
- `block_mac_app` creates a focus guard (below). A window that has begun starts now; `409` when it
  has already ended or names an app off the allowlist, `400` over 12 hours. Undo deletes the guard
  at once and is allowed until the window ends (not until it starts).

#### Offers for checklist and count goals (#238)

Two rules of Michael's own (`apps/api/src/checklist/offers.ts`) store recommendations with a
`create_focus_block` action, `source: "analysis"`, no analysis run. They are offers: never carried
out until the user taps execute. A slot is only offered outside the time a standing instruction
protects (exceptions by title apply), so on a clear Sunday there is no offer at all. Each still goes
through the store's `createRecommendation`, so the instruction guard has the last word.

- **First outcome:** the first open checklist item of today gets one hour, the first free one from
  now inside the waking day, titled with the item's text. Title
  `An hour for your first outcome, Fri 13 Nov`. Checked after an item is added (`POST
  /v1/checklist`, `add_checklist_item`) and on `GET /v1/score` for the current week.
- **Behind pace:** a count goal with `left > days_left` gets one slot, the first free one from now
  on a day without a block of the goal yet, as long as the goal's usual block this week (60
  minutes without one), titled with the goal's first `calendar_titles` entry so it counts. Title
  `One more session for <goal>, Fri 13 Nov`. Checked on `GET /v1/score` for the current week.
- **Once a day:** an offer whose title is already stored, whatever its status, is not made again.

### Calendar blocks (edit the day on the Timeline, #271)

The user adds, moves, resizes, renames, gives a goal to, or removes blocks on their own time. Each
write is stored as a recommendation with `source: "user"` and carried out at once by the same
executor as Michael's actions, so the same rules hold: never an event with other people (`409`),
nothing that has started (`409`), and only blocks made in Michael can be removed (the user's own
events are never deleted). With Google Calendar connected the change is made there and mirrored;
without it, the block lives on the timeline (`source: "agent"`, `data.michael: true`). Standing
instructions bind Michael, not the user, so they do not refuse these. `source: "user"`
recommendations are left out of `GET /v1/recommendations` and the MCP `list_recommendations`.

| Method | Path             | Body                                                   | Response                          |
| ------ | ---------------- | ------------------------------------------------------ | --------------------------------- |
| POST   | `/v1/blocks`     | `BlockCreate { start_at, end_at, title?, goal_id? }`   | `201 BlockChange`                 |
| PATCH  | `/v1/blocks/:id` | `BlockUpdate { start_at?, end_at?, title?, goal_id? }` | `200 BlockChange`                 |
| DELETE | `/v1/blocks/:id` |                                                        | `200 BlockChange` (`event: null`) |

```ts
type BlockChange = {
  event: Event | null; // the block as it is now
  recommendation_id: string; // POST /v1/recommendations/:id/undo takes the change back
  undo_until: string; // until the block starts
};
```

- A block is 5 minutes to 12 hours; a new start without an end keeps the length. `goal_id: null`
  clears the goal. The goal is saved as `data.goal_id` (and `extendedProperties.private.goal_id` in
  Google, read back by the sync), so the score counts the block for it.
- `404` unknown block or goal, `409` refused (with Michael's reason), `400` invalid body.
- Demo visitors may use these routes on the demo week, like acting on a recommendation.

### Focus guards (block Mac apps, #41)

```ts
type FocusGuard = {
  id: string;
  recommendation_id: string | null;
  apps: string[]; // allowlisted names, e.g. ["WhatsApp"]
  bundle_ids: string[]; // every Mac bundle id those names map to
  start_at: string;
  end_at: string;
  goal_id: string | null;
  back_to: string | null; // "Back to The company."
  created_at: string;
};
type FocusGuardsResponse = { now: string; off_the_record: boolean; guards: FocusGuard[] };
```

| Method | Path                       | Response                                                         | Status |
| ------ | -------------------------- | ---------------------------------------------------------------- | ------ |
| GET    | `/v1/focus-guards/active`  | `200 FocusGuardsResponse`: running now or starting in 10 minutes | live   |
| POST   | `/v1/focus-guards/suggest` | `201 { recommendation }` or `200 { recommendation: null }`       | live   |

- Executing a `block_mac_app` recommendation creates a guard; undoing it deletes the guard.
- `/active` is the one read a device key may make (the Mac collector polls it every 30 to 60 s).
  While the user is off the record it answers `off_the_record: true` and no guards, and the
  collector does nothing.
- Only apps in `BLOCKABLE_MAC_APPS` (`packages/shared/src/mac-apps.ts`: chat, social, music, video
  and games, for example WhatsApp, Telegram, Messages, Slack, Discord, Mail, Instagram, X, Spotify,
  Music, TV, Netflix, Steam) can be named. System apps, terminals, Claude and Michael can never be
  closed; the collector checks the list again before it acts.
- The collector reads the front app with `lsappinfo` (no permission), closes a muted app with
  AppleScript `quit` by bundle id (like Cmd+Q; macOS asks once per app for Automation), hides it if
  quitting is not allowed, and shows "Instagram is off until 12:00. Back to The company." at most
  once a minute per app.
- `/suggest` proposes muting the week's worst Mac offender (`repeat_offenders`, allowlisted apps
  only) during today's next work block, or the next two hours between 08:00 and 18:00 when there is
  no block: "Mute WhatsApp 14:00 to 16:00", rationale "... took 47 min.". It is a `proposed`
  recommendation (`source: "analysis"`); nothing happens until Do it. Not repeated while an open one
  for the same app has not ended.

### Follow up drafts

After a conversation (Omi: summary and the user's own commitments) or a calendar meeting with other
people that has ended, Michael drafts a short follow up for the user to copy and send themselves.
Michael never sends it: no mail or chat integration exists. Only the event's title, time, size,
summary and the user's commitments go to Claude; no transcript is stored or sent.

```ts
type Draft = {
  id: string;
  event_id: string | null; // the conversation or meeting (timeline event id)
  recommendation_id: string | null; // set when it came from a carried out draft_follow_up
  title: string; // the event's title
  event_at: string | null; // the event's start
  channel: DraftChannel; // email | chat
  subject: string | null; // email subject; null for chat
  body: string; // about 90 words at most, British spelling, no emoji, no dashes
  written_by: DraftAuthor; // model (Claude) | template (no key, model failed, demo week) | analysis
  status: DraftStatus; // proposed -> done (the user sent it) | dismissed
  created_at: string;
  updated_at: string;
};
type DraftGenerateResult = { drafts: Draft[]; skipped: number }; // skipped: already had a draft
```

| Method | Path                         | Body                      | Response                                        | Status |
| ------ | ---------------------------- | ------------------------- | ----------------------------------------------- | ------ |
| GET    | `/v1/drafts?status=proposed` |                           | `200 { drafts: Draft[] }`, newest first (≤ 100) | live   |
| POST   | `/v1/drafts/generate`        | `{ event_id?: string }`   | `201 DraftGenerateResult`; `404`, `409`         | live   |
| PATCH  | `/v1/drafts/:id`             | `{ status: DraftStatus }` | `200 Draft`, `404`                              | live   |

- Without `event_id` (or with no body), `generate` drafts every conversation and every meeting with
  other people (2 to 10 attendees, not all day, not cancelled) that ended in the last 24 hours and
  has no draft yet, newest first, at most 3. A meeting overlapped by a recorded conversation is
  left to the conversation's draft. One draft per event, ever: generating again never duplicates.
- With `event_id`: `404` when it is not on the timeline, `409` when it has not ended or is not a
  conversation or meeting with others.
- Claude writes the words (`ANTHROPIC_API_KEY`); without a key, or if the model fails, a plain
  template writes them from the summary and commitments. The scheduler drafts what ended in the
  last 2 hours for active users. The demo week carries template drafts for its two latest
  conversations.
- MCP: `list_drafts`, `draft_follow_up` (scope `recommendations`). Chat: the `draft_follow_up` tool.
- Web: one "Follow ups" row under "More from Michael" on Today, with Copy, Done and Not now.

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

**Coming back somewhere else.** The connect call takes an optional body
`OAuthConnectRequest = { return_to?: ReturnPath }`, where `ReturnPath` is a path on the web app
(`/onboarding?step=done`): it must start with one `/`, never `//` or `/\`, no scheme, at most 200
characters, otherwise `400`. It is signed into `state`, and the callback then redirects to
`${WEB_URL}<return_to>` with the same `connected` or `integration_error` parameters added. Without
it, or when the state is unreadable, the callback goes to `/you`. The web app passes it as
`/integrations/google/connect?return_to=...`. A `return_to` under `/onboarding` skips the first sync
and adds `sync=pending`: onboarding then calls `POST .../sync?past_days=28` itself, behind a
"Reading your calendar" status line, so nobody waits on Google's page.

**Sync.** Pulls the primary calendar, now minus 7 days to now plus 7 days, recurring events expanded,
into `calendar_event` events with `source: "google_calendar"` and `external_id` = Google's event id.
Idempotent: unchanged events are left alone, changed ones (title, time) are updated in place, and
mirrored events that were deleted or cancelled in Google within the window are removed from the
timeline (the calendar itself is never touched). Cancelled and declined events are skipped. Runs
after connecting, on `POST .../sync` (optional `?past_days=1..28` reads further back; `400` outside
that), and every `CALENDAR_SYNC_MINUTES` (default 15) for every
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

### Sources status

```ts
type SourceStatus = {
  source: Source;
  enabled: boolean; // the privacy switch, as GET /v1/privacy shows it
  collecting: boolean; // would ingest store its events right now
  last_event_at: string | null;
};
type SourcesStatusResponse = { off_the_record: boolean; sources: SourceStatus[] };
```

| Method | Path                 | Response                    | Status |
| ------ | -------------------- | --------------------------- | ------ |
| GET    | `/v1/sources/status` | `200 SourcesStatusResponse` | live   |

Every source, always. `enabled` is the privacy switch (as in `GET /v1/privacy`). `collecting` is
what ingest would do now: `false` while off the record or once the user switched the source off,
`true` for a source never decided on (its first event is the opt in). `last_event_at` is
when Michael last received a new event from that source (the event's `created_at`), or `null` if it
never sent one. An event that arrives again unchanged does not move it. The web app's Connections
rows on You read it to say "Last data 12 min ago". Code: `apps/api/src/routes/sources.ts`.

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
API key get `403 forbidden`. A device key acts for its owner and can only send data:
`POST /v1/events`, `POST /v1/events/batch` and `POST /v1/webhooks/*`, plus one read,
`GET /v1/focus-guards/active`, so the Mac collector can enforce focus guards
(`Authorization: Bearer mk_...`, or `?key=mk_...` on webhooks). Anything else, including other
reads, `/mcp` and every credential route, returns `403`. One key per device
(Mac collector, Health Auto Export). Only the sha256 is stored. The web app makes them under
You > Connections (Mac, Apple Watch). Claude connects with MCP OAuth instead (no key).

### One tap setup (setup tokens, #120)

A setup token (`ms_...`) is short lived (30 minutes), single use and can do one thing: be swapped
for a device key for one connection. It is what a QR code, the Mac install line or a downloaded
`Michael.command` carries, so a long lived key never sits in a URL, a shell history or a Downloads
folder. Only the sha256 is stored (`setup_tokens`).

```ts
type SetupConnection = "mac" | "apple-watch" | "iphone";
type SetupTokenCreate = { connection: SetupConnection };
type SetupTokenCreated = {
  token: string; // "ms_...", shown once
  connection: SetupConnection;
  expires_at: string;
  setup_url: string; // `${web}/setup/${connection}#${token}`: the token rides in the fragment
  install_command: string | null; // mac only: `curl -fsSL ${api}/v1/setup/mac.sh | bash -s -- ms_...`
};
type SetupTokenExchange = { token: string };
type SetupTokenExchanged = { connection: SetupConnection; secret: string /* "mk_..." */; api_url: string };
```

| Method | Path                        | Auth           | Body                 | Response                                       | Status |
| ------ | --------------------------- | -------------- | -------------------- | ---------------------------------------------- | ------ |
| POST   | `/v1/setup-tokens`          | signed in only | `SetupTokenCreate`   | `201 SetupTokenCreated`; `403` for keys        | live   |
| POST   | `/v1/setup-tokens/exchange` | none           | `SetupTokenExchange` | `200 SetupTokenExchanged`, `401` used/expired  | live   |
| GET    | `/v1/setup/mac.sh`          | none           |                      | `200` the Mac installer (`text/x-shellscript`) | live   |

- The exchange marks the token used in the same statement that reads it, so it works once even
  when two devices race. Unknown, used and expired tokens get the same `401`. The new key is named
  for the connection (`Mac collector`, `Health Auto Export`, `iPhone Shortcuts`) and is ingest only,
  like any device key.
- `GET /v1/setup/mac.sh` holds no secret; the token comes in as its argument. Without admin rights
  it uses the Mac's Node.js 22.13+ or downloads the official build into `~/.michael/node` (SHA-256
  checked), downloads `apps/collector` and `packages/shared` from the public repo
  (`COLLECTOR_REPO`, `COLLECTOR_REF`), swaps the token, writes the key to `~/.michael/michael.env`
  (mode 600), adds `~/.michael/Michael.command` and a login item, points to Full Disk Access when
  Terminal lacks it, and starts the collector.
- The web app uses the same endpoints for every device. On the device itself (iPhone) it mints and
  swaps at once and opens the app with the key: Health Auto Export's `com.HealthExport://automation`
  deep link (URL, `Authorization` header, metrics, cadence all filled), or the Michael shortcut via
  `shortcuts://run-shortcut`. From a computer it shows a QR code of `setup_url`.

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
  fixed_titles: string[]; // calendar titles Michael never moves ("PT session"); default []
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
  day?: TravelDayPlan | null; // only with whole_day: true
};
type TravelLeg = { depart_at: string; minutes: number };
type TravelDayDrive = {
  from: string;
  to: string;
  to_event_id: string | null; // null: the drive home at the end of the day
  before: TravelLeg | null; // the day as it stands
  after: TravelLeg | null; // with Michael's moves
};
type TravelDayPlan = {
  day: string; // "YYYY-MM-DD", Europe/Athens
  before_minutes: number; // on the road as the day stands
  after_minutes: number; // with the moves
  won_minutes: number;
  moves: { event_id: string; title: string; from_start_at: string; start_at: string; end_at: string }[];
  drives: TravelDayDrive[];
  recommendation_id: string | null; // the one recommendation, when the day wins 10 minutes or more
  note: string | null; // why there is nothing to propose ("Save your home first, ...")
};
type AddressMatch = { formatted_address: string; place_id: string | null; lat: number; lng: number };
type AddressSearchResponse = { results: AddressMatch[]; maps_available: boolean };
```

| Method | Path                     | Body                                  | Response                       | Status |
| ------ | ------------------------ | ------------------------------------- | ------------------------------ | ------ |
| GET    | `/v1/places`             |                                       | `200 PlacesResponse`           | live   |
| PUT    | `/v1/places`             | `{ places: PlaceInput[] }` (max 20)   | `200 PlacesResponse`           | live   |
| GET    | `/v1/places/search?q=`   |                                       | `200 AddressSearchResponse`    | live   |
| GET    | `/v1/places/suggestions` |                                       | `200 PlaceSuggestionsResponse` | live   |
| POST   | `/v1/travel/plan`        | optional `{ from?, to?, whole_day? }` | `200 TravelPlanResult`         | live   |

```ts
type PlaceSuggestion = {
  key: string | null; // "gym", "work", "university", "home" when the name or use says so
  label: string;
  lat: number | null;
  lng: number | null;
  count: number; // Maps searches, places and directions that mentioned it
  last_seen_at: string;
};
type PlaceSuggestionsResponse = { enabled: boolean; suggestions: PlaceSuggestion[] };
```

- `GET /v1/places/suggestions` offers places the user looked up in Google Maps (chrome `search`
  events with `data.maps`) at least twice in the last 30 days, at most 5, most looked up first.
  Generic searches ("near me", "open now") and places already saved (same name, or within 200 m)
  are left out. `key` comes from the name (gym, university, office) or, for `home`, from where
  directions most often start. Nothing is ever saved: the user picks one and saves it with
  `PUT /v1/places`. With source `maps` off, `enabled` is `false` and the list is empty.

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
- `GET /v1/places/search?q=` geocodes what the user types on the server (up to five matches; under
  three characters, none). Without a key: `{ results: [], maps_available: false }`, and places are
  still saved from the typed address.
- `POST /v1/travel/plan` with `whole_day: true` plans the day `from` falls on (default today) as a
  whole (#155). The drives go on the timeline as above, without per block suggestions. Then, from
  home at the start to home at the end, it searches new start times for the movable blocks (two
  hours earlier to three hours later, in 30 minute steps; every combination up to 1,500, else one
  block at a time) that spend the fewest minutes on the road. A block is movable only when it is
  the user's own (no other attendees), has a physical location, has not started, is not marked
  `data.fixed: true` and its title is not in `profile.fixed_titles`. Meetings with other people never
  move. A moved block keeps its length, never overlaps another event and stays outside quiet hours;
  standing instructions "home by 21:00" and "keep Sundays clear" are respected. At most 60 Routes
  calls per plan. When the day wins 10 minutes or more it proposes ONE recommendation, "Plan today
  around traffic: win 35 minutes", with a `move_calendar_blocks` action (`{ moves: [{ event_id,
  start_at, end_at, from_start_at, title }], before_minutes, after_minutes, won_minutes, drives }`),
  `undo_until` the earliest original or new start, tied to the goal of the first moved block. The
  MCP tool `plan_travel` takes `whole_day` too. Code: `integrations/day-plan.ts` (pure planner).
- Without `GOOGLE_MAPS_API_KEY` the status is `maps_unavailable` and nothing is computed (with
  `whole_day`, `day.note` says maps need setting up); without the opt in it is `travel_off`. Code: `apps/api/src/integrations/maps.ts` (Geocoding, Routes
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
  recommendation_id?: string | null; // a change the agent made, carried by this recommendation
  undo_until?: string | null; // until when POST /v1/recommendations/:id/undo still works
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
  `update_goal`, `propose_goals`, `get_checklist`, `add_checklist_item`, `set_day_outcomes`, `log_day` = `goals`; `list_recommendations`, `update_recommendation`, `get_nudges`,
  `list_drafts`, `draft_follow_up` = `recommendations`; `get_score`, `get_records`, `get_moments` = `score`; `add_event`, `execute_recommendation`,
  `undo_recommendation`, `create_focus_block`, `block_mac_app`, `plan_travel` = `write_events`;
  `suggest_app_mute` = `recommendations`; `get_memories` = `timeline`; `remember` = `write_events`.
  Memories are events of type `memory` (source `manual` from chat, `agent` from MCP); Michael's
  chat reads the newest 40 into every answer and keeps new ones with its own `remember` and
  `forget_memory` tools (`apps/api/src/memory.ts`). A tool not in that
  list needs `timeline` if it is read only, else `write_events` (`apps/api/src/mcp-guard.ts`).
- `queries`: `from` defaults to local midnight today (Europe/Athens), `to` to now; newest first,
  at most 500.
- A change an agent made (`execute_recommendation`, `create_focus_block`, `block_mac_app`) carries
  `recommendation_id`. `undo_until` is set while that change can still be undone (the
  recommendation is `done` and its block has not started; a mute: has not ended), else `null`. The
  Agents screen shows Undo next to the line and calls `POST /v1/recommendations/:id/undo`.

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

| Kind             | When                                                                                                                         | Example                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `focus_drift`    | inside a work goal block, 3+ of the last 10 min on distractor apps or sites                                                  | "6 min on Instagram in your focus block. Back to it until 12:00."     |
| `block_soon`     | a goal block starts in 2 to 15 min                                                                                           | "Gym at 18:00. Wrap up in 12 min."                                    |
| `morning`        | after the night's sleep (never a nap) ends today, else from 08:00; until 12:00                                               | the Morning moment's headline, e.g. "Today holds 2h 00 of goal time." |
| `evening`        | an hour before the usual bedtime (median of 3+ of the last 8 nights), else 21:00; never later than 45 min before quiet hours | the Evening moment's headline                                         |
| `wind_down`      | 30 min before the night, 3+ of the last 10 min on screens, a rest goal exists                                                | "Screens off by 22:00. Sleep is on the plan."                         |
| `goal_behind`    | before 19:00, a weekly budget behind its linear pace by 60+ min and 15%+                                                     | "Gym 2h 34m behind this week. Book 90 min today."                     |
| `recovery_block` | a recovery offer (see Recommendations, Recovery offers) not yet nudged, while its slot is ahead; ranked after `block_soon`   | "Meetings ate the block. Take 25 minutes at 16:00. Still counts."     |

`morning` and `evening` carry the Morning and Evening moments (`GET /v1/moments/:kind`, template
headline, no model): the headline when it is under 15 words, else its first sentence, else a shorter
line from the same numbers; `reason` holds the maths and when it was sent. Their key is the kind, so
each goes out at most once a day, and they count toward the 5. The push opens Today (`url: "/"`).
The night's quiet hours come from the profile (`quiet_hours`, default 22:00 to 07:00).

Goal time spent this week = the goal's calendar blocks so far plus its own events (`work`:
`focus_session`, `gym`: `workout`, `rest`: `sleep`, `food`: `meal`), counted once. Rules: at most 5
per day; none in quiet hours (the user's `Profile.quiet_hours`, default 22:00 to 07:00, which also
sets when `wind_down` speaks; dinner 20:00 to 21:00; work goal blocks except
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
  Count and checklist goals also read the week's checklist items and the check in answers (see
  "Count goals" below); neither changes a minute of the time score.

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
  areas: ScoreWeekArea[]; // the week per category, with target and floor; they add up to the week
  days: ScoreDay[]; // Monday to Sunday
  day: ScoreDayDetail; // `date` in detail
  // The last instant each device reported anything. Lost time after it is not known yet (phone
  // data can arrive hours late), so a fresh score can still drop.
  data_until: { mac: string | null; iphone: string | null };
  // The week's target (see Targets): the stored one, else Michael's proposal; null until the
  // baseline is ready and nothing is stored.
  target: {
    overall_pct: number;
    areas: Record<GoalArea, number | null>;
    floors: Record<GoalArea, number>;
    status: "proposed" | "accepted";
    set_by: "michael" | "user";
  } | null;
  // True only when score_pct meets target.overall_pct AND every category with time goals meets
  // its floor. Null without a target or before anything has elapsed.
  on_target: boolean | null;
  records: PersonalRecord[]; // set in this week (achieved_on inside it), baselines included
  // Waking time left this week outside fixed calendar commitments and sleep (see below).
  free_minutes_left: number;
  // What took the week's lost time, most first: every lost stretch of the week's blocks summed by
  // app or site, in whole minutes, entries under a minute left out. Rounded one by one, so the
  // entries can add up to a few minutes off `lost_minutes`.
  lost_by: { what: string; kind: "app" | "site"; category: AppCategory; minutes: number }[];
  // Null until there is a sleep goal and sleep data this week. Sleep stays outside the score.
  sleep: { goal_minutes: number; nightly: (number | null)[] } | null; // 7 nights, Monday first
};

// The week's entry per category (Score.areas). day.areas stay plain ScoreArea.
type ScoreWeekArea = ScoreArea & {
  target_pct: number | null; // the week's target for the category; null without one or without time goals
  floor_pct: number; // default 50, editable per week
  meets_floor: boolean | null; // null without time goals or before anything elapsed; nothing elapsed in it = false
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
  minutes_left: number; // budget - spent, never below 0; 0 for a goal outside the score
  open_blocks: number; // the goal's blocks this week that have not ended (one block across midnight counts once)
  // Kind checklist only (#238): items set (open, done or dropped; a carried item counts on the day
  // it moved to) and done, on `date` and in its week. Outside the time score.
  checklist?: { today: { set: number; done: number }; week: { set: number; done: number } };
  // Kind count only (#238): "1 of 2, 3 days left". Outside the time score; the rule is below.
  count?: { done: number; target: number; left: number; days_left: number };
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
  // The longest_block record set in this block (not a baseline): the tape draws the mark at its
  // tick_index. Null when the block set none.
  record_id: string | null;
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
  // clear Sunday), less those whose `exceptions` name the block. Empty when it breaks none. It
  // never changes the block's minutes.
  instructions_broken: string[];
};
```

The zod schemas of the same names are in `packages/shared/src/schemas.ts`; `mockScore` in
`mocks.ts` is a full example (a made up Wednesday at 15:20, with a meeting, three nights of sleep and no
target yet). `WeeklyScore` and `GoalScore` stay
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

#### Count goals (#238)

Stated here and at the top of `apps/api/src/score/count.ts`; the two change together.

- **One occurrence** is any of: an own calendar block of the goal (matched as in "Which calendar
  events count towards a goal", among the count goals only) that has ended with at least half of
  it spent by the attribution rule above; a `workout` event that has ended and overlaps one of the
  goal's own blocks, names the goal in `data.goal_id`, or has a title the goal lists in
  `calendar_titles`; a check in question (see Check in, #187) answered `yes` that names the goal
  in `goal_id`, or names one of the goal's own blocks in `event_id` (the question may name the
  time goal that also lists the block). The check in takes the span of the block it asks about.
- **Dedupe:** occurrences on the same local day that overlap or are within an hour of each other
  count once. A check in with no span of its own stands for the day's session and adds one only on
  a day with no other occurrence.
- `done` = occurrences so far this week; `target` = `per_week`; `left` = target minus done, never
  below 0; `days_left` = the days of the week that have not ended yet, today included. Behind pace:
  `left > days_left`.
- One function reads the check in's shape for this (`score/check-in.ts`).
- A block that is also a block of a time goal ("Gym" on a training goal) stays in the time score
  as before and also counts as a session.

#### Free time and sleep (#117)

- **Waking day:** from the sleep goal (a health goal of kind `target`): it ends at `screens_off`
  (default 23:00) and starts `sleep_hours` later (23:00 and 7.5 hours: 06:30 to 23:00). Without a
  sleep goal with hours, 07:00 to 23:00.
- **Fixed commitments:** calendar events that are not goal blocks (anything with other people,
  and the user's own entries with no goal), inside the waking day. All day entries are left out.
- **`free_minutes_left`:** the waking day from `now` to Sunday night, minus the fixed commitments.
  Goal blocks count as free: they are where goal time goes. 0 for a week that has ended. With
  `goals[].minutes_left` this is the "The 70.3 and the degree need 23 hours this week. You have
  17." maths. The per day numbers for the Goals tab are `goals[].daily`.
- **`sleep.nightly`:** minutes slept in the night that ended on each day (`data.duration_min` when
  the source gives it), null for a night with no data and nights to come; `goal_minutes` is
  `sleep_hours x 60` (else the weekly budget over 7). Naps never count: a sleep under 3 hours that
  starts between 09:00 and 20:00 local time (`isNap` in `packages/shared/src/sleep.ts`, the same
  rule the web's Timeline uses).

### Targets

| Method | Path                                            | Response             | Status |
| ------ | ----------------------------------------------- | -------------------- | ------ |
| GET    | `/v1/targets/current?week=YYYY-MM-DD&now=<iso>` | `200 TargetResponse` | live   |
| PUT    | `/v1/targets/:week_start`                       | `200 WeeklyTarget`   | live   |

Every Monday Michael proposes the week's score target from the user's history, overall and per
category, with the maths. The user accepts it or sets their own numbers.

```ts
type WeeklyTarget = {
  week_start: string; // Monday, Europe/Athens, YYYY-MM-DD
  overall_pct: number; // 0..100
  areas: Record<GoalArea, number | null>; // target per category; null when it has no time goals
  floors: Record<GoalArea, number>; // default 50 each
  status: "proposed" | "accepted";
  set_by: "michael" | "user";
  reason: string; // one line in Michael's voice, with the maths
  basis: {
    weeks_used: number; // full weeks of history, at most 4
    median_pct: number | null;
    step: "up" | "hold" | "down" | null;
    on_target_weeks: number; // of the last 4
    heavy_week: boolean; // the calendar already shows a heavy week
  };
  created_at: string;
  updated_at: string;
};
type TargetResponse = {
  target: WeeklyTarget | null; // stored, else a fresh proposal (status "proposed", not stored)
  baseline: { ready: boolean; full_weeks: number; needed: 2; reason: string | null };
};
type TargetUpdate = {
  accept?: true;
  overall_pct?: number;
  areas?: Partial<Record<GoalArea, number | null>>;
  floors?: Partial<Record<GoalArea, number>>;
};
```

- `GET` `week` is any day of the week (default this week); `now` replays the proposal as it stood
  then. `400` on a day that is not real.
- `PUT` `week_start` must be a Monday (`400` otherwise). `{ accept: true }` stores Michael's
  proposal (or the stored target) as `accepted` and keeps `set_by`; `409` while there is nothing to
  accept. Any number makes it `set_by: "user"`, merged onto the proposal or the stored target;
  `reason` then reads "You set 75%. I proposed 83%.". `overall_pct` is required while there is no
  proposal. Stored in `weekly_targets` (one row per user and Monday, RLS on).

**The target rule** (`apps/api/src/score/targets.ts`, pure; the two change together):

- **History:** the full weeks before the target week, at most the last 4. A week is full when it
  has ended and has a score. No proposal until 2 exist; `baseline.reason` says the baseline is
  still being built ("I need two full weeks of scores before I set a target. I have one.").
- **Median** of their scores, rounded. **On target:** a past week met its stored target (overall,
  and every category with time goals at its floor); a week with no stored target is judged
  against the median (at or above your usual counts).
- **Step:** of the last 4 full weeks on target, 3 or 4 step up 5 points (3 from a median of 70,
  never over 100), 2 hold, 1 or none step down 3. The last two full weeks both missed step down 3
  whatever the count; when both had stored targets the reason starts "My target was too high."
- **Heavy week:** the week's fixed commitments (above) are at least 20% and 3 hours over the
  median of the full weeks: 3 more points off, said in the reason.
- **Categories:** the same rule on each category's own scores. A category with time goals but
  fewer than 2 full weeks of its own takes the overall proposal; one without time goals is null.
  Floors carry over from the latest stored target, else 50.
- **The balanced week:** `on_target` on the score is true only when the overall score meets the
  target AND every category with time goals meets its floor. A category with time goals and
  nothing elapsed in it does not meet its floor: business 91 and personal 12 is not a win.
- Example reason: "Usual week 63%. You hit 4 of the last 4, so up 5. Your week already holds 31h of
  fixed time, 11h over usual, so down 3 more. Target 65%."

### Records

| Method | Path                        | Response                                    | Status |
| ------ | --------------------------- | ------------------------------------------- | ------ |
| GET    | `/v1/records`               | `200 { records: PersonalRecord[] }`         | live   |
| POST   | `/v1/records/:id/announced` | `200 PersonalRecord` (`404` when not found) | live   |

```ts
type PersonalRecord = {
  id: string;
  type: "best_week" | "best_week_area" | "longest_block";
  area: GoalArea | null; // set for best_week_area, and for longest_block (the block's goal area)
  goal_id: string | null; // longest_block only
  value: number;
  unit: "pct" | "minutes";
  previous_value: number | null; // null for the first one, a baseline that is never announced
  achieved_on: string; // week_start for the week records, the local day for a block
  event_id: string | null; // longest_block: the calendar block it happened in
  tick_index: number | null; // longest_block: the 5 minute tick in that block where the old best was passed
  line: string | null; // Michael's one line, under 15 words; null for a baseline
  announced_at: string | null; // set once it has gone out as a nudge
  created_at: string;
};
```

- `GET /v1/records` lists the current best of each type and scope plus any not yet announced.
  `GET /v1/score` carries the records set in its week, and `record_id` on the day block where a
  block record was set.
- `POST /v1/records/:id/announced` marks one as sent (the first time only), so the nudge engine
  can deliver it once and count it as one of the day's five.
- Lines: "Best Health week since you started. 71%. Do it again.", "2h 15 on 70.3 without a break.
  Your longest block yet."

**The record rule** (`apps/api/src/score/records.ts`, pure; the two change together):

- **Kinds:** best week (the week's score), best week per category, and the longest run of verified
  5 minute ticks (`spent`) inside one goal block (minutes, across all goals). A `lost` or an
  `unverified` tick breaks the run: a block with no device data or workout to prove it (a class
  with the phone away) never sets or holds the record. Week records stay scores, where unverified
  time is already reported apart.
- **What counts:** only a week that has ended, with at least 2 hours elapsed in that scope, sets a
  week record (30 minutes at 100% would otherwise stand forever). Only a block that has ended, with
  a run of at least 15 minutes, sets a block record.
- **The first value** of a kind and scope is a baseline: the best of the history then available,
  `previous_value: null`, `line: null`, never announced.
- **A new best** is strictly greater than the stored best, on or after its day. Equal is not a
  record.
- **Where:** computed when the score is read (`GET /v1/score`, `get_score`, `GET /v1/records`), from
  the five weeks the score already holds, and written with a unique key per period and scope
  (`records.key`, insert ignoring duplicates), so a record is created once however often the
  score is read. A replay with `now` in the future never writes. Stored in `records` (RLS on).

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
Any other account gets `403 forbidden`. The reseed (and the first refresh after a deploy) also
deletes all demo visitor chat, turns off the record off, removes goals that are not in the plan
and replaces the standing instructions with the plan's (`demoInstructions`: only "Nothing between
23:00 and 07:00", so a Saturday or Sunday evening stays bookable for the live demo); every refresh deletes visitor chat
older than a day. Off the record, nothing changes. Per source switches are
not applied: on the demo account they keep real collectors out (#114). From a terminal:
`pnpm --filter @michael/api seed:demo` (or `--dry` to print the week without a database).

Generated events use exactly the titles and `data` of the real ingest paths (Health Auto Export
sleep, workouts and hourly `heart_rate`, `step_count`, `heart_rate_variability`,
`resting_heart_rate`; Omi conversations; the collector's lanes); a test compares them with the
webhook mappers. Calendar events carry `attendees` (the number of other people, 0 for the user's
own blocks), `calendar`, `location?`, `status`, `all_day`. Meals are `manual` `meal` events with
`estimated_kcal`, `protein_g`; typed notes are `manual` `note` events with `category`.

Travel in the demo is precomputed (`apps/api/src/demo/travel.ts`), never asked of Google: five
neighbourhood level places (saved when the account has none), some blocks with a location (the
place is part of the calendar event's `external_id`), a `maps` `travel` event per drive with a
simple Athens rush hour model (in `TravelData.calendar_event_id` the calendar event's external id),
and one "Leave at 19:15 instead of 18:30, win 20 minutes" style `reminder` recommendation for the
next drive today or tomorrow that leaving later makes shorter.

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

| Method | Path                       | Body                 | Response                                                        |
| ------ | -------------------------- | -------------------- | --------------------------------------------------------------- |
| GET    | `/v1/connect/requests/:id` |                      | `200 ConnectRequest`, `404` when expired or answered            |
| POST   | `/v1/connect/requests/:id` | `{ allow: boolean }` | `200 { redirect_to }` (back to the client), `401`, `404`, `409` |

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

A request stays answerable for 30 minutes, long enough for a first Google sign in on the way. A
`401` on allow means the caller's sign in outlived its account (a deleted account's token still
verifies locally until it expires): the request stays pending, and the web app signs out and sends
the person to sign in again, back to the same consent page.

### Tools

Every tool answers with short, human readable text first (24 hour Europe/Athens time, the numbers
that matter and the ids for the next call) and the same facts as `structuredContent`. Times the
model writes (`TimeInput`) are `YYYY-MM-DDTHH:MM` in Europe/Athens wall time, or ISO 8601 with an
offset. A refused or failed call returns `isError: true` with one plain sentence saying why
(`HttpError` messages, validation issues listed). Scope per tool: see "Michael for agents".

| Tool                     | Scope             | Input                                                                                   | `structuredContent`                                                                        |
| ------------------------ | ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `get_timeline`           | `timeline`        | `{ date?: LocalDay, from?: TimeInput, to?: TimeInput, source?, type? }` (default: 24 h) | `{ from, to, count, truncated, events: Event[] }` (≤ 500)                                  |
| `get_goals`              | `goals`           | `{ active_only?: boolean }` (default true)                                              | `{ goals: Goal[] }`                                                                        |
| `get_instructions`       | `goals`           | `{ active_only?: boolean }` (default true)                                              | `{ instructions: Instruction[] }` (standing instructions)                                  |
| `propose_goals`          | `goals`           | `{}`                                                                                    | `{ suggestions: GoalSuggestion[] }`                                                        |
| `get_score`              | `score`           | `{ date?: LocalDay }` (default today)                                                   | `Score` without `day.blocks[].ticks` (target, verdict, records, free time, sleep included) |
| `get_records`            | `score`           | `{}`                                                                                    | `{ records: PersonalRecord[] }` (as `GET /v1/records`)                                     |
| `get_patterns`           | `timeline`        | `{ from?: TimeInput, to?: TimeInput }` (default: the last 7 days)                       | `PatternReport`                                                                            |
| `get_check_in`           | `timeline`        | `{}`                                                                                    | `CheckInToday` (see Check in)                                                              |
| `answer_check_in`        | `timeline`        | `{ id: uuid, value: "yes" \| "no" \| 1..5 \| string }`                                  | `CheckInAnswerResponse`                                                                    |
| `list_recommendations`   | `recommendations` | `{ status?: RecommendationStatus }`                                                     | `{ recommendations: Recommendation[] }`                                                    |
| `get_nudges`             | `recommendations` | `{ date?: LocalDay }` (default today)                                                   | `{ day, nudges: Nudge[] }`                                                                 |
| `get_moments`            | `score`           | `{ kind?: MomentKind }` (default morning before 15:00 local, evening after)             | `Moment`                                                                                   |
| `get_memories`           | `timeline`        | `{}`                                                                                    | `{ memories: { id, text, at, from: "chat" \| "agent" }[] }` (newest first, at most 40)     |
| `remember`               | `write_events`    | `{ fact: string (1..280) }`                                                             | `{ memory }` (same fact twice is kept once; `null` when off the record)                    |
| `add_event`              | `write_events`    | `EventInput`                                                                            | `{ inserted, duplicates, ignored, events: Event[] }`                                       |
| `add_goal`               | `goals`           | `{ category, title, description?, weekly_budget_minutes?, target? }`                    | `{ goal: Goal }`                                                                           |
| `update_goal`            | `goals`           | `{ id, category?, title?, description?, weekly_budget_minutes?, target?, active? }`     | `{ goal: Goal }`, error when not found                                                     |
| `get_checklist`          | `goals`           | `{ date?: LocalDay }` (default today)                                                   | `ChecklistResponse` (as `GET /v1/checklist`)                                               |
| `add_checklist_item`     | `goals`           | `{ goal_id, text, date?: LocalDay }` (default today)                                    | `{ item: ChecklistItem }`; refused past three open items                                   |
| `set_day_outcomes`       | `goals`           | `{ outcomes: [{ text, goal_id?, estimate_minutes? }] }` (1..3)                          | `RitualToday` (as `POST /v1/ritual/morning`)                                               |
| `log_day`                | `goals`           | `{ results: [{ item_id, result: "done" \| "partly" \| "not", carry?, minutes? }] }`     | `RitualEveningResponse`; text is the evening line                                          |
| `update_recommendation`  | `recommendations` | `{ id, status: "accepted" \| "dismissed" }`                                             | `{ recommendation }`; a `done` one is refused (undo it)                                    |
| `execute_recommendation` | `write_events`    | `{ id }`                                                                                | `{ recommendation, undo_until }`                                                           |
| `undo_recommendation`    | `write_events`    | `{ id }`                                                                                | `{ recommendation }`                                                                       |
| `create_focus_block`     | `write_events`    | `{ start: TimeInput, end: TimeInput, title?, goal_id? }`                                | `{ recommendation, undo_until }`                                                           |
| `block_mac_app`          | `write_events`    | `{ apps: string[], start?: TimeInput, end: TimeInput, goal_id? }` (start default now)   | `{ recommendation, undo_until }`                                                           |
| `suggest_app_mute`       | `recommendations` | `{}`                                                                                    | `{ recommendation }` or `{}` when nothing stands out                                       |
| `plan_travel`            | `write_events`    | `{ from?, to? }` (default today)                                                        | `TravelPlanResult` (see Places and travel)                                                 |
| `list_drafts`            | `recommendations` | `{ status?: DraftStatus }` (default proposed)                                           | `{ drafts: Draft[] }`                                                                      |
| `draft_follow_up`        | `recommendations` | `{ event_id? }` (default: what ended in the last 24 h)                                  | `DraftGenerateResult`                                                                      |

- `execute_recommendation` / `undo_recommendation` call the same functions as
  `POST /v1/recommendations/:id/execute` and `/undo` (`apps/api/src/actions/calendar.ts`), with the
  same rules: own time only, never an event with other people, never deletes the user's events,
  undo until the block starts.
- `create_focus_block` books straight away: it saves a recommendation (`source: "chat"`, `status: "done"`, rationale
  "Booked at your request through <agent name>") and carries it out like any other, so the block
  shows in Michael and `undo_recommendation` takes it back. Refused in the past, under 5 minutes,
  over 6 hours, or when it overlaps an event with other people.
- `block_mac_app` mutes straight away the same way (`source: "chat"`, `status: "done"`, see Focus
  guards); `undo_recommendation` lets the apps open again until the window ends. Apps off the
  allowlist are refused. `suggest_app_mute` only proposes.
- `draft_follow_up` stores drafts for the user to copy (see "Follow up drafts"); it never sends.
- No tool deletes anything, sends anything in the user's name, or touches an event with other
  people. Goals are paused with `update_goal { active: false }`, never deleted.
- `get_recommendations` was renamed `list_recommendations`.

Status: all `live` (Supabase in production, in-memory locally without Supabase keys).
