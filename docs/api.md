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
  Send `Authorization: Bearer <API_KEY>`. Webhook senders that cannot set headers may use
  `?key=<API_KEY>`. Applies to everything under `/v1/*` and `/mcp`, except `/health` and the
  OAuth connect/callback redirects. To be replaced by real auth if we go multi-user.

### Error shape

Every non-2xx response:

```json
{ "error": { "code": "bad_request", "message": "Validation failed", "details": [] } }
```

| code              | HTTP                                                |
| ----------------- | --------------------------------------------------- |
| `bad_request`     | 400 (validation errors put zod issues in `details`) |
| `unauthorized`    | 401                                                 |
| `not_found`       | 404                                                 |
| `conflict`        | 409                                                 |
| `not_implemented` | 501                                                 |
| `upstream_error`  | 502 (WHOOP, Google, Gemini, Omi failed)             |
| `internal`        | 500                                                 |

## Types

Enums:

- `Source`: `omi | whoop | health_auto_export | ios_shortcuts | activitywatch | google_calendar | owntracks | manual | agent`
- `EventType`: `sleep | workout | recovery | biometric | app_usage | focus_session | conversation | memory | calendar_event | location | meal | note`
- `GoalCategory`: `work | gym | rest | food`
- `RecommendationStatus`: `proposed | accepted | dismissed | done`
- `ActionKind`: `move_calendar_block | create_calendar_block | draft_message | reminder`
- `AnalysisStatus`: `queued | running | succeeded | failed`
- `AnalysisTrigger`: `manual | scheduled | mcp`
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
  active: boolean;
  created_at: string;
  updated_at: string;
};
type GoalCreate = {
  category: GoalCategory;
  title: string;
  description?: string | null;
  target?: Record<string, unknown> | null;
  active?: boolean /* default true */;
};
type GoalUpdate = Partial<GoalCreate>;

type RecommendationAction = { kind: ActionKind; payload: Record<string, unknown> };
type Recommendation = {
  id: string;
  analysis_run_id: string | null;
  goal_id: string | null;
  title: string;
  rationale: string;
  action: RecommendationAction | null; // modelled, NOT executed in the MVP
  status: RecommendationStatus;
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

type Health = { status: "ok"; version: string; time: string; storage: "memory" | "supabase" };
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

`POST /v1/events` body `EventInput` → `201 { inserted: number, duplicates: number, events: Event[] }`.
A duplicate `(source, external_id)` is skipped and counted in `duplicates` (not an error).

`POST /v1/events/batch` body `{ events: EventInput[] }` (1..1000) → same response as above.

### Source webhooks

All `POST`, auth required, body is the provider's native payload. Each maps to `EventInput[]` and
ingests idempotently. Response `200 IngestResponse`. Status: all `stub`.

| Path                              | Sender                                                     | Maps to                         |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| `/v1/webhooks/omi`                | Omi app (memory created / transcript)                      | `conversation`, `memory`        |
| `/v1/webhooks/health-auto-export` | Health Auto Export iOS app                                 | `sleep`, `workout`, `biometric` |
| `/v1/webhooks/ios-shortcuts`      | iPhone Shortcuts automations (app open/close)              | `app_usage`                     |
| `/v1/webhooks/activitywatch`      | local sync script reading the ActivityWatch API on the Mac | `app_usage`, `focus_session`    |

The exact provider payload for each is documented in the issue that implements it, then copied here.

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

Changing status never executes `action` in the MVP.

### Integrations (OAuth)

| Method | Path                           | Auth                        | Response                                           | Status |
| ------ | ------------------------------ | --------------------------- | -------------------------------------------------- | ------ |
| GET    | `/v1/integrations`             | Bearer                      | `200 { integrations: Integration[] }`              | stub   |
| GET    | `/v1/oauth/:provider/connect`  | none                        | `302` to provider consent screen                   | stub   |
| GET    | `/v1/oauth/:provider/callback` | none (validated by `state`) | `302` back to web `/settings?connected=<provider>` | stub   |

`:provider` is `google_calendar` or `whoop`. Tokens are stored in the `integrations` table and are
never returned by the API. Redirect URI: `${PUBLIC_API_URL}/v1/oauth/<provider>/callback`.

## MCP server

Streamable HTTP at `POST /mcp` (stateless, JSON responses). Auth: `Authorization: Bearer <API_KEY>`.

| Tool                  | Input                                                   | Output (JSON text content)                                  |
| --------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `get_timeline`        | `{ from?, to?, source?: Source[], type?: EventType[] }` | `{ from, to, events: Event[] }`                             |
| `get_goals`           | `{ active_only?: boolean }` (default true)              | `{ goals: Goal[] }`                                         |
| `get_recommendations` | `{ status?: RecommendationStatus }`                     | `{ recommendations: Recommendation[] }`                     |
| `add_event`           | `EventInput`                                            | `{ inserted: number, duplicates: number, events: Event[] }` |

Status: all `live` (in-memory store).
