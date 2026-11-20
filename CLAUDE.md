@AGENTS.md

# Claude Code notes
- Use the `reviewer` subagent for the evaluation step; do not review your own diff.
- Use the `run-headless-evidence` skill before tagging or whenever evidence is needed.
- Hooks in `.claude/settings.json`: `Stop` runs `npm run check` and blocks while it is red; `PreToolUse` blocks hand-writes to `docs/evidence/**`, force pushes and `.env` access. If a hook blocks you, fix the cause instead of working around it.
- Keep context small: read only the files you need, do not print long outputs (use `tail`/`head`, or read the report file).
- Windows machine, but everything must also run on macOS/Linux. In Bash tool calls use the Write tool for files with quotes/backticks.
