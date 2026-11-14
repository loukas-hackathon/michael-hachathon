# Michael collector

Runs on your own Mac. It reads what the Mac already knows about your day and posts it to Michael's
timeline. It only reads: it never changes the files it looks at, and it sends nothing anywhere
except the API address you give it.

```bash
pnpm collect --list                # sources this Mac can read
pnpm collect --dry-run             # read and count, send nothing
pnpm collect --once                # one pass: backfill, then exit
pnpm collect                       # backfill, then check for new data every minute
```

By default it posts to `http://localhost:8787` with the key `dev-key`. Point it elsewhere with
`MICHAEL_API_URL` and `MICHAEL_API_KEY`. Positions are kept in `~/.michael/collector-state.json`,
so a restart continues where it stopped, and running a backfill twice never duplicates events.

| Source      | What it reads                                                                          | Needs                                                            |
| ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `mac-usage` | Which app was in front and when, notifications, screen on and off (about 4 weeks back) | Full Disk Access for the terminal or app that runs the collector |
| `chrome`    | Sites visited in Chrome, time on each, and what was searched for (months back)         | Nothing: Chrome's history file is readable without a permission  |

These files are private to macOS and can change between versions. They are the fast route for the
hackathon. The product replaces them with our own menu bar app, browser extension and phone app,
which post the same events (see `docs/data-sources.md`).

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

## Adding a source

Write a `Reader` in `src/readers/` and add it to `src/readers/index.ts`. A reader returns events
and a cursor. Give every event a stable `external_id`, never write to the files you read, and use
`openCopy` for any database another app keeps open.
