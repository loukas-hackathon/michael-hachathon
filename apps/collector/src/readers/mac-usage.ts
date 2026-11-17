import { homedir } from "node:os";
import { join } from "node:path";
import type { EventInput } from "@michael/shared";
import { appName } from "../app-names";
import { APPLE_EPOCH_OFFSET, appleSecondsToIso, openCopy } from "../sqlite";
import type { Reader } from "../types";

// macOS keeps about four weeks of its own activity log here: which app was in front and when,
// notifications delivered, and when the screen was lit. Private format, so treat it as best effort.
const DB_PATH = join(homedir(), "Library/Application Support/Knowledge/knowledgeC.db");

// Rows can land a little after they happened, so each run re-reads a window before the cursor.
// Events are idempotent on external_id, so the overlap costs nothing.
const OVERLAP_SECONDS = 6 * 3600;

type Row = {
  uuid: string;
  stream: string;
  start: number;
  end: number;
  value: string | null;
  flag: number | null;
  bundle: string | null;
};

export const macUsage: Reader = {
  name: "mac-usage",
  source: "macos_usage",
  describe: "Mac app usage, notifications and screen state from macOS's own log (needs Full Disk Access)",
  platforms: ["darwin"],
  async read(ctx) {
    const db = openCopy(DB_PATH, ctx.tmpDir);
    try {
      const nowApple = Date.now() / 1000 - APPLE_EPOCH_OFFSET;
      const since = ctx.cursor ? Number(ctx.cursor) - OVERLAP_SECONDS : nowApple - ctx.backfillDays * 86_400;

      const rows = db
        .prepare(
          `select o.ZUUID as uuid, o.ZSTREAMNAME as stream, o.ZSTARTDATE as start, o.ZENDDATE as end,
                  o.ZVALUESTRING as value,
                  case when o.ZSTREAMNAME = '/display/isBacklit' then o.ZVALUEINTEGER end as flag,
                  m.Z_DKNOTIFICATIONUSAGEMETADATAKEY__BUNDLEID as bundle
             from ZOBJECT o
             left join ZSTRUCTUREDMETADATA m on m.Z_PK = o.ZSTRUCTUREDMETADATA
            where o.ZSTREAMNAME in ('/app/usage', '/notification/usage', '/display/isBacklit')
              and o.ZSTARTDATE > ?
            order by o.ZSTARTDATE`,
        )
        .all(since) as unknown as Row[];

      const events: EventInput[] = [];
      let newest = ctx.cursor ? Number(ctx.cursor) : 0;

      for (const row of rows) {
        newest = Math.max(newest, row.start);
        const base = { source: "macos_usage" as const, external_id: `kc:${row.uuid}` };

        if (row.stream === "/app/usage" && row.value && row.end > row.start) {
          events.push({
            ...base,
            type: "app_usage",
            start_at: appleSecondsToIso(row.start),
            end_at: appleSecondsToIso(row.end),
            title: appName(row.value),
            data: { bundle_id: row.value, device: "mac", seconds: Math.round(row.end - row.start) },
          });
        } else if (row.stream === "/notification/usage" && row.bundle) {
          events.push({
            ...base,
            type: "notification",
            start_at: appleSecondsToIso(row.start),
            end_at: null,
            title: appName(row.bundle),
            data: { bundle_id: row.bundle, device: "mac" },
          });
        } else if (row.stream === "/display/isBacklit") {
          const on = row.flag === 1;
          events.push({
            ...base,
            type: "screen",
            start_at: appleSecondsToIso(row.start),
            end_at: row.end > row.start ? appleSecondsToIso(row.end) : null,
            title: on ? "Screen on" : "Screen off",
            data: { state: on ? "on" : "off", device: "mac" },
          });
        }
      }

      ctx.log(`${rows.length} rows read, ${events.length} events`);
      return { events, cursor: newest ? String(newest) : ctx.cursor };
    } finally {
      db.close();
    }
  },
};
