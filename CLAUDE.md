@AGENTS.md

## Claude Code notes

- Project permissions live in `.claude/settings.json` (routine pnpm/git/gh commands are allowed;
  pushing to `main` and force-pushing are denied).
- Personal overrides go in `.claude/settings.local.json` (gitignored).
- `CLAUDE.local.md` (gitignored, loaded automatically) holds each person's private links, including
  the Build Hub URL. Teammates create their own from the template in `docs/claude-local.example.md`.
