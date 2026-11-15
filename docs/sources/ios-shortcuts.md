# iPhone app opens through Shortcuts

The live iPhone signal: a personal automation tells Michael when a chosen app opens. Michael pairs
each open with the next one (or a close) into one `app_usage` event with its duration.

## How fast it arrives, and what the real time nudges read (#438)

One request per app open, a second or two after the app comes to the front; nothing is batched.
But an open only becomes a stored `app_usage` event when the next open (or a close) ends it, so the
app in front right now is not in the database, and the same app opened twice in a row is one event.
The API therefore also keeps every signal in memory for 12 hours (`apps/api/src/ingest/phone-live.ts`)
and the two real time nudges (`apps/api/src/nudges/realtime.ts`) read both. Two limits follow from
the automation reporting opens only, of the chosen apps only: an app that was not chosen is never
seen, and the minutes of the app in front are counted up to now (at most 45) because nothing says
when the phone was put down.

## The second shortcut: Michael Focus (#447)

`pnpm shortcut:focus` writes and signs `apps/web/public/MichaelFocus.shortcut` (the name of the
file is the name iOS and macOS give it, and the app and the Mac collector run it by that name).
It receives Text and has one job, Set Focus on Do Not Disturb: a date and time (`2026-11-17 14:00`)
switches it on until then, `off` switches it off, `check` does nothing. It sends nothing anywhere
and reads no file. The app runs it with
`shortcuts://run-shortcut?name=Michael%20Focus&input=text&text=...` after the person's tap; the Mac
collector with `shortcuts run "Michael Focus" --input-path <file>`. The set up and the phone test:
`docs/setup-manual.md` section 8c.

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

## One tap set up: the Michael shortcut, made and signed by a script (#303)

Apple lets no link or app create a personal automation, but a signed shortcut installs with Add
Shortcut and `shortcuts://run-shortcut?name=Michael&input=text&text=<key>` runs it with the device
key. So the app (You > Connections > iPhone) does: **Add the shortcut** (the signed file this app
serves at `/Michael.shortcut`, or the iCloud link in `MICHAEL_SHORTCUT_URL` if one is set),
**Connect the shortcut** (mints a key and runs it once), then the person makes the App automation
and picks Michael (a few taps; no way around it).

Nobody builds the shortcut by hand. On a Mac signed in to iCloud and online:

```sh
pnpm shortcut          # writes scripts/shortcut/out/Michael.shortcut and signs it into apps/web/public/Michael.shortcut
pnpm shortcut:inspect  # optional: how macOS itself reads every action and parameter, in memory
```

Commit `apps/web/public/Michael.shortcut`; merging deploys it. Another API:
`node scripts/shortcut/build.mjs --sign --api https://api.example.com`. The file holds no key: the
shortcut reads the person's key from its own file when it runs. The signing certificate Apple
issues lasts about a year (the one from 15 Nov 2026 ends 14 Dec 2027): run `pnpm shortcut` again
before then.

What the shortcut does (`scripts/shortcut/build.mjs` is the source of truth):

1. Named **Michael** (the name is the file's name, `Michael.shortcut`; `apps/web/lib/one-tap.ts`
   runs it by name). **Receives** Text and Apps, so it takes the key from a link and the app from an
   automation.
2. **If** Shortcut Input (as Text) **begins with** `mk_`:
   - **Save File**: Shortcut Input, to `Shortcuts/Michael/key.txt`, "Ask Where to Save" off,
     "Overwrite If File Exists" on.
   - **Show Notification**: `Connected to Michael.`
   - **Stop This Shortcut**.
3. **Otherwise**:
   - **Get File from Folder** `Shortcuts/Michael/key.txt` ("Error If Not Found" off). If it has no
     value, **Show Notification** `Open Michael, You, iPhone to connect.` and stop.
   - **Get Contents of URL**
     `https://api-production-16521a26.up.railway.app/v1/webhooks/ios-shortcuts`, Method **POST**,
     Header `Authorization` = `Bearer ` followed by the file (as Text), Request Body **JSON**: `app` =
     Shortcut Input (Name), `action` = `open`.

