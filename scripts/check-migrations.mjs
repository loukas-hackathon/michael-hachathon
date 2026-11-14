#!/usr/bin/env node
// Guards supabase/migrations before merge (incident #178: two PRs both added 20261115030000_*.sql,
// so `supabase db push` hit a duplicate schema_migrations key and production migrations stopped).
//   node scripts/check-migrations.mjs             names and unique timestamps
//   node scripts/check-migrations.mjs origin/main also: every new file sorts after the newest on main
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
const base = process.argv[2];
const errors = [];

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
const byStamp = new Map();
for (const f of files) {
  const m = NAME.exec(f);
  if (!m) {
    errors.push(`${f}: name must be <14 digit timestamp>_<snake_case>.sql`);
    continue;
  }
  byStamp.set(m[1], [...(byStamp.get(m[1]) ?? []), f]);
}
for (const [stamp, same] of byStamp) {
  if (same.length > 1)
    errors.push(`timestamp ${stamp} is used by ${same.join(" and ")}; rename the newer one`);
}

if (base) {
  const onBase = execFileSync("git", ["ls-tree", "--name-only", `${base}:${DIR}`], { encoding: "utf8" })
    .split("\n")
    .filter((f) => NAME.test(f));
  const newest =
    onBase
      .map((f) => f.slice(0, 14))
      .sort()
      .at(-1) ?? "";
  for (const f of files.filter((f) => NAME.test(f) && !onBase.includes(f))) {
    if (f.slice(0, 14) <= newest) {
      errors.push(
        `${f} sorts before or at the newest migration on ${base} (${newest}); give it a later timestamp`,
      );
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`migrations: ${e}`);
  process.exit(1);
}
console.log(`migrations: ${files.length} files, timestamps unique${base ? `, new files after ${base}` : ""}`);
