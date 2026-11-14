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
  `/health` and the OAuth connect/callback redirects. Only `/v1/webhooks/*` and `/mcp` also accept
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
| `upstream_error`  | 502 (WHOOP, Google, Gemini, Omi failed)                 |
| `internal`        | 500                                                     |

## Types

Enums:

- `Source`: `omi | whoop | health_auto_export | ios_shortcuts | activitywatch | google_calendar | owntracks | manual | agent | macos_usage | iphone_usage | chrome | claude_code`
- `EventType`: `sleep | workout | recovery | biometric | app_usage | focus_session | conversation | memory | calendar_event | location | meal | note | web_visit | search | notification | screen | ai_session | ai_prompt`
- `GoalCategory`: `work | gym | rest | food`
- `RecommendationStatus`: `proposed | accepted | dismissed | done | undone` (`done` = action executed)
- `ActionKind`: `move_calendar_block | create_focus_block | block_mac_app | draft_follow_up | reminder`
- `AnalysisStatus`: `queued | running | succeeded | failed`
- `AnalysisTrigger`: `manual | scheduled | mcp | morning | evening`
- `AgentScope`: `timeline | goals | recommendations | score | write_events`
- `AgentStatus`: `pending | approved | revoked`
- `NudgeChannel`: `watch | push | telegram`; `NudgeStatus`: `queued | sent | failed | suppressed`
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
  target: Record<string, unknown> | null; // e.g. { "sleep_hours": 7.5 }, { "calendar_titles": ["Gym", "Run"] }
  weekly_budget_minutes: number | null; // e.g. 540 = "9 hours this week"
  active: boolean;
  created_at: string;
  updated_at: string;
};
type GoalCreate = {
  category: GoalCategory;
  title: string;
  description?: string | null;
  target?: Record<string, unknown> | null;
  weekly_budget_minutes?: number | null;
  active?: boolean /* default true */;
};
type GoalUpdate = Partial<GoalCreate>;

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
  status: RecommendationStatus;
  executed_at: string | null;
  undone_at: string | null;
  created_at: string;
  updated_at: string;
};

