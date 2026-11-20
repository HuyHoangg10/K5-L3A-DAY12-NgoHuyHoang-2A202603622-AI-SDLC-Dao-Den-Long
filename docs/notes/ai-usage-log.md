# AI usage log

Token and cost numbers here are **estimates**. The agent cannot read its own exact usage; the real numbers are in the Claude app (`/usage`, `/context`). I estimate from the size of the files written and tool outputs read (about 4 characters per token) plus the conversation overhead, and round to the nearest 50k.

| phase | tool / model | what for | estimated tokens | how I kept it small |
|---|---|---|---|---|
| 0 (setup + harness) | Claude Code, Sonnet 5.5, reasoning High | fork repo, scaffold, harness, evidence script, notes | ~120k (estimate) | long brief up front, files written once, no clarifying questions |
| 1 (Phase 1) | Claude Code, Sonnet 5.5, reasoning High; review by a fresh subagent following `.claude/agents/reviewer.md` | sim, CLI, tests, 3D view, README, review, fixes | ~350k main session + ~140k reviewer subagent (the subagent reported 138,678 tokens; the main number is my estimate from file sizes, see above) | tests as the main feedback loop (1 s per run), evidence read from the generated README, reviewer in its own context |
| creative add-on 1 (Lantern Cards) | Claude Code, Sonnet 5.5, reasoning High | design questions to you, kit logic, 27 tests, view/HUD, evidence | ~90k (estimate) | pure logic class tested with 1-s vitest runs before any drawing; browser checked with 3 screenshots; mutation checks instead of a second review |
| creative add-on 2 (3 champions, click-to-move, select screen) | Claude Code, Sonnet 5.5, reasoning High | kit base class, 3 kits, generic effect view, select screen, steering, about 150 new tests, browser check | ~200k (estimate) | one generic `KitBase` and effect view instead of three view files; tests first with 1-s runs; mutation checks (found 2 weak tests) |

## Phase 0 and 1 notes

- One long brief written up front (decisions, rules, spec) so no tokens went on clarifying questions. The only question asked was whether to install Node (it was missing).
- Files written once with the Write tool instead of repeated edits; test output read with `tail`, evidence read from the generated README rather than from the JSONL.
- The rules of the game were written as tests and scenario files first-class, so checking a change costs one `npm test` (about 1 s) instead of reading code again.
- Review is done by the `reviewer` subagent with a fresh context, so the main context does not carry a second pass over the whole diff.
