# iPhone app opens through Shortcuts

The live iPhone signal: a personal automation tells Michael when a chosen app opens and closes.
Michael pairs the two into one `app_usage` event with its duration. (History comes from the
Biome reader in `apps/collector`, which lags about a day.)

## Set up (per app, about two minutes each)

Do this for the apps that matter (Instagram, TikTok, YouTube, WhatsApp, ...). One automation can
cover several apps.

1. Shortcuts, Automation, **+**, **App**. Choose the apps, tick **Is Opened**, select **Run
   Immediately** and turn off "Notify When Run".
2. New blank automation. Add **Get Contents of URL**:
   - URL: `https://api-production-16521a26.up.railway.app/v1/webhooks/ios-shortcuts?key=<your key>`
   - Method **POST**, Request Body **JSON** with three fields:
     - `app` (Text): the **Shortcut Input** variable, tapped and set to **Name** (if your iOS
       version leaves it empty, make one automation per app and type the app's name)
     - `action` (Text): `open`. Simplest: make this automation with **Is Opened** only, then a
       second one with **Is Closed** and `close`
     - `at` (Text): **Current Date**, formatted as **ISO 8601** (optional: without it the time of
       arrival is used)
3. Done. Open the app once and check Michael's timeline after you close it.

Until per-user ingest tokens exist (#114) the key is the shared `API_KEY`.

## Body

```json
{ "app": "Instagram", "action": "open", "at": "2026-11-14T12:22:00+02:00" }
```

`action` is `open` or `close` (`opened`, `closed`, any case also work). `bundle_id` is optional.
Opening another app closes the one before it. A close without an open, or a session over two
hours, is dropped. Full rules: `docs/api.md`, "Source webhooks". Sample sequence:
`apps/api/src/ingest/fixtures/ios-shortcuts.json`.

## Try it

```sh
curl -X POST "$API/v1/webhooks/ios-shortcuts?key=$API_KEY" -H "content-type: application/json" \
  -d '{"app":"Instagram","action":"open"}'
curl -X POST "$API/v1/webhooks/ios-shortcuts?key=$API_KEY" -H "content-type: application/json" \
  -d '{"app":"Instagram","action":"close"}'
```
