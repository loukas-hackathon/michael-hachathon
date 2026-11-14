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
  - Collectors, webhooks and the demo Claude connector: the shared secret `API_KEY`, which acts as
    the demo account (`demo@michael.app`). Per-user ingest tokens come later.
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

| code              | HTTP                                                |
| ----------------- | --------------------------------------------------- |
| `bad_request`     | 400 (validation errors put zod issues in `details`) |
| `unauthorized`    | 401                                                 |
| `forbidden`       | 403 (agent lacks scope or is not approved)          |
| `not_found`       | 404                                                 |
| `conflict`        | 409                                                 |
| `not_implemented` | 501                                                 |
| `upstream_error`  | 502 (WHOOP, Google, Gemini, Omi failed)             |
| `internal`        | 500                                                 |

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
- `NudgeKind`: `focus_drift | block_soon | wind_down | goal_behind`; `NudgeSkip`: `nothing_to_say | quiet_hours | daily_cap | too_soon | off_the_record`
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
  target: Record<string, unknown> | null; // e.g. { "sleep_hours": 7.5 }
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
| `/v1/webhooks/health-auto-export` | Health Auto Export iOS app                                 | `sleep`, `workout`, `biometric` |
| `/v1/webhooks/ios-shortcuts`      | iPhone Shortcuts automations (app open/close)              | `app_usage`                     |
| `/v1/webhooks/activitywatch`      | local sync script reading the ActivityWatch API on the Mac | `app_usage`, `focus_session`    |
| `/v1/webhooks/claude-code`        | Claude Code `type: "http"` hooks (**live**)                | `ai_prompt`, `notification`     |

The exact provider payload for each is documented in the issue that implements it, then copied here.

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

Which goal a calendar block belongs to (provisional, until tagging has its own contract in #37):
`data.goal_id` names a goal; else `data.goal_category` or `data.category` names a goal category;
else the title starts with a category word (`Gym: legs`, `Work: pitch`) or contains `deep work` or
`focus` (work). Events with `data.attendees` of 2 or more are meetings and are never focus blocks.

Summaries follow the voice basics (numbers first, British spelling, 24 hour time, no dashes). They
name apps; a site is named only if its host is on the shared public list, otherwise it is "a
travel site" or "an uncategorised site". Structured `data` carries the host for the user's own view.

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
| GET    | `/v1/privacy`                 |                               | `200 PrivacyState`  | stub   |
| PUT    | `/v1/privacy/off-the-record`  | `{ off_the_record: boolean }` | `200 PrivacyState`  | stub   |
| PATCH  | `/v1/privacy/sources/:source` | `{ enabled: boolean }`        | `200 SourceSetting` | stub   |

Sources are opt-in (disabled by default). While off the record, or for a disabled source, ingest
drops events and counts them in `ignored`.

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

### Nudges and score

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
  sent_today: number; // nudges today that count towards the cap (all but suppressed)
};
type GoalScore = { goal_id: string; budget_minutes: number; planned_minutes: number; spent_minutes: number };
type WeeklyScore = {
  week_start: string;
  planned_minutes: number;
  spent_minutes: number;
  score_pct: number;
  time_won_back_minutes: number;
  goals: GoalScore[];
};
```

| Method | Path                        | Response                                                                | Status |
| ------ | --------------------------- | ----------------------------------------------------------------------- | ------ |
| GET    | `/v1/nudges?from=&to=`      | `200 { nudges: Nudge[] }` (default: today, Europe/Athens, oldest first) | live   |
| POST   | `/v1/nudges/check`          | `200 NudgeCheckResult` (runs the engine once, no body)                  | live   |
| GET    | `/v1/score?week=YYYY-MM-DD` | `200 WeeklyScore` (week starts Monday, Europe/Athens)                   | stub   |

Nudge engine (`apps/api/src/nudges/engine.ts`, pure, thresholds in `LIMITS`). Each check picks the
most urgent candidate of four rules, each tied to a goal:

| Kind          | When                                                                          | Example                                                           |
| ------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `focus_drift` | inside a work goal block, 3+ of the last 10 min on distractor apps or sites   | "6 min on Instagram in your focus block. Back to it until 12:00." |
| `block_soon`  | a goal block starts in 2 to 15 min                                            | "Gym at 18:00. Wrap up in 12 min."                                |
| `wind_down`   | 30 min before the night, 3+ of the last 10 min on screens, a rest goal exists | "Screens off by 22:00. Sleep is on the plan."                     |
| `goal_behind` | before 19:00, a weekly budget behind its linear pace by 60+ min and 15%+      | "Gym 2h 34m behind this week. Book 90 min today."                 |

Goal time spent this week = the goal's calendar blocks so far plus its own events (`work`:
`focus_session`, `gym`: `workout`, `rest`: `sleep`, `food`: `meal`), counted once. Rules: at most 5
per day; none in quiet hours (22:00 to 07:00, dinner 20:00 to 21:00, work goal blocks except
`focus_drift`); one key once per local day (`goal_behind` once per day in all); at least 20 min
between nudges. Once 5 went out, the best candidate is stored as `suppressed` (once per key). Off
the record stops all nudges. Delivery is pluggable (`apps/api/src/nudges/channels.ts`); until a
real channel is plugged in, nudges are logged and stay `queued`. Nothing calls the check on a
schedule yet: call it from a cron, the collector or the app.

## MCP server

Streamable HTTP at `POST /mcp` (stateless, JSON responses). Auth: `Authorization: Bearer <API_KEY>`.

| Tool                  | Input                                                   | Output (JSON text content)                                                   |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `get_timeline`        | `{ from?, to?, source?: Source[], type?: EventType[] }` | `{ from, to, events: Event[] }`                                              |
| `get_goals`           | `{ active_only?: boolean }` (default true)              | `{ goals: Goal[] }`                                                          |
| `get_recommendations` | `{ status?: RecommendationStatus }`                     | `{ recommendations: Recommendation[] }`                                      |
| `get_patterns`        | `{ from?, to? }` (default: the last 7 days)             | `PatternReport`                                                              |
| `add_event`           | `EventInput`                                            | `{ inserted: number, duplicates: number, ignored: number, events: Event[] }` |

Status: all `live` (Supabase in production, in-memory locally without Supabase keys).
