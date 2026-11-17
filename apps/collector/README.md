# Michael collector

Runs on your own Mac. It reads what the Mac already knows about your day and posts it to Michael's
timeline. It only reads: it never changes the files it looks at, and it sends nothing anywhere
except the API address you give it.

**On your own Mac, the easy way:** Michael, You, Mac, **Connect this Mac**. Paste the one
line it shows into Terminal (or download and double-click `Michael.command`). It installs this
collector into `~/.michael` without admin rights, connects it to your account with a setup token that
works once, and starts it; `~/.michael/Michael.command` starts it again, and it opens at login.
The installer is `GET /v1/setup/mac.sh` (`apps/api/src/setup/mac-script.ts`).

From this repository:

```bash
pnpm collect --list                # sources this Mac can read
pnpm collect --dry-run             # read and count, send nothing
pnpm collect --once                # one pass: backfill, then exit
pnpm collect                       # backfill, then check for new data every minute
```

By default it posts to `http://localhost:8787` with the key `dev-key`. Point it elsewhere with
`MICHAEL_API_URL` and `MICHAEL_API_KEY` (your own device key from You > Devices in the web app, so the
data lands in your account, not the demo week). Positions are kept in `~/.michael/collector-state.json`,
so a restart continues where it stopped, and running a backfill twice never duplicates events.

| Source         | What it reads                                                                                                | Needs                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `mac-usage`    | Which app was in front and when, notifications, screen on and off (about 4 weeks back)                       | Full Disk Access for the terminal or app that runs the collector |
| `iphone-usage` | iPhone and Apple Watch app usage synced by Screen Time, about a day behind the phone                         | Full Disk Access, and Share Across Devices on in Screen Time     |
| `chrome`       | Sites visited in Chrome, time on each, and what was searched for (months back)                               | Nothing: Chrome's history file is readable without a permission  |
| `claude-code`  | Claude Code sessions: work stretches, prompts typed, time spent waiting for you, tokens (about 30 days back) | Nothing: the transcripts sit in your own `~/.claude` folder      |

`iphone-usage` needs "Share Across Devices" on in Screen Time on both the iPhone and the Mac. It
gives which app was in front, for how long and where it was opened from, about 4 weeks back. The
data reaches the Mac roughly once a day, so it is history for patterns, not a live feed. Each pass
re-reads the last three days in case the sync delivers late. Home screen folders, Control Centre,
the lock screen and other system surfaces are not counted as apps.

These files are private to macOS and can change between versions. They are the fast route for the
hackathon. The product replaces them with our own menu bar app, browser extension and phone app,
which post the same events (see `docs/data-sources.md`).

## Focus guards: muting distracting apps

While it watches (not with `--once` or `--dry-run`), the collector also enforces focus guards: when
you tap Do it on "Mute WhatsApp 14:00 to 16:00", ask Michael in chat, or ask Claude, the app is
closed whenever it comes to the front during that window, and you see why: "WhatsApp is off until
16:00. Back to Deep work." Undo in Michael and it can open again within a minute.

- It checks `GET /v1/focus-guards/active` every 45 seconds and the app in front every 5 seconds,
  only while a guard runs. Off the record, it does nothing.
- The app in front comes from `lsappinfo` (part of macOS, no permission). Closing is AppleScript
  `quit` (the same as Cmd+Q, so the app closes normally). The first time, macOS asks whether the
  terminal may control that app; say OK. If you say no, Michael hides the app instead.
- Only chat, social, music, video and game apps can ever be muted (the list is in
  `packages/shared/src/mac-apps.ts`). Finder, the Dock, System Settings, terminals, Claude and
  Michael are never touched. No admin rights are needed.
- `--no-guard` turns it off.

## Do Not Disturb, when you say yes

When a nudge offers Do Not Disturb and you tap it, the collector switches it on until the block
ends (or until morning at night), and off again if you end it in Michael. It never switches
anything on by itself.

- No app may set a Focus, so it runs a shortcut: add **Michael Focus** once (You, Connections,
  iPhone, "Do Not Disturb, when you say yes", or `docs/setup-manual.md` section 8c). Without it the
  collector does nothing and tells the API, which then offers the shortcut instead.
- It looks at `GET /v1/focus-guards/active?dnd=ready|missing` every 15 seconds and runs
  `shortcuts run "Michael Focus"` with the time to end, once. It switches off only what it switched
  on, and nothing once the time has passed (macOS ends it by itself).
- The first run makes Shortcuts ask a Privacy question: allow it for good. Until then the
  `shortcuts` command does not return, so the collector waits a minute on each run and says so in
  its log; Do Not Disturb is switched on and off all the same.
- Focus is shared across your devices by default, so your iPhone follows the Mac.
- `--no-dnd` turns it off.

Try it: run `pnpm collect`, open WhatsApp, then in Michael's chat say "mute WhatsApp for 10
minutes" (or ask Claude, which uses the `block_mac_app` tool). Bring WhatsApp to the front: it
quits and the notification appears.

## What the Chrome source leaves out

- It keeps the host of a page (`example.com`) and its title. The rest of the address, with its
  path and query string, never leaves the Mac.
- Banking, health, adult and password manager sites, sign in pages and anything on the local
  network are skipped whole: no visit, no title, no search term. The list is in
  `src/site-privacy.ts`.
- Add your own in `~/.michael/exclude-hosts.txt`, one host per line. `example.com` also covers
  `shop.example.com`. Lines starting with `#` are ignored.
- Search terms on other sites are kept as typed. If a search itself is private, exclude the search
  site or use a private window: Chrome records no history there.

`pnpm --filter @michael/collector check:chrome` runs the reader against a made up history file and
checks these rules.

## What the Claude Code source leaves out

- It keeps the first 120 characters of each prompt you typed, on one line, and numbers: start and
  end of each work stretch, prompts typed, seconds spent waiting for you, tokens, model, and the
  name of the working folder.
- Tool input, tool output, file contents and the assistant's answers are never sent. Neither is
  text you pasted or context your editor attached.
- Anything in a prompt that looks like a key, token or password is replaced by `[secret]` before
  it leaves the Mac.
- A work stretch is sent once it has been quiet for 30 minutes, so its numbers are final. Prompts
  are sent straight away. For prompts the moment they are typed, add the hooks from "Connect Claude
  Code" in the root README.

`pnpm --filter @michael/collector check:claude-code` runs the reader against made up transcripts
and checks these rules.

## Adding a source

Write a `Reader` in `src/readers/` and add it to `src/readers/index.ts`. A reader returns events
and a cursor. Give every event a stable `external_id`, never write to the files you read, and use
`openCopy` for any database another app keeps open.
