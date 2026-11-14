# Michael browser extension

Records how long you spend on each site, live, and adds it to your Michael timeline as `web_visit`
events. Manifest V3, plain JavaScript, no build step: the folder loads as it is.

It works in Chrome and in the browsers built on it (Arc, Brave, Edge).

## What it records

One event per stretch on a site, sent to `POST /v1/events/batch`:

```json
{
  "source": "chrome",
  "type": "web_visit",
  "start_at": "2026-11-14T10:00:00.000Z",
  "end_at": "2026-11-14T10:12:00.000Z",
  "title": "Flights from Athens to New York",
  "data": { "host": "skyscanner.net", "seconds": 720, "category": "travel", "origin": "extension" },
  "external_id": "ext:6f1c2c0e-3d4b-4c59-9a55-0e9f6a3f1b21"
}
```

That is all of it: the bare host (no `www.`, no port, path or query), the page title, when, how
long, and a category when the host is in the small built in map. `origin: "extension"` tells these
events apart from the ones the Chrome history reader in `apps/collector` produces (`origin:
"history"`); both use the same host rule, so the same visit carries the same host from either.

## What it never records

- **The full address.** Only the host leaves the page. A page with no title shows its address as
  the title, so a title that looks like an address is replaced by the host.
- **Incognito windows.** Even if you allow the extension there.
- **Pages that are not web pages:** `chrome://`, `chrome-extension://`, `about:`, `file:` and the like.
- **Built in exclusions:** banking and payments, health, adult sites, password managers, and local
  addresses (`localhost`, single word hosts, `.local`, private IP ranges, IPv6 literals). The lists
  name the big ones and a few word patterns (`bank`, `health`, `clinic` and so on) catch the rest.
  They lean towards leaving a site out.
- **Your own list** in Settings. An entry covers the host and its subdomains. Adding a site also
  removes what was waiting from it and its row in the local tally.
- **Anything while off the record.** The switch stops recording, throws away the open stretch and
  holds back sending until it is released.

An excluded site leaves no trace: no event, no count, no entry in the tally.

Kept in the browser only (`chrome.storage.local`): your settings and key, the open stretch, events
waiting to be sent (at most 5000), and a 14 day tally of hosts and seconds for the popup.

## Load it

1. Open `chrome://extensions`.
2. Switch on **Developer mode** (top right).
3. **Load unpacked** and choose this folder, `apps/extension`.
4. Pin Michael to the toolbar if you want the popup one click away.

## Point it at an API

Open Settings (the popup's Settings link, or Details > Extension options).

- **API address:** `http://localhost:8787` by default. For the deployed API, paste its `https://`
  address. Chrome then asks once to let the extension reach that one address; say Allow. Access to
  `localhost` is granted at install, nothing else is.
- **API key:** the API's `API_KEY`.
- **Send a test event** saves both and posts one event of type `note` (so a test never adds time
  to a site). It answers in plain words: sent, key refused, or address not reachable.

The status line shows events sent today, events waiting and the last successful send.

## The rules

A **stretch** is one unbroken spell on one host in one tab, in the active tab of the focused window.

| It starts when                                                   | It ends when                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| a tab becomes active                                             | another tab becomes active, or the tab closes                    |
| the active tab arrives on a page (including `pushState` changes) | the tab moves to another host                                    |
| the browser window gets focus again                              | the window loses focus to another app                            |
| you come back from idle or unlock the screen                     | no keyboard or mouse for 60 seconds, or the screen locks         |
|                                                                  | the browser closes, the machine sleeps, or you go off the record |

- **Same host, same tab: one stretch.** Moving between pages of one site continues the stretch; the
  title follows the latest page. A different tab on the same host is a new stretch.
- **Sound keeps a stretch alive through idle.** A video or a call has no keyboard or mouse input, so
  an audible tab is not ended by the 60 second idle rule. A locked screen always ends it.
- **Under 2 seconds is dropped.** That is a tab passed on the way to another.
- **Two hours is the longest single event.** A longer spell is cut there and continues in a new one.
- **Nothing is lost when Chrome stops the worker.** Chrome shuts a Manifest V3 service worker down
  after about 30 seconds without events. All state is in `chrome.storage.local`, every listener is
  registered at the top level, and a `chrome.alarms` tick every 30 seconds touches the open stretch
  and sends the queue. If nothing touched the stretch for 2 minutes (browser closed, crash, sleep),
  it ended when it was last seen, not when the browser came back. So a crash costs at most the
  last 30 seconds and can never produce a nine hour visit.
- **Sending:** up to 1000 events per call, every 30 seconds. A failed send keeps the events and
  tries again at the next tick. Every event has its own `external_id`, so a retry never duplicates.
  Events the API reads and refuses (400) are dropped, because trying again cannot help.

## Permissions

| Permission                                       | Why                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `tabs`                                           | read the host and title of the active tab                             |
| `webNavigation`                                  | notice page changes inside single page apps                           |
| `idle`                                           | stop counting when you are away or the screen is locked               |
| `alarms`                                         | the 30 second tick (timers do not survive the worker stopping)        |
| `storage`                                        | settings, the open stretch, the queue, the tally                      |
| host: `http://localhost/*`, `http://127.0.0.1/*` | post to a local API without a CORS failure                            |
| optional host: `https://*/*`, `http://*/*`       | lets Settings ask for the one API address you enter, and nothing more |

There are no content scripts: the extension never reads or changes a page.

## Files

| Path                                 | What                                             |
| ------------------------------------ | ------------------------------------------------ |
| `manifest.json`                      | Manifest V3                                      |
| `background.js`                      | service worker: listeners, the tick, sending     |
| `lib/stretch.js`                     | the stretch rules, pure functions                |
| `lib/hosts.js`                       | host parsing and exclusions                      |
| `lib/categories.js`                  | host to category map                             |
| `lib/api.js`                         | the API call, permissions, error wording         |
| `lib/store.js`, `lib/format.js`      | storage shapes, tally, copy                      |
| `popup.*`, `options.*`, `styles.css` | the popup and the settings page                  |
| `test/logic.test.mjs`                | `node --test apps/extension/test/logic.test.mjs` |
| `tools/make-icons.mjs`               | redraws `icons/*.png` after a colour change      |

The folder has no `package.json` on purpose, so pnpm does not treat it as a workspace package.
`pnpm check` still lints it with Biome.

## Later

- **One category list and one exclusion list.** `lib/categories.js` and `lib/hosts.js` here do the
  same job as `apps/collector/src/site-categories.ts` and `site-privacy.ts`, in two languages,
  because this folder has no build step. The category names and the host rule already match; the
  lists themselves should become one (generated JavaScript, or a build step for the extension).
- **One event per visit.** The history reader and the extension both describe the same visits. The
  timeline should prefer `origin: "extension"` where both exist.

## The product version

- **Chrome Web Store listing.** One click install instead of Load unpacked, with the store's review
  and a privacy disclosure that matches the list above.
- **A key per user.** Today the extension holds the shared `API_KEY`. The product signs the user in
  and gives each browser its own revocable token.
- **A fixed API address.** With one production API the address field goes away and so does the
  optional host permission: the manifest names that one origin.
- **Off the record everywhere.** The switch here covers this browser. In the product it follows the
  account, so one tap stops every source.
- **Dark at night.** The pages are light only for now.
