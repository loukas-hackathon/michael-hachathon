# Apple Watch through Health Auto Export

Health Auto Export (iOS, Premium needed for automations, trial available) reads Apple Health on the
iPhone and posts it to Michael. It gives us sleep (with stages), workouts and hourly heart rate,
resting heart rate, HRV and steps. Apple Health has no server API, so this app is the bridge.

Watch data is health data: the source is opt in (`health_auto_export` in privacy settings).

## Set up in two taps (You > Connections, Apple Watch)

Health Auto Export has a deep link that creates a whole REST API automation
([`com.HealthExport://automation`](https://help.healthyapps.dev/en/health-auto-export/automations/deep-link)).
Michael builds two of them per user (`apps/web/lib/one-tap.ts`), so on the iPhone it is:

1. Get Health Auto Export (skip if installed; automations need Premium or the trial).
2. Tap **Add sleep and heart rate**: the app opens with the automation filled in (URL, the device
   key in the `Authorization` header, the six metrics, JSON, v2, summarised hourly, every 5
   minutes). Tap Save if it asks, and allow Health access.
3. Back in Michael, tap **Add workouts** (routes off).

What the deep link cannot do (checked against the official docs, 15 Nov): there is no import file,
QR config or "run now" parameter, and it only makes REST API automations. So the first export is
one human tap (**Export Now** in the automation) or up to five minutes of waiting with the phone
unlocked. Price, US App Store: free for 7 days, then Premium at 1.99 a month, 6.99 a year or 24.99
once (varies by country). The page says it in one line.

**Live check (#306).** Once step 2 is tapped (or the QR code is shown on a laptop), the page notes
the newest `health_auto_export` arrival from `GET /v1/sources/status`, asks again every 5 seconds
and turns to "Connected. Last data just now." when something newer arrives. After 2 minutes with
nothing it names the step to recheck (Export Now, Health access); after 10 it stops asking.

**Proving it before it is live.** While `CONNECTOR_STATUS` says `soon`, the setup page shows the
steps only with `?preview=1` (and the QR code it makes carries the preview through its setup token).
Steps in `docs/setup-manual.md`, section 7.

**Needs attention (#307).** A device connection that has sent nothing for 24 hours shows Needs
attention on You with the one fix ("Open Health Auto Export and tap Export Now on Michael health.").

The key is minted on the first tap through a setup token (`POST /v1/setup-tokens`, then the
exchange) and stays in the page's memory only. On a computer the page shows a QR code instead: the
iPhone camera opens `/setup/apple-watch#ms_...`, which works once, for 30 minutes, signed in or not.
The key is in a header, never in the webhook URL, so it stays out of request logs.

## Set up by hand (about five minutes, on the iPhone)

1. Install Health Auto Export and allow it to read Health: at least Sleep, Workouts, Heart Rate,
   Resting Heart Rate, Heart Rate Variability, Steps, Active Energy.
2. Automations, new automation, type **REST API**.
3. URL: `https://api-production-16521a26.up.railway.app/v1/webhooks/health-auto-export`
4. Headers: add `Authorization` with value `Bearer <your key>`. (If a header cannot be set, append
   `?key=<your key>` to the URL instead.) Until per-user ingest tokens exist (#114) the key is the
   shared `API_KEY` and data lands in the demo account.
5. Data type **Health Metrics**; pick the metrics above (others are dropped anyway).
   Format **JSON**, **Summarize data** on, time grouping **Hours**, date range **Today** (or
   since last sync).
6. Make a second automation the same way with data type **Workouts**, export version **v2**.
   Leave "Include route" off: routes are never stored.
7. Sync cadence: as often as the app allows. iOS only runs it while the phone is unlocked, so
   before a demo press **Export now** on each automation.

## What lands on the timeline

- One `sleep` event per night, once it ended 20 minutes ago.
- One `workout` event per workout, with duration, distance, calories and heart rate.
- One `biometric` event per metric per finished hour (`Heart rate 77 bpm, 61 to 112`, `Steps 3,315`).

Re-sending the same export is safe: every event has a stable `external_id`. The response is an
`IngestResponse` (`inserted`, `duplicates`, `ignored`). Payload and mapping: `docs/api.md`, "Source
webhooks". A sample export lives in `apps/api/src/ingest/fixtures/health-auto-export.json`.

## Try it

```sh
curl -X POST "$API/v1/webhooks/health-auto-export" \
  -H "Authorization: Bearer $API_KEY" -H "content-type: application/json" \
  --data @apps/api/src/ingest/fixtures/health-auto-export.json
```
