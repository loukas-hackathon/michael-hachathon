// Builds the compact day templates behind the demo week (apps/api/src/demo/templates.json) from
// Manolis' anonymised real days in apps/web/lib/sample/real (PR #111). Run it again when those
// files change:   node apps/api/scripts/build-demo-templates.mjs
//
// Each template keeps only the device lanes (Mac, iPhone, Chrome, Claude Code) of one real day,
// as [start offset from Athens midnight in seconds, duration in seconds or null, source, type,
// title, data]. Events that started before midnight are dropped; ids and external ids are not kept
// (the generator makes its own). Claude Code session ids are replaced by short local keys.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const realDir = join(here, "../../web/lib/sample/real");
const out = join(here, "../src/demo/templates.json");

// All four days are after the October clock change, so Athens is UTC+02:00.
const DAYS = ["2026-10-29", "2026-11-01", "2026-11-12", "2026-11-14"];
const LANES = new Set(["macos_usage", "iphone_usage", "chrome", "claude_code"]);

const templates = {};
for (const date of DAYS) {
  const file = JSON.parse(readFileSync(join(realDir, `${date}.json`), "utf8"));
  const midnight = Date.parse(`${date}T00:00:00+02:00`);
  const sessions = new Map();
  const sessionKey = (id) => {
    if (!sessions.has(id)) sessions.set(id, `s${sessions.size + 1}`);
    return sessions.get(id);
  };
  const rows = [];
  for (const e of file.events) {
    if (!LANES.has(e.source)) continue;
    const start = Date.parse(e.start_at);
    if (start < midnight || start >= midnight + 86_400_000) continue;
    const data = { ...e.data };
    if (typeof data.session_id === "string") data.session_id = sessionKey(data.session_id);
    const offset = Math.round((start - midnight) / 1000);
    const duration = e.end_at ? Math.max(0, Math.round((Date.parse(e.end_at) - start) / 1000)) : null;
    rows.push([offset, duration, e.source, e.type, e.title, data]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  templates[date] = rows;
  console.log(date, rows.length, "events");
}
writeFileSync(out, `${JSON.stringify(templates)}\n`);
console.log("wrote", out);
