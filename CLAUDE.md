@AGENTS.md

## Claude Code notes

- Project permissions live in `.claude/settings.json`: pnpm, git, gh, node, npx, curl, railway,
  vercel and supabase run without prompts. Nothing is denied; still go through branch + PR (see
  AGENTS.md) and never force-push `main`, because that would wipe the other person's work.
- Personal overrides go in `.claude/settings.local.json` (gitignored).
- `CLAUDE.local.md` (gitignored, loaded automatically) holds each person's private links, including
  the Build Hub URL. Teammates create their own from the template in `docs/claude-local.example.md`.
