// Copies local env files from the main checkout into the current git worktree.
// Fixed file list only, never overwrites existing files, never writes outside this worktree.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const FILES = ["apps/api/.env", "apps/web/.env.local"];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const here = resolve(git("rev-parse", "--show-toplevel"));
const main = resolve(dirname(resolve(here, git("rev-parse", "--git-common-dir"))));

if (here === main) {
  console.log("Already in the main checkout; nothing to copy.");
  process.exit(0);
}

for (const file of FILES) {
  const src = join(main, file);
  const dest = join(here, file);
  if (!existsSync(src)) console.log(`skip ${file} (missing in main checkout)`);
  else if (existsSync(dest)) console.log(`skip ${file} (already exists)`);
  else {
    copyFileSync(src, dest);
    console.log(`copied ${file}`);
  }
}
