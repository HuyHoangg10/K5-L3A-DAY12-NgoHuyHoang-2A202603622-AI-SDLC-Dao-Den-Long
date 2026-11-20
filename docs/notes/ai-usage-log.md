# AI usage log

Token and cost numbers here are **estimates**. The agent cannot read its own exact usage; the real numbers are in the Claude app (`/usage`, `/context`). I estimate from the size of the files written and tool outputs read (about 4 characters per token) plus the conversation overhead, and round to the nearest 50k.

| phase | tool / model | what for | estimated tokens | how I kept it small |
|---|---|---|---|---|
| 0 (setup + harness) | Claude Code, Sonnet 5.5, reasoning High | fork repo, scaffold, harness, evidence script, notes | ~ (to fill at the end of Phase 1) | |
| 1 (Phase 1) | Claude Code, Sonnet 5.5, reasoning High; `reviewer` subagent for the review | sim, CLI, tests, 3D view, README, review | ~ (to fill at the end of Phase 1) | |

## Phase 0 and 1 notes

- One long brief written up front (decisions, rules, spec) so no tokens went on clarifying questions. The only question asked was whether to install Node (it was missing).
- Files written once with the Write tool instead of repeated edits; test output read with `tail`, evidence read from the generated README rather than from the JSONL.
- The rules of the game were written as tests and scenario files first-class, so checking a change costs one `npm test` (about 1 s) instead of reading code again.
- Review is done by the `reviewer` subagent with a fresh context, so the main context does not carry a second pass over the whole diff.
