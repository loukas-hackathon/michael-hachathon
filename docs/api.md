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
- **Auth (provisional, MVP only):** single user, one shared secret `API_KEY`.
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
  channel: NudgeChannel;
  text: string;
  status: NudgeStatus;
  created_at: string;
  sent_at: string | null;
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

| Method | Path                        | Response                                              | Status |
| ------ | --------------------------- | ----------------------------------------------------- | ------ |
| GET    | `/v1/nudges?from=&to=`      | `200 { nudges: Nudge[] }`                             | stub   |
| GET    | `/v1/score?week=YYYY-MM-DD` | `200 WeeklyScore` (week starts Monday, Europe/Athens) | stub   |

Nudges: at most 5 per day, under 15 words, none in quiet hours (deep work, dinner, after 22:00);
extra ones are stored as `suppressed`.

## MCP server

Streamable HTTP at `POST /mcp` (stateless, JSON responses). Auth: `Authorization: Bearer <API_KEY>`.

| Tool                  | Input                                                   | Output (JSON text content)                                                   |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `get_timeline`        | `{ from?, to?, source?: Source[], type?: EventType[] }` | `{ from, to, events: Event[] }`                                              |
| `get_goals`           | `{ active_only?: boolean }` (default true)              | `{ goals: Goal[] }`                                                          |
| `get_recommendations` | `{ status?: RecommendationStatus }`                     | `{ recommendations: Recommendation[] }`                                      |
| `add_event`           | `EventInput`                                            | `{ inserted: number, duplicates: number, ignored: number, events: Event[] }` |

Status: all `live` (in-memory store).
