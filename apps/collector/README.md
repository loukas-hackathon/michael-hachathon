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

These files are private to macOS and can change between versions. They are the fast route for the
hackathon. The product replaces them with our own menu bar app, browser extension and phone app,
which post the same events (see `docs/data-sources.md`).

## Adding a source

Write a `Reader` in `src/readers/` and add it to `src/readers/index.ts`. A reader returns events
and a cursor. Give every event a stable `external_id`, never write to the files you read, and use
`openCopy` for any database another app keeps open.
