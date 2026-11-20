# Where the AI got it wrong

Real cases only. Format: what happened, how it was noticed, what changed in the harness.

| # | phase | what went wrong | how it was found | fix / harness change |
|---|---|---|---|---|
| 1 | 0 | Node.js was not installed; the first plan assumed `npm` was on PATH. | `node: command not found` on the first command. | Asked before installing (winget, LTS). `scripts/hooks/stop-check.mjs` adds the folder of the running node to PATH so the hook works in a stale shell. |
| 2 | 1 | The first big Bash heredoc with TypeScript code failed to parse (quotes inside the heredoc). | Bash error `unexpected EOF`; nothing was written. | CLAUDE.md now says to use the Write tool for code files. |
| 3 | 1 | The `vite.config.ts` used `test:` with `defineConfig` from `vite`, which the types reject. | `npm run typecheck`. | Switched to `vitest/config`. |
| 4 | 1 | First version of the hit-drop test only used `carried: 4`, where `floor` and `ceil` give the same answer, so a wrong rounding would still pass. | Manual mutation (changed `floor` to `ceil`, tests stayed green). | Added `tests/drop.test.ts` with carried 5, 1, 0. Reviewer instructions say to prove suspicion by mutating a scratch copy. |
| 5 | 1 | The `full_night` evidence scenario ended after 1187 ticks (the idle player was killed) but the speed check only asked for `>= 1000` ticks, so it would not prove a full night. | Reading the generated scenario table. | Player is parked on a lantern, check now requires exactly 14400 ticks. |
