# iPhone app opens through Shortcuts

The live iPhone signal: a personal automation tells Michael when a chosen app opens and closes.
Michael pairs the two into one `app_usage` event with its duration. (History comes from the
Biome reader in `apps/collector`, which lags about a day.)

## One tap set up: publish the Michael shortcut once (a human, about ten minutes)

Apple lets no link or app create a personal automation, but a shared shortcut installs in one tap
and `shortcuts://run-shortcut?name=Michael&input=text&text=<key>` runs it with the device key. So
the app (You > Connections, iPhone screen time) does: **Add the shortcut** (iCloud link), **Connect the
shortcut** (mints a key and runs it once), then the person makes the App automation and picks
Michael (a few taps; no way around it). Until the shortcut is published the page falls back to the
copy the URL steps below.

To publish it, on an iPhone with the latest iOS:

1. Shortcuts, **+**, name it exactly **Michael**. Set **Receive** to Text and Apps, so it takes
   the key from a link and the app from an automation.
2. **If** Shortcut Input **begins with** `mk_`:
   - **Save File**: Shortcut Input, to `Shortcuts/Michael/key.txt`, "Ask Where to Save" off,
     "Overwrite If File Exists" on.
   - **Show Notification**: `Connected to Michael.`
   - **Stop This Shortcut**.
3. **Otherwise**:
   - **Get File** `Shortcuts/Michael/key.txt` ("Error If Not Found" off). If it is empty, **Show
     Notification** `Open Michael, You, iPhone screen time to connect.` and stop.
   - **Get Contents of URL**
     `https://api-production-16521a26.up.railway.app/v1/webhooks/ios-shortcuts`, Method **POST**,
     Header `Authorization` = `Bearer ` followed by the file, Request Body **JSON**: `app` = Shortcut
     Input (Name), `action` = `open`.
4. Share, **Copy iCloud Link**. Check it installs on another phone without asking anything.
5. Set `MICHAEL_SHORTCUT_URL` to that link in the web app's environment (Vercel, all
   environments) and redeploy. The name must stay **Michael**: `apps/web/lib/one-tap.ts` runs it by
   name.

Opens alone are enough: opening the next app closes the one before, and a session over two hours is
dropped. The person's automation: Automation, **+**, **App**, pick the apps, tick **Is Opened** and
**Run Immediately**, then choose **Michael**.

## Set up by hand (per app, about two minutes each)

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

Use a device key from You > Connections > iPhone screen time (the copy button gives the whole URL).

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