type AnalysisRun = {
  id: string;
  status: AnalysisStatus;
  trigger: AnalysisTrigger;
  range_start: string;
  range_end: string;
  model: string;
  summary: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type Integration = {
  provider: IntegrationProvider;
  status: IntegrationStatus;
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

| Path                              | Sender                                                     | Maps to                         |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| `/v1/webhooks/omi`                | Omi app (memory created / transcript)                      | `conversation`, `memory`        |
| `/v1/webhooks/health-auto-export` | Health Auto Export iOS app (**live**)                      | `sleep`, `workout`, `biometric` |
| `/v1/webhooks/ios-shortcuts`      | iPhone Shortcuts automations (app open/close)              | `app_usage`                     |
| `/v1/webhooks/activitywatch`      | local sync script reading the ActivityWatch API on the Mac | `app_usage`, `focus_session`    |
| `/v1/webhooks/claude-code`        | Claude Code `type: "http"` hooks (**live**)                | `ai_prompt`, `notification`     |

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

#### Which calendar events count towards a goal

People do not name calendar events after their goals: "Gym", "Swimming 1,500m" and "Run" can all
mean one training goal. So a goal lists the calendar titles that count towards it, in `target`
(a free form record, so this needs no schema or database change):

```json
{ "category": "gym", "title": "70.3", "target": { "calendar_titles": ["Gym", "Swimming", "Run"] } }
```

A calendar event belongs to the goal when its title **equals an entry or starts with it**, ignoring
case, accents and extra spaces. An entry ends at a word boundary: `Run` matches `Run` and
`Run: 8 km`, not `Runway review`. Entries that are not text are skipped.

One matcher decides this for the score and for the patterns' calendar mode
(`apps/api/src/score/match.ts`). Rules, first hit wins, over the user's active goals:

1. `data.goal_id` on the event names a goal.
2. `target.calendar_titles` of a goal (the longest matching entry wins).
3. `data.goal_category` (or `data.category`) names a goal category: the first goal of that category.
4. The title starts with a goal's own title.
5. The title starts with a category word (`Gym: legs`, `Work: pitch`), or contains `deep work` or
   `focus` (work).

Rules 3 to 5 are the older provisional ones, kept as fallbacks. **An event with other people in it
is never the user's own block:** `data.attendees` is the number of other people, and any value
above 0 makes the event a meeting, whatever its title or `goal_id` says. Each block in
`GET /v1/score` carries `matched_by`, the rule that tied it to its goal.

### Analysis

| Method | Path                  | Body                                               | Response                                                                                            | Status |
| ------ | --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| POST   | `/v1/analysis/run`    | `{ from?, to? }` (default: today in Europe/Athens) | `201 { run: AnalysisRun, recommendations: Recommendation[] }`; `502 upstream_error` if Gemini fails | stub   |
| GET    | `/v1/analysis/latest` |                                                    | `200 { run, recommendations }`, `404` if none                                                       | live   |

### Patterns

| Method | Path                               | Response            | Status |
| ------ | ---------------------------------- | ------------------- | ------ |
| GET    | `/v1/patterns?from=<iso>&to=<iso>` | `200 PatternReport` | live   |

`from`, `to` optional; default is the 7 days ending now. `400` on bad dates, `to` not after `from`,
or a range over 92 days. Computed on request by pure functions in `apps/api/src/patterns` (plain
rules, no model): the same events always give the same report. Days and hours are local
(`Europe/Athens`), correct across the daylight saving change.

This is what the analysis prompt (#17) should read instead of raw events: `headlines` holds the
one line summary of every detector that had enough data, most important first.

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
`video`, `news`, `shopping`, `travel`; **neutral** = `music`, `system`, `other`.

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
  inside each `calendar_event` that belongs to a goal (see below), every off purpose visit (work
  block: distractors; any other block: distractors and work apps) is a disruption. Planned blocks
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
(`data.attendees` above 0) are meetings and are never focus blocks.

Summaries follow the voice basics (numbers first, British spelling, 24 hour time, no dashes). They
name apps; a site is named only if its host is on the shared public list, otherwise it is "a
travel site" or "an uncategorised site". Structured `data` carries the host for the user's own view.

### Chat

| Method | Path                | Body                                  | Response                                                                                                                                | Status |
| ------ | ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/v1/chat?limit=50` |                                       | `200 { messages: ChatMessage[] }` (oldest first, limit 1..100)                                                                          | live   |
| POST   | `/v1/chat`          | `{ message: string }` (1..2000 chars) | `201 { message: ChatMessage, reply: ChatMessage }`; `503 unavailable` without `ANTHROPIC_API_KEY`; `502 upstream_error` if Claude fails | live   |

The API keeps the history per user (`chat_messages`); the client sends only the new line. Michael
answers with Claude (`ANTHROPIC_MODEL`, default `claude-opus-5-5`) from a summary built in the API:
the active goals with weekly budgets, today's calendar, workout, sleep, meal and focus entries,
today's screen time totals, 7 day totals per type and the pattern headlines for today and the last
7 days, plus the last 20 lines of chat. Raw app, web and AI events are never sent, only totals, and
conversations and memories stay out. Nothing is stored when the call fails. The chat only advises;
it never changes the calendar.

### Recommendations

| Method | Path                                  | Body                               | Response                                    | Status |
| ------ | ------------------------------------- | ---------------------------------- | ------------------------------------------- | ------ |
| GET    | `/v1/recommendations?status=proposed` |                                    | `200 { recommendations: Recommendation[] }` | live   |
| PATCH  | `/v1/recommendations/:id`             | `{ status: RecommendationStatus }` | `200 Recommendation`, `404`                 | live   |

Changing status never executes `action`; use the routes below.

| Method | Path                              | Response                                                                                                                                        | Status |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| POST   | `/v1/recommendations/:id/execute` | `200 Recommendation` (`status: done`, `executed_at` set). `409 conflict` if `involves_others` (Michael never touches events with other people). | stub   |
| POST   | `/v1/recommendations/:id/undo`    | `200 Recommendation` (`status: undone`). `409 conflict` after `undo_until`.                                                                     | stub   |

Rules: act only on the user's own calendar blocks and Mac; never touch events with other people; never delete; never send in the user's name.

### Integrations (OAuth)

| Method | Path                           | Auth                        | Response                                           | Status |
| ------ | ------------------------------ | --------------------------- | -------------------------------------------------- | ------ |
| GET    | `/v1/integrations`             | Bearer                      | `200 { integrations: Integration[] }`              | stub   |
| GET    | `/v1/oauth/:provider/connect`  | none                        | `302` to provider consent screen                   | stub   |
| GET    | `/v1/oauth/:provider/callback` | none (validated by `state`) | `302` back to web `/settings?connected=<provider>` | stub   |

`:provider` is `google_calendar` or `whoop`. Tokens are stored in the `integrations` table and are
never returned by the API. Redirect URI: `${PUBLIC_API_URL}/v1/oauth/<provider>/callback`.

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
| GET    | `/v1/agents`                   |                                                         | `200 { agents: AgentClient[] }`                              | stub   |
| PATCH  | `/v1/agents/:id`               | `{ status?, scopes? }` (approve, revoke, change scopes) | `200 AgentClient`                                            | stub   |
| GET    | `/v1/agents/queries?from=&to=` |                                                         | `200 { queries: AgentQuery[] }` ("who asked about me today") | stub   |

A new agent's first MCP request registers it as `pending` and returns `forbidden` until the user
approves it. Every MCP tool call is logged as an `AgentQuery`.

### Nudges

```ts
type Nudge = {
  id: string;
  recommendation_id: string | null;
  channel: NudgeChannel;
  text: string;
  status: NudgeStatus;
  created_at: string;
  sent_at: string | null;
};
```

| Method | Path                   | Response                  | Status |
| ------ | ---------------------- | ------------------------- | ------ |
| GET    | `/v1/nudges?from=&to=` | `200 { nudges: Nudge[] }` | stub   |

Nudges: at most 5 per day, under 15 words, none in quiet hours (deep work, dinner, after 22:00);
extra ones are stored as `suppressed`.

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
  days: ScoreDay[]; // Monday to Sunday
  day: ScoreDayDetail; // `date` in detail
  // The last instant each device reported anything. Lost time after it is not known yet (phone
  // data can arrive hours late), so a fresh score can still drop.
  data_until: { mac: string | null; iphone: string | null };
};

type ScoreGoal = ScoreTotals & {
  goal_id: string;
  title: string;
  category: GoalCategory;
  scored: boolean; // false for sleep: listed with its budget, outside the score
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
};
```

The zod schemas of the same names are in `packages/shared/src/schemas.ts`; `mockScore` in
`mocks.ts` is a full example (a made up Wednesday at 15:20). `WeeklyScore` and `GoalScore` stay
exported: they are the week's part of `Score` with a `score_pct` that is never null.

#### The attribution rule

Stated here and at the top of `apps/api/src/score/score.ts`; the two change together.

- **Planned:** the user's own calendar blocks that belong to a goal (see Goals, "Which calendar
  events count towards a goal"). An event with other people in it is never a block. Where two
  blocks overlap, the earlier one keeps the time. A block that crosses local midnight is cut
  there, and each day gets its part.
- **Ahead:** planned time that has not started yet. **Elapsed:** planned time that has passed; a
  block in progress counts up to `now`.
- **Lost:** time inside an elapsed block spent in a distracting category (`communication`,
  `social`, `video`, `news`, `shopping`, `travel`) on any device. It is read from the single line
  of attention, where the phone and the Mac are already one line, so a minute is never lost twice.
- **Spent:** elapsed minus lost.
- **Verified:** the part of spent for which the data positively shows the goal. A goal of category
  `work`: attention in a work category (`work`, `ai`) inside the block. A goal of category `gym`: a
  `workout` event overlapping the block, minus the lost time inside it. Any other goal has nothing
  that could prove it.
- **Unverified:** spent minus verified: no device data there, or only neutral apps (music, the
  system, anything uncategorised). Reported apart as `unverified_minutes` and as `unverified`
  ticks; never present it as proven.
- **A block with no data at all and no workout counts as spent, all of it unverified.** Time in
  the gym or studying on paper leaves no trace on a screen, and a coach who calls a real session
  "missed" loses trust. The price: a skipped session also scores as spent until a watch or a check
  in says otherwise. `unverified_minutes` shows how much of the score rests on that.
- **Sleep is outside the score.** A goal of category `rest` whose target describes sleep (a key
  with `sleep` or `bed` in it, or a title with the word) is listed in `goals` with its budget and
  `scored: false`. It has no blocks and takes no part in any total; its minutes are 0 and mean
  nothing.
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
- **Lost stretches:** distracting intervals less than 30 seconds apart are one stretch, named after
  whatever held most of it. An app goes by its name; a site by its host only when the host is on
  the shared public list, otherwise by its category ("a travel site"). `minutes` is the time lost
  inside the stretch.

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

| Tool                  | Input                                                   | Output (JSON text content)                                                   |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `get_timeline`        | `{ from?, to?, source?: Source[], type?: EventType[] }` | `{ from, to, events: Event[] }`                                              |
| `get_goals`           | `{ active_only?: boolean }` (default true)              | `{ goals: Goal[] }`                                                          |
| `get_recommendations` | `{ status?: RecommendationStatus }`                     | `{ recommendations: Recommendation[] }`                                      |
| `get_patterns`        | `{ from?, to? }` (default: the last 7 days)             | `PatternReport`                                                              |
| `get_score`           | `{ date? }` (a local day, default today)                | `Score`                                                                      |
| `add_event`           | `EventInput`                                            | `{ inserted: number, duplicates: number, ignored: number, events: Event[] }` |

Status: all `live` (Supabase in production, in-memory locally without Supabase keys).
