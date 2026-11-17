import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { EventInput } from "@michael/shared";
import { isMapsUrl, parseMapsUrl, titleHasPosition } from "../maps-url";
import { siteCategory } from "../site-categories";
import { hostFromUrl, isExcludedHost, parseExcludeList } from "../site-privacy";
import { openCopy } from "../sqlite";
import type { Reader } from "../types";

// Chrome keeps months of browsing in one SQLite file per profile. We read which site was open,
// for how long, and what was searched for. Private format, so treat it as best effort.
//
// Privacy, in this order:
//   1. A visit to an excluded host (banking, health, adult, password managers, local network, plus
//      the user's own list) is dropped whole, with its title and its search term.
//   2. Of the address we keep the host only. The path and query string never leave this function.
//      Google Maps is the one exception: its address is parsed (maps-url.ts) into a clean search
//      term plus structured place and directions fields, so a map position never lands in a term.

const CHROME_DIR = join(homedir(), "Library/Application Support/Google/Chrome");
const USER_EXCLUDE_FILE = join(homedir(), ".michael", "exclude-hosts.txt");

/** Seconds between 1601-01-01, where Chrome starts counting, and the Unix epoch. */
const CHROME_EPOCH_OFFSET = 11_644_473_600;

// A tab left open overnight reports hours on one page. Past this we no longer believe it.
const MAX_SECONDS = 2 * 3600;

// Chrome writes how long a page was open only when the page is left, so a page that is still open
// reads as zero. Each run re-reads this window before the cursor to pick those up once they have
// a duration. Events are idempotent on external_id, so the overlap costs nothing. A page left
// open for longer than this is missed; its time could not be placed on the timeline anyway.
const OVERLAP_SECONDS = 6 * 3600;

// Paging through results, or going back to them, records the same search again and again. The
// same term on the same engine within this gap of the previous search counts as one search.
const SAME_SEARCH_GAP_MS = 30 * 60 * 1000;

const MAX_TITLE = 200;

// Chrome's "transition" says how the page was reached. The low byte is the kind; 3 and 4 are
// frames loaded inside another page, which the person never chose to visit.
const SUBFRAME_KINDS = "3, 4";

type Row = {
  id: number;
  start_ms: number;
  open_ms: number;
  foreground_ms: number;
  url: string;
  title: string | null;
  term: string | null;
};

type Cursor = Record<string, number>;

const parseCursor = (cursor: string | null): Cursor => {
  if (!cursor) return {};
  try {
    return JSON.parse(cursor) as Cursor;
  } catch {
    return {};
  }
};

const clean = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

/** Which search engine a host belongs to. Unknown hosts are their own engine (a site's search box). */
function searchEngine(host: string): string {
  const labels = host.split(".");
  const known = [
    "google",
    "bing",
    "duckduckgo",
    "youtube",
    "yahoo",
    "yandex",
    "baidu",
    "ecosia",
    "brave",
    "startpage",
    "kagi",
    "perplexity",
    "amazon",
    "wikipedia",
    "github",
    "reddit",
  ];
  return known.find((name) => labels.includes(name)) ?? host;
}

const hasTable = (db: DatabaseSync, table: string) =>
  db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table) !== undefined;

const hasColumn = (db: DatabaseSync, table: string, column: string) =>
  (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);

function readRows(db: DatabaseSync, sinceUnixSeconds: number): Row[] {
  // The annotation tables are newer than the history file itself, so check before joining.
  const foreground =
    hasTable(db, "context_annotations") && hasColumn(db, "context_annotations", "total_foreground_duration");
  const pageTerms =
    hasTable(db, "content_annotations") && hasColumn(db, "content_annotations", "search_terms");
  const typedTerms = hasTable(db, "keyword_search_terms");

  const terms = [
    typedTerms ? "(select k.term from keyword_search_terms k where k.url_id = v.url limit 1)" : null,
    pageTerms ? "nullif(c.search_terms, '')" : null,
    "null",
  ].filter(Boolean);

  // Chrome stores microseconds since 1601, which is too large for a JavaScript number, so all
  // time arithmetic happens inside SQL and comes back as milliseconds.
  return db
    .prepare(
      `select v.id as id,
              (v.visit_time - ${CHROME_EPOCH_OFFSET} * 1000000) / 1000 as start_ms,
              v.visit_duration / 1000 as open_ms,
              ${foreground ? "coalesce(x.total_foreground_duration, 0) / 1000" : "0"} as foreground_ms,
              u.url as url,
              u.title as title,
              coalesce(${terms.join(", ")}) as term
         from visits v
         join urls u on u.id = v.url
         ${foreground ? "left join context_annotations x on x.visit_id = v.id" : ""}
         ${pageTerms ? "left join content_annotations c on c.visit_id = v.id" : ""}
        where v.visit_time > (cast(? as integer) + ${CHROME_EPOCH_OFFSET}) * 1000000
          and (v.transition & 255) not in (${SUBFRAME_KINDS})
        order by v.visit_time, v.id`,
    )
    .all(Math.floor(sinceUnixSeconds)) as unknown as Row[];
}

/** Profile folders that hold a history file: "Default", "Profile 1", "Profile 2"... */
const listProfiles = (chromeDir: string) =>
  existsSync(chromeDir)
    ? readdirSync(chromeDir)
        .filter((name) => name === "Default" || /^Profile \d+$/.test(name))
        .filter((name) => existsSync(join(chromeDir, name, "History")))
        .sort()
    : [];