Opens alone are enough: opening the next app closes the one before, and a session over two hours is
dropped. The person's automation: Automation, **+**, **App**, pick the apps, tick **Is Opened** and
**Run Immediately**, then choose **Michael**.

### How the file is made, and what was checked

A shortcut file is a property list: a few `WFWorkflow...` keys and `WFWorkflowActions`, a list of
`{ WFWorkflowActionIdentifier, WFWorkflowActionParameters }`. `shortcuts sign --mode anyone` sends
it to Apple and gets back a signed container (an Apple Encrypted Archive, magic `AEA1`, signed by
Apple and not encrypted) that any iPhone may import. Checked on macOS 26.6 on 15 Nov 2026:

- **Against real shortcuts on a Mac** (Apple's own in `WorkflowKit.framework/Resources/Gallery.bundle`
  and the starter shortcuts in the Shortcuts library): the top level keys (`WFWorkflowClientVersion`,
  `WFWorkflowMinimumClientVersion`, `WFWorkflowIcon`, `WFWorkflowInputContentItemClasses` with
  `WFAppContentItem` and `WFStringContentItem`, `WFWorkflowTypes`, `WFWorkflowImportQuestions`,
  `WFWorkflowHasShortcutInputVariables`); If, Otherwise and End If as
  `is.workflow.actions.conditional` with one `GroupingIdentifier` and `WFControlFlowMode` 0, 1, 2,
  `WFInput` as `{ Type: Variable, Variable: <attachment> }`; `is.workflow.actions.notification`; Shortcut
  Input as `{ Type: ExtensionInput }`; magic variables as `ActionOutput` with `OutputUUID`;
  `WFTextTokenString` with `attachmentsByRange`, `WFTextTokenAttachment`; the "as Text" and
  property markers (`WFCoercionVariableAggrandizement`, `WFPropertyVariableAggrandizement`); and
  `WFDictionaryFieldValue` items (from a publicly shared export).
- **Against macOS' own Shortcuts code** (`pnpm shortcut:inspect` loads the file through
  WorkflowKit): every action identifier resolves to the right action (If, Save File, Show
  Notification, Stop This Shortcut, Otherwise, Get File from Folder, Get Contents of URL, End If)
  and every parameter key in the file is a parameter of its action and reads back with the value
  set: `WFAskWhereToSave`, `WFFileDestinationPath`, `WFSaveFileOverwrite`, `WFGetFilePath`,
  `WFFileErrorIfNotFound`, `WFURL`, `WFHTTPMethod` POST, `WFHTTPBodyType` JSON, `WFHTTPHeaders`,
  `WFJSONValues`, `ShowHeaders`. With no folder set, both file actions default to the Shortcuts
  folder. An App input has a `Name` property and can be read as text.
- **Against the signed file**: the signature verifies with the certificate inside it (issued by
  Apple System Integration CA 4, no personal detail), and the workflow inside is our twelve
  actions unchanged. Signing drops any name key and sets the client version of the signing Mac.
- **From documentation only**: the If comparison codes 8 (begins with; the same numbers as
  Foundation's predicate operators, and 4 and 99 match real shortcuts) and 101 (does not have any
  value; 100, has any value, matches a real shortcut).
- **Only a real iPhone can tell**: that Safari offers the file and Shortcuts shows Add Shortcut,
  that the name arrives as Michael, that the Connect link saves the key, that an App automation
  hands the app to the shortcut as its input, and what iOS asks the first time it sends to the
  API. The test is in `docs/setup-manual.md`, 8b.

## Set up by hand (without the shortcut; about two minutes)

The app no longer shows these steps: since #303 the iPhone page always offers the shortcut. They
still work, with a link that carries the key (`.../v1/webhooks/ios-shortcuts?key=<key>`). One
automation can cover every app the person picks.

1. Make a device key for iPhone Shortcuts and put it in the link above.
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
