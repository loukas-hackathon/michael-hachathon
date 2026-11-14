// Claude Code SessionStart hook: prints a catch-up brief into the agent's context so every
// session starts in sync with GitHub and knows to sync the Build Hub. Never fails the session.
import { execFileSync } from "node:child_process";

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
    }).trim();
  } catch {
    return "";
  }
};

const gh = (...args) => run("gh", args);
const lines = [];
const section = (title, body) => {
  if (body) lines.push(`## ${title}`, body, "");
};

run("git", ["fetch", "--all", "--prune", "--quiet"]);
section(
  "INCIDENTS: production is broken, fix these first",
  gh("issue", "list", "--label", "incident", "--state", "open", "--limit", "10"),
);
section(
  "Agent requests (do one now if you can)",
  gh("issue", "list", "--label", "agent-request", "--limit", "10"),
);
section(
  "In progress (who is on what; ETAs in comments)",
  gh("issue", "list", "--label", "in-progress", "--limit", "20"),
);
section("Open PRs (in-flight work: check before touching files)", gh("pr", "list", "--limit", "15"));
section("Recently merged on main", run("git", ["log", "--oneline", "-10", "origin/main"]));

lines.push(
  "## Your session checklist (AGENTS.md, The loop)",
  "1. Read the Build Hub decisions (`notes`) and board (`tasks`) with ArtifactData; link in CLAUDE.local.md.",
  "2. Sync, without being asked: Build Hub decisions the code lacks -> create issues; board tasks whose",
  "   issues are merged -> set status done; work you start -> set its task to doing. Humans never sync.",
  "3. Pick the most valuable unblocked issue (demo path first), claim it with an optimistic ETA, ship it.",
);

process.stdout.write(`${lines.join("\n")}\n`);