const loadUserExcludes = (file: string) => {
  try {
    return parseExcludeList(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
};

type Options = { chromeDir?: string; excludeFile?: string };

/** The paths are options so a check can point the reader at a made up history file. */
export function createChromeReader(options: Options = {}): Reader {
  const chromeDir = options.chromeDir ?? CHROME_DIR;
  const excludeFile = options.excludeFile ?? USER_EXCLUDE_FILE;

  return {
    name: "chrome",
    source: "chrome",
    describe: "Chrome history: sites visited, time on each, and searches (no special permission)",
    // The Mac's Chrome folder. On Windows the browser extension sends the same visits.
    platforms: ["darwin"],
    async read(ctx) {
      const profiles = listProfiles(chromeDir);
      if (profiles.length === 0) throw new Error(`No Chrome history found in ${chromeDir}`);

      const userExcludes = loadUserExcludes(excludeFile);
      const before = parseCursor(ctx.cursor);
      const after: Cursor = { ...before };
      const events: EventInput[] = [];
      const nowSeconds = Date.now() / 1000;

      for (const profile of profiles) {
        // One cursor per profile, so a profile added later still gets its own backfill.
        const since =
          before[profile] !== undefined
            ? before[profile] - OVERLAP_SECONDS
            : nowSeconds - ctx.backfillDays * 86_400;
        const sinceMs = since * 1000;

        // Every profile's file has the same name, so each copy gets a folder of its own.
        const copyDir = join(ctx.tmpDir, `chrome-${profiles.indexOf(profile)}`);
        mkdirSync(copyDir, { recursive: true });
        const db = openCopy(join(chromeDir, profile, "History"), copyDir);
        let rows: Row[];
        try {
          rows = readRows(db, since);
        } finally {
          db.close();
        }

        let visits = 0;
        let searches = 0;
        let leftOut = 0;
        let lastSearch: { key: string; at: number } | null = null;

        for (const row of rows) {
          after[profile] = Math.max(after[profile] ?? 0, Math.floor(row.start_ms / 1000));

          const host = hostFromUrl(row.url);
          if (!host) continue;
          if (isExcludedHost(host, userExcludes)) {
            leftOut++;
            continue;
          }

          // Foreground time is the honest number, but Chrome records it for a minority of visits.
          // Otherwise we fall back to how long the page stayed open, and say so in `foreground`.
          const measured = row.foreground_ms > 0;
          const milliseconds = measured ? row.foreground_ms : row.open_ms;
          const seconds = Math.min(Math.round(milliseconds / 1000), MAX_SECONDS);

          // Visits under one second are dropped: they are redirect hops and instant bounces, or
          // pages still open whose duration Chrome has not written yet. The API keeps the first
          // copy of an event, so sending a page before it has a duration would freeze it at zero.
          // A search is a moment, not a stretch of time, so it is kept whatever the duration.
          const maps = isMapsUrl(row.url);
          if (milliseconds >= 1000) {
            const title = clean(row.title);
            // Some pages have no title, or use their own address as one. Never pass that on.
            // A Maps page titled with a dropped pin's position is just "Google Maps".
            const safeTitle =
              !title || /^[a-z][a-z0-9+.-]*:\/\//i.test(title)
                ? host
                : maps && titleHasPosition(title)
                  ? "Google Maps"
                  : title;
            const category = siteCategory(host);
            events.push({
              source: "chrome",
              type: "web_visit",
              external_id: `chrome:${profile}:${row.id}`,
              start_at: new Date(row.start_ms).toISOString(),
              end_at: new Date(row.start_ms + seconds * 1000).toISOString(),
              title: safeTitle.slice(0, MAX_TITLE),
              data: {
                host,
                seconds,
                foreground: measured,
                ...(category ? { category } : {}),
                origin: "history",
                profile,
              },
            });
            visits++;
          }

          // For Maps the address itself says what was looked up; Chrome's own term for it is the
          // raw path, map position included, so it is never used.
          const mapsSearch = maps ? parseMapsUrl(row.url) : null;
          const term = maps ? (mapsSearch?.term ?? "") : clean(row.term);
          if (term) {
            const engine = mapsSearch ? "google_maps" : searchEngine(host);
            const key = `${engine}\n${term.toLowerCase()}`;
            const repeat =
              lastSearch !== null &&
              lastSearch.key === key &&
              row.start_ms - lastSearch.at <= SAME_SEARCH_GAP_MS;
            lastSearch = { key, at: row.start_ms };
            // Rows at the very start of the window only tell us what the previous search was.
            // Without that, a re-run could not know whether its first search is a repeat, and
            // would post one that an earlier run had rightly skipped.
            if (!repeat && row.start_ms >= sinceMs + SAME_SEARCH_GAP_MS) {
              events.push({
                source: "chrome",
                type: "search",
                external_id: `chrome:${profile}:search:${row.id}`,
                start_at: new Date(row.start_ms).toISOString(),
                end_at: null,
                title: term.slice(0, MAX_TITLE),
                data: {
                  engine,
                  term: term.slice(0, MAX_TITLE),
                  origin: "history",
                  profile,
                  ...(mapsSearch ? { maps: mapsSearch.maps } : {}),
                },
              });
              searches++;
            }
          }
        }

        ctx.log(
          `${profile}: ${rows.length} rows read, ${visits} visits, ${searches} searches, ${leftOut} left out as private`,
        );
      }

      events.sort((a, b) => a.start_at.localeCompare(b.start_at));
      return { events, cursor: Object.keys(after).length > 0 ? JSON.stringify(after) : ctx.cursor };
    },
  };
}

export const chrome = createChromeReader();
