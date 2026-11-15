# iPhone app opens through Shortcuts

The live iPhone signal: a personal automation tells Michael when a chosen app opens. Michael pairs
each open with the next one (or a close) into one `app_usage` event with its duration.

## With only an iPhone (no Mac)

This is the whole iPhone connection for someone without a Mac, and it needs nothing else. Screen
Time history (every app, by the day) is the part that needs a Mac: Apple keeps it on the devices,
and the Biome reader in `apps/collector` reads the copy synced to the Mac, about a day behind.

What the app does about it:

- **You > Connections > iPhone** leads with "Live, from your iPhone" when no Mac is connected or
  the page is open on an iPhone; "Have a Mac too?" (Screen Time) sits below it. With a Mac
  connected and the page open on the Mac, Screen Time leads and Shortcuts is the optional extra.
- The Mac is optional for iPhone only people: "Skip, I don't use a Mac" (Today's Get started card,
  the Connections list, the Mac page) sets the `michael_no_mac` cookie, and an iPhone that already
  sends app opens does the same on its own. The Mac row then reads Optional, is never the next
  step, and Get started swaps "Connect your Mac" for "Connect your iPhone".
- Without a Mac everything else still works: Google Calendar, Apple Watch (Health Auto Export runs
  on the iPhone), iPhone app opens, Location, Claude, chat and nudges.

## One tap set up: publish the Michael shortcut once (a human, about ten minutes)

Apple lets no link or app create a personal automation, but a shared shortcut installs in one tap
and `shortcuts://run-shortcut?name=Michael&input=text&text=<key>` runs it with the device key. So
the app (You > Connections > iPhone) does: **Add the shortcut** (iCloud link), **Connect the
shortcut** (mints a key and runs it once), then the person makes the App automation and picks
Michael (a few taps; no way around it). Until the shortcut is published the page falls back to the
by hand steps below.

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
     Notification** `Open Michael, You, iPhone to connect.` and stop.
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

## Set up by hand (until the shortcut is published; about two minutes)

The page shows this while `MICHAEL_SHORTCUT_URL` is unset. The link stays behind a **Copy your
link** button (it is shown only if the clipboard is blocked): "This link is yours alone. Keep it
private." One automation can cover every app the person picks.

1. In Michael: You > Connections > iPhone, **Connect**, then **Copy your link**.
2. Shortcuts, Automation, **+**, **App**. Pick the apps, tick **Is Opened** and **Run Immediately**.
3. Add **Get Contents of URL** and paste the link. Method **POST**, and one field: `app` = the
   **Shortcut Input** variable (set to **Name**; if your iOS version leaves it empty, make one
   automation per app and type the app's name).

`action` can be left out: it means `open`, and opening the next app closes the one before. Add
`action` = `close` in a second **Is Closed** automation only for exact end times. `at` (Current
Date, ISO 8601) is optional too; without it the time of arrival is used.

## Body

```json
{ "app": "Instagram", "action": "open", "at": "2026-11-14T12:22:00+02:00" }
```

`action` is `open` or `close` (`opened`, `closed`, any case also work); missing means `open`. `bundle_id` is optional.
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
